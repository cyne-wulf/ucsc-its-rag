import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractArticle } from "./html-extract";

type HistoryMap = Map<string, string>;

const projectRoot = path.resolve(process.cwd(), "..", "..");
const kbRoot = process.env.KB_ROOT_DIR || path.join(projectRoot, "data", "kb");
const historyPath =
  process.env.KB_HISTORY_PATH || path.join(kbRoot, "ingest-history.json");

let historyPromise: Promise<HistoryMap> | null = null;

async function loadHistory(): Promise<HistoryMap> {
  if (!historyPromise) {
    historyPromise = (async () => {
      try {
        const raw = await readFile(historyPath, "utf8");
        const parsed = JSON.parse(raw) as Record<string, string>;
        const map: HistoryMap = new Map();
        for (const [filePath, hash] of Object.entries(parsed)) {
          map.set(hash, filePath);
        }
        return map;
      } catch (error) {
        console.warn("preview.history.load_failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        return new Map();
      }
    })();
  }
  return historyPromise;
}

export async function resolveSnapshotPath(docHash: string) {
  if (!docHash) return null;
  const history = await loadHistory();
  return history.get(docHash) ?? null;
}

export async function loadSnapshot(docHash: string) {
  const filePath = await resolveSnapshotPath(docHash);
  if (!filePath) return null;
  try {
    const html = await readFile(filePath, "utf8");
    const extracted = extractArticle(html);
    return {
      html: extracted.articleHtml,
      title: extracted.title,
      breadcrumbs: extracted.breadcrumbs,
      updated: extracted.updated,
    };
  } catch (error) {
    console.warn("preview.snapshot.read_failed", {
      docHash,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
