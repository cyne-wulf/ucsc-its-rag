import { NextRequest } from "next/server";
import { z } from "zod";
import { getChunkPayload } from "@/lib/qdrant";
import {
  buildChunkPreview,
  buildErrorDocument,
  buildPreviewDocument,
} from "@/lib/server/preview";
import { buildPreviewResponse } from "@/lib/server/preview-response";

const querySchema = z.object({
  doc: z.string().min(8),
  anchor: z.string().optional(),
});

export const runtime = "nodejs";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = querySchema.safeParse({
    doc: params.doc,
    anchor: params.anchor,
  });

  if (!parsed.success) {
    const errorHtml = buildErrorDocument("Preview id is missing.");
    return buildPreviewResponse(errorHtml, {
      status: 400,
      cacheable: false,
    });
  }

  try {
    const payload = await getChunkPayload(parsed.data.doc);
    if (!payload) {
      const missHtml = buildErrorDocument(
        "We couldn’t find that knowledge base excerpt.",
      );
      return buildPreviewResponse(missHtml, {
        status: 404,
        cacheable: false,
      });
    }

    const chunk = buildChunkPreview(payload, parsed.data.anchor);
    const html = buildPreviewDocument({
      title: payload.title,
      breadcrumbs: payload.breadcrumbs,
      updated: payload.updated,
      url: payload.url,
      bodyHtml: chunk.html,
      anchorId: chunk.anchorId,
      notice: "Previewing the retrieved ITS KB excerpt.",
    });
    return buildPreviewResponse(html);
  } catch (error) {
    console.error("api.preview.error", error);
    const errorHtml = buildErrorDocument(
      "Preview service hit an internal error. Try again in a moment.",
    );
    return buildPreviewResponse(errorHtml, {
      status: 500,
      cacheable: false,
    });
  }
}
