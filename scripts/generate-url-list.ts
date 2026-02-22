import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fetch } from "undici";

const ROOT = path.resolve(__dirname, "..");
const KB_BASE_URL = process.env.KB_BASE_URL || "https://slughub.ucsc.edu";
const KB_PAGE_ID = process.env.KB_PAGE_ID || "its_kb_view2";
const OUTPUT_PATH =
  process.env.KB_URL_LIST ||
  path.join(ROOT, "data", "kb", "url-list.txt");

type DocumentRecord = {
  sys_id: string;
  number?: string;
  short_description?: string;
};

function isDocumentArray(value: unknown): value is DocumentRecord[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === "object" &&
    value[0] !== null &&
    "sys_id" in value[0] &&
    ("number" in value[0] || "short_description" in value[0])
  );
}

function extractDocuments(result: unknown): DocumentRecord[] {
  const stack = [result];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    for (const value of Object.values(current)) {
      if (!value) continue;
      if (isDocumentArray(value)) return value;
      if (typeof value === "object") stack.push(value);
    }
  }
  throw new Error("Failed to locate documents array in portal payload.");
}

async function fetchDocuments() {
  const endpoint = `${KB_BASE_URL}/api/now/sp/page?id=${KB_PAGE_ID}`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Failed to fetch page data (${response.status})`);
  }
  const payload = (await response.json()) as { result?: unknown };
  if (!payload.result) throw new Error("No result payload returned.");
  return extractDocuments(payload.result);
}

async function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

async function main() {
  const docs = await fetchDocuments();
  const urlPrefix = `${KB_BASE_URL}/its?id=kb_article_view&sys_kb_id=`;
  const entries = docs
    .map((doc) => ({
      url: `${urlPrefix}${doc.sys_id}`,
      number: doc.number ?? "",
      short: doc.short_description ?? "",
    }))
    .sort((a, b) => a.url.localeCompare(b.url));

  const header = `# UCSC ITS KB URLs (${entries.length} articles) - generated ${new Date().toISOString()}`;
  const body = entries.map(
    (entry) => `${entry.url}  # ${entry.number} ${entry.short}`.trim(),
  );

  await ensureDir(OUTPUT_PATH);
  await writeFile(OUTPUT_PATH, [header, ...body].join("\n") + "\n", "utf8");
  console.log(
    JSON.stringify({
      event: "kb.urls.generated",
      count: entries.length,
      output: path.relative(ROOT, OUTPUT_PATH),
    }),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: "kb.urls.error",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
