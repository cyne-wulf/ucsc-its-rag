import { NextRequest, NextResponse } from "next/server";
import { embedQuery } from "@/lib/embedder";
import { searchChunks } from "@/lib/vector-backend";

export async function GET(req: NextRequest) {
	const q = new URL(req.url).searchParams.get("q") || "";
	if (!q) return NextResponse.json({ error: "q required" }, { status: 400 });
	const { vector } = await embedQuery(q);
  const items = await searchChunks(vector);
	return NextResponse.json({ items });
}
