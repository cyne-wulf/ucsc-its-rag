import * as cheerio from "cheerio";
import type { ParagraphSegment } from "./types";

const headingTags = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const IGNORED_TEXT = [/^loading\.{0,3}$/i, /^powered by servicenow/i];

export type HtmlExtraction = {
  title: string;
  updated?: string;
  breadcrumbs: string[];
  segments: ParagraphSegment[];
  articleHtml: string;
};

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function cleanText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function gatherBreadcrumbs($: cheerio.CheerioAPI) {
  const metaCrumbs = $("meta[name^='its:breadcrumb:']")
    .toArray()
    .map((meta) => {
      const name = $(meta).attr("name") || "";
      const idx = Number(name.split(":").pop());
      const value = cleanText($(meta).attr("content") || "");
      if (Number.isNaN(idx) || !value) return null;
      return { idx, value };
    })
    .filter((item): item is { idx: number; value: string } => Boolean(item))
    .sort((a, b) => a.idx - b.idx)
    .map((item) => item.value);

  if (metaCrumbs.length) {
    return metaCrumbs;
  }

  const crumbs = new Set<string>();
  $("nav .breadcrumb, nav .breadcrumbs li, .breadcrumb li, .breadcrumbs li").each(
    (_, el) => {
      const txt = cleanText($(el).text());
      if (txt) crumbs.add(txt);
    },
  );
  return Array.from(crumbs);
}

function selectContentRoot($: cheerio.CheerioAPI) {
  const scoped = $(".kb-article-content").first();
  if (scoped.length) {
    return scoped;
  }
  const article = $("article").first();
  if (article.length) {
    return article;
  }
  return $("body");
}

export function extractFromHtml(html: string): HtmlExtraction {
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
  const segments: ParagraphSegment[] = [];
  let currentAnchor: string | undefined;
  let currentHeading: string | undefined;

  const root = selectContentRoot($);
  root.find("script, style, noscript").remove();
  const articleHtml = root.html() || "";

  root
    .find("h1, h2, h3, h4, h5, h6, p, li")
    .each((_, element) => {
      const tag =
        (element as any).tagName || (element as any).name || "";
      const text = cleanText($(element).text());
      if (!text) return;
      if (IGNORED_TEXT.some((pattern) => pattern.test(text))) {
        return;
      }

      if (headingTags.has(tag.toLowerCase())) {
        currentHeading = text;
        const explicitAnchor = $(element).attr("id");
        currentAnchor = explicitAnchor || slugify(text);
        return;
      }

      segments.push({
        text,
        anchor: currentAnchor,
        heading: currentHeading,
        breadcrumbs,
      });
    });

  if (!segments.length) {
    const fallbackText = cleanText(root.text());
    if (fallbackText) {
      segments.push({ text: fallbackText });
    }
  }

  return {
    title,
    updated,
    breadcrumbs,
    segments,
    articleHtml,
  };
}
