import "server-only";
import * as cheerio from "cheerio";

export type SnapshotExtraction = {
  title: string;
  updated?: string;
  breadcrumbs: string[];
  articleHtml: string;
};

const headingSelector = "h1, h2, h3, h4, h5, h6";

function cleanText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function gatherBreadcrumbs($: cheerio.CheerioAPI) {
  const fromMeta = $("meta[name^='its:breadcrumb:']")
    .toArray()
    .map((meta) => {
      const name = $(meta).attr("name") || "";
      const idx = Number(name.split(":" ).pop());
      const value = cleanText($(meta).attr("content") || "");
      if (Number.isNaN(idx) || !value) return null;
      return { idx, value };
    })
    .filter((item): item is { idx: number; value: string } => Boolean(item))
    .sort((a, b) => a.idx - b.idx)
    .map((item) => item.value);

  if (fromMeta.length) return fromMeta;

  const crumbs = new Set<string>();
  $("nav .breadcrumb, nav .breadcrumbs li, .breadcrumb li, .breadcrumbs li").each(
    (_, element) => {
      const txt = cleanText($(element).text());
      if (txt) crumbs.add(txt);
    },
  );
  return Array.from(crumbs);
}

function selectContentRoot($: cheerio.CheerioAPI) {
  const scoped = $(".kb-article-content").first();
  if (scoped.length) return scoped;
  const article = $("article").first();
  if (article.length) return article;
  return $("body");
}

export function extractArticle(html: string): SnapshotExtraction {
  const $ = cheerio.load(html);
  $("script, style, noscript, header, footer").remove();

  const title =
    cleanText($("meta[property='og:title']").attr("content") || "") ||
    cleanText($("title").first().text()) ||
    "UCSC ITS Knowledge Base";

  const updated =
    $("time[datetime]").first().attr("datetime") ||
    cleanText($("time").first().text()) ||
    undefined;

  const breadcrumbs = gatherBreadcrumbs($);

  const root = selectContentRoot($);
  root.find("script, style, noscript").remove();

  if (!root.find(headingSelector).length) {
    root.prepend(`<h1>${title}</h1>`);
  }

  const articleHtml = root.html() || "";

  return {
    title,
    updated,
    breadcrumbs,
    articleHtml,
  };
}
