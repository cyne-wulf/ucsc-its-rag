import { NextRequest } from "next/server";
import { z } from "zod";
import { fetchChunkPayload } from "@/lib/vector-backend";
import {
  buildChunkPreview,
  buildErrorDocument,
  buildPreviewDocument,
  sanitizeArticleHtml,
} from "@/lib/server/preview";
import { loadSnapshot } from "@/lib/server/kb-files";
import { buildPreviewResponse } from "@/lib/server/preview-response";

const paramSchema = z.object({
  doc: z.string().min(8),
});

export const runtime = "nodejs";
export const revalidate = 0;

type PreviewRouteContext = {
  params: Promise<{ doc: string }>;
};

export async function GET(
  request: NextRequest,
  context: PreviewRouteContext,
) {
  const anchorParam = request.nextUrl.searchParams.get("anchor") ?? undefined;
  const params = await context.params;
  const parsed = paramSchema.safeParse({ doc: params?.doc });

  if (!parsed.success) {
    const html = buildErrorDocument("Preview ID is invalid.");
    return buildPreviewResponse(html, { status: 400, cacheable: false });
  }

  try {
    const payload = await fetchChunkPayload(parsed.data.doc);
    if (!payload) {
      const html = buildErrorDocument("We couldn’t locate that citation.");
      return buildPreviewResponse(html, { status: 404, cacheable: false });
    }

    const desiredAnchor = anchorParam || payload.anchor || payload.chunk_hash;
    let bodyHtml: string | null = null;
    let anchorId = desiredAnchor;
    let notice: string | undefined;
    let breadcrumbs = payload.breadcrumbs;
    let updated = payload.updated;

    if (payload.doc_hash) {
      const snapshot = await loadSnapshot(payload.doc_hash);
      if (snapshot?.html) {
        bodyHtml = sanitizeArticleHtml(snapshot.html, payload.url);
        if (!breadcrumbs?.length) {
          breadcrumbs = snapshot.breadcrumbs;
        }
        if (!updated && snapshot.updated) {
          updated = snapshot.updated;
        }
      }
    }

    if (!bodyHtml) {
      const chunk = buildChunkPreview(payload, anchorParam);
      bodyHtml = chunk.html;
      anchorId = chunk.anchorId;
      notice = "Showing retrieved excerpt; open the source for the full article.";
    }

    const html = buildPreviewDocument({
      title: payload.title,
      breadcrumbs,
      updated,
      url: payload.url,
      bodyHtml,
      anchorId,
      notice,
    });

    return buildPreviewResponse(html);
  } catch (error) {
    console.error("preview.route.error", error);
    const html = buildErrorDocument(
      "We hit an unexpected error while rendering this preview.",
    );
    return buildPreviewResponse(html, { status: 500, cacheable: false });
  }
}
