#!/usr/bin/env node
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import pLimit from "p-limit";
import { chromium, type Page } from "playwright";
import { hashId } from "./lib/hash";
import { logError, logInfo } from "./lib/logger";
import type { ManifestEntry } from "./lib/types";
import dotenv from "dotenv";

const ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(ROOT, ".env.local") });
dotenv.config({ path: path.join(ROOT, ".env") });
const KB_ROOT = process.env.KB_ROOT_DIR || path.join(ROOT, "data", "kb");
const URL_LIST_PATH =
  process.env.KB_URL_LIST || path.join(KB_ROOT, "url-list.txt");
const OUTPUT_DIR =
  process.env.KB_OUTPUT_DIR || path.join(KB_ROOT, "raw");
const MANIFEST_PATH =
  process.env.KB_MANIFEST || path.join(KB_ROOT, "manifest.json");
const CONCURRENCY = Number(process.env.KB_DOWNLOAD_CONCURRENCY || "5");
const USER_AGENT =
  process.env.KB_USER_AGENT ||
  "ucsc-its-rag/0.1 (+github.com/ucsc-its-rag)";

const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const limitCountArg = [...args]
  .find((arg) => arg.startsWith("--limit="))
  ?.split("=")[1];
const limitCount = limitCountArg ? Number(limitCountArg) : undefined;
const DEFAULT_TIMEOUT = Number(process.env.KB_PAGE_TIMEOUT_MS || "45000");

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

async function loadManifest(): Promise<Record<string, ManifestEntry>> {
  if (!existsSync(MANIFEST_PATH)) return {};
  const raw = await readFile(MANIFEST_PATH, "utf8");
  const entries = JSON.parse(raw) as ManifestEntry[];
  const map: Record<string, ManifestEntry> = {};
  entries.forEach((entry) => {
    map[entry.url] = entry;
  });
  return map;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildDocument(params: {
  title: string;
  url: string;
  updated?: string;
  breadcrumbs: string[];
  contentHtml: string;
}): string {
  const { title, url, updated, breadcrumbs, contentHtml } = params;
  const breadcrumbMeta = breadcrumbs
    .map(
      (crumb, index) =>
        `<meta name="its:breadcrumb:${index}" content="${escapeHtml(crumb)}" />`,
    )
    .join("\n    ");
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <meta name="its:title" content="${escapeHtml(title)}" />
    <meta name="its:canonical" content="${escapeHtml(url)}" />
    ${
      updated
        ? `<meta name="its:updated" content="${escapeHtml(updated)}" />`
        : ""
    }
    ${breadcrumbMeta}
  </head>
  <body>
    <article class="kb-article-content">
${contentHtml}
    </article>
  </body>
</html>`;
}

async function scrapeArticle(page: Page, url: string) {
  const targetUrl = new URL(url);
  if (!targetUrl.searchParams.has("spa")) {
    targetUrl.searchParams.set("spa", "1");
  }
  await page.goto(targetUrl.toString(), {
    waitUntil: "networkidle",
    timeout: DEFAULT_TIMEOUT,
  });

  await page.waitForSelector(".kb-article-content", {
    state: "visible",
    timeout: DEFAULT_TIMEOUT,
  });

  const [contentHtml, title, updatedRaw, breadcrumbs] = await Promise.all(
    [
      page.$eval(".kb-article-content", (el) => el.innerHTML),
      page
        .$eval(".kb-title-header", (el) => el.textContent?.trim() || "")
        .catch(() => "UCSC ITS Knowledge Base"),
      page
        .$eval(
          "sn-time-ago",
          (el) => el.getAttribute("timestamp") || el.textContent || "",
        )
        .catch(() => ""),
      page
        .$$eval(".nav.nav-pills li span a", (anchors) =>
          anchors
            .map((a) => a.textContent?.trim() || "")
            .filter((txt) => Boolean(txt)),
        )
        .catch(() => [] as string[]),
    ],
  );

  if (!contentHtml || contentHtml.trim().length === 0) {
    throw new Error("Empty article content");
  }

  const updated =
    updatedRaw && !updatedRaw.includes("data.") ? updatedRaw.trim() : undefined;

  return {
    title: title || "UCSC ITS Knowledge Base",
    updated,
    breadcrumbs,
    canonical: url,
    html: buildDocument({
      title: title || "UCSC ITS Knowledge Base",
      url,
      updated,
      breadcrumbs,
      contentHtml,
    }),
  };
}

async function downloadOne(
  url: string,
  existing: Record<string, ManifestEntry>,
  page: Page,
): Promise<ManifestEntry | null> {
  const parsed = new URL(url);
  const slug = slugify(parsed.pathname.replace(/\//g, "-")) || "kb";
  const hashSuffix = hashId([url]).slice(0, 8);
  const fileName = `${slug}-${hashSuffix}.html`;
  const outPath = path.join(OUTPUT_DIR, fileName);

  if (!force && existing[url] && (await fileExists(outPath))) {
    return existing[url];
  }

  const article = await scrapeArticle(page, url);
  await writeFile(outPath, article.html, "utf8");
  await sleep(150);

  const entry: ManifestEntry = {
    url,
    file: path.relative(ROOT, outPath),
    title: article.title,
    updated: article.updated,
    fetchedAt: new Date().toISOString(),
    status: 200,
    etag: undefined,
  };
  return entry;
}

async function main() {
  if (!existsSync(URL_LIST_PATH)) {
    throw new Error(
      `Missing ${URL_LIST_PATH}. Create it from data/kb/url-list.example.txt.`,
    );
  }

  await ensureDir(OUTPUT_DIR);
  const urls = (await readFile(URL_LIST_PATH, "utf8"))
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return "";
      const hashIndex = trimmed.indexOf("#");
      if (hashIndex !== -1) {
        return trimmed.slice(0, hashIndex).trim();
      }
      return trimmed;
    })
    .filter((line) => Boolean(line));

  if (!urls.length) {
    throw new Error(`No URLs found in ${URL_LIST_PATH}`);
  }

  const existing = await loadManifest();
  const browser = await chromium.launch({
    headless: true,
  });
  const limit = pLimit(CONCURRENCY);
  const manifest: ManifestEntry[] = [];

  try {
    await Promise.all(
      urls.map((url, index) =>
        limit(async () => {
          if (limitCount && index >= limitCount) {
            return;
          }
          const page = await browser.newPage({
            userAgent: USER_AGENT,
          });
          try {
            const result = await downloadOne(url, existing, page);
            if (result) {
              manifest.push(result);
              logInfo("kb.download.success", {
                url,
                file: result.file,
                title: result.title,
              });
            }
          } catch (err) {
            logError("kb.download.error", {
              url,
              message: err instanceof Error ? err.message : String(err),
            });
          } finally {
            await page.close();
          }
        }),
      ),
    );
  } finally {
    await browser.close();
  }

  manifest.sort((a, b) => a.url.localeCompare(b.url));
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  logInfo("kb.download.complete", { total: manifest.length });
}

main().catch((err) => {
  logError("kb.download.fatal", {
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
