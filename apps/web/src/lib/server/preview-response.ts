import "server-only";
import { NextResponse } from "next/server";

type Options = {
  status?: number;
  cacheSeconds?: number;
  cacheable?: boolean;
};

export function buildPreviewResponse(
  html: string,
  options: Options = {},
) {
  const { status = 200, cacheSeconds = 300, cacheable = true } = options;
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  if (cacheable && cacheSeconds > 0) {
    headers.set("Cache-Control", `public, max-age=${cacheSeconds}`);
  } else {
    headers.set("Cache-Control", "no-store, max-age=0");
  }
  return new NextResponse(html, {
    status,
    headers,
  });
}
