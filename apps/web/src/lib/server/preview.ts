import "server-only";
import sanitizeHtml from "sanitize-html";
import type { ChunkPayload } from "../types";

type PreviewTemplateOptions = {
  title: string;
  breadcrumbs?: string[];
  updated?: string;
  url?: string;
  bodyHtml: string;
  anchorId?: string;
  status?: "ok" | "error";
  notice?: string;
};

type ChunkPreview = {
  html: string;
  anchorId: string;
};

const STYLESHEET_PATH = "/preview.css";

const allowedTags = Array.from(
  new Set([
    ...sanitizeHtml.defaults.allowedTags,
    "article",
    "section",
    "header",
    "footer",
    "main",
    "figure",
    "figcaption",
    "picture",
    "source",
    "mark",
    "small",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "td",
    "th",
    "dl",
    "dt",
    "dd",
    "sup",
    "sub",
    "blockquote",
    "code",
    "pre",
  ]),
);

const allowedAttributes: sanitizeHtml.IOptions["allowedAttributes"] = {
  ...sanitizeHtml.defaults.allowedAttributes,
  a: ["href", "title", "target", "rel", "aria-label"],
  img: ["src", "alt", "width", "height", "loading", "decoding"],
  th: ["scope", "colspan", "rowspan"],
  td: ["scope", "colspan", "rowspan"],
  "*": ["id", "class", "role", "aria-label", "aria-hidden"],
};

function resolveUrl(value?: string, base?: string) {
  if (!value) return undefined;
  if (!base) return value;
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
}

export function sanitizeArticleHtml(html: string, baseUrl?: string) {
  if (!html) return "";
  return sanitizeHtml(html, {
    allowedTags,
    allowedAttributes,
    allowedSchemes: ["http", "https", "mailto", "tel"],
    transformTags: {
      a: (tagName, attribs) => {
        const href = resolveUrl(attribs.href, baseUrl);
        const attribsCopy: sanitizeHtml.Attributes = {
          ...attribs,
          target: "_blank",
          rel: "noreferrer noopener",
        };
        if (href) {
          attribsCopy.href = href;
        } else {
          delete attribsCopy.href;
        }
        return { tagName, attribs: attribsCopy };
      },
      img: (tagName, attribs) => {
        const src = resolveUrl(attribs.src, baseUrl);
        const attribsCopy: sanitizeHtml.Attributes = { ...attribs };
        if (src) {
          attribsCopy.src = src;
        }
        attribsCopy.loading = attribs.loading || "lazy";
        attribsCopy.decoding = attribs.decoding || "async";
        return {
          tagName,
          attribs: attribsCopy,
        };
      },
    },
    exclusiveFilter: (frame) => {
      if (frame.tag === "script" || frame.tag === "style") {
        return true;
      }
      if (frame.tag === "a") {
        return !frame.attribs.href;
      }
      if (frame.tag === "img") {
        return !frame.attribs.src;
      }
      return false;
    },
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value: string) {
  return escapeHtml(value);
}

function normalizeAnchor(anchor?: string, fallback?: string) {
  const trimmed = (anchor || "").trim();
  if (trimmed) return trimmed;
  if (fallback) return fallback;
  return "kb-chunk";
}

export function buildChunkPreview(
  payload: ChunkPayload,
  anchorOverride?: string,
): ChunkPreview {
  const paragraphs = payload.text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block)}</p>`)
    .join("\n");

  const anchorId = normalizeAnchor(
    anchorOverride || payload.anchor,
    payload.chunk_hash,
  );

  const html = `
    <section class="preview-chunk" id="${escapeAttr(anchorId)}" data-anchor-id="${escapeAttr(anchorId)}" data-chunk-id="${escapeAttr(payload.chunk_hash)}">
      ${paragraphs}
    </section>
  `;

  return { html, anchorId };
}

function renderBreadcrumbs(breadcrumbs?: string[]) {
  if (!breadcrumbs || !breadcrumbs.length) {
    return "";
  }
  const trail = breadcrumbs
    .filter(Boolean)
    .map((crumb) => `<span>${escapeHtml(crumb)}</span>`)
    .join("<span class=\"preview-breadcrumb-sep\" aria-hidden=\"true\">›</span>");
  return `<nav class="preview-breadcrumbs" aria-label="Breadcrumbs">${trail}</nav>`;
}

function renderMeta(updated?: string) {
  if (!updated) return "";
  return `<div class="preview-updated">Updated ${escapeHtml(updated)}</div>`;
}

function renderNotice(notice?: string) {
  if (!notice) return "";
  return `<div class="preview-notice" role="status">${escapeHtml(notice)}</div>`;
}

function renderSourceLink(url?: string) {
  if (!url) return "";
  return `<a class="preview-source-link" href="${escapeAttr(url)}" target="_blank" rel="noreferrer noopener">Open source</a>`;
}

export function buildPreviewDocument(options: PreviewTemplateOptions) {
  const {
    title,
    breadcrumbs,
    updated,
    url,
    bodyHtml,
    anchorId,
    status = "ok",
    notice,
  } = options;
  const safeAnchor = anchorId ? escapeAttr(anchorId) : "";
  const crumbs = renderBreadcrumbs(breadcrumbs);
  const meta = renderMeta(updated);
  const noticeHtml = renderNotice(notice);
  const sourceLink = renderSourceLink(url);
  const safeTitle = escapeHtml(title || "UCSC ITS Knowledge Base");
  const hero = `
    <header class="preview-header">
      <div>
        ${crumbs}
        <h1>${safeTitle}</h1>
        ${meta}
      </div>
      ${sourceLink}
    </header>
  `;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="preview-status" content="${status}" />
    <title>${safeTitle}</title>
    <link rel="stylesheet" href="${STYLESHEET_PATH}" />
  </head>
  <body data-anchor="${safeAnchor}" data-preview-status="${status}">
    <div class="preview-shell">
      ${hero}
      ${noticeHtml}
      <main class="preview-body">${bodyHtml}</main>
    </div>
    <script>
      (function(){
        var anchor = document.body.getAttribute("data-anchor");
        if(!anchor) return;
        var el = document.getElementById(anchor);
        if(!el){
          el = document.querySelector('[data-anchor-id="'+anchor+'"]');
        }
        if(el){
          el.classList.add("preview-anchor-hit");
          try {
            el.scrollIntoView({ block: "start" });
          } catch (err) {
            el.scrollIntoView();
          }
        }
      })();
    </script>
  </body>
</html>`;
}

export function buildErrorDocument(message: string) {
  const bodyHtml = `<p class="preview-error">${escapeHtml(message)}</p>`;
  return buildPreviewDocument({
    title: "Preview unavailable",
    bodyHtml,
    status: "error",
    notice: "This citation could not be rendered.",
  });
}
