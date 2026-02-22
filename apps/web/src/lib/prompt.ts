import { env } from "./env";
import type { SourceDocument } from "./types";

const CITATION_TEMPLATE = (source: SourceDocument, idx: number) => {
  const breadcrumb = source.breadcrumbs?.length
    ? `${source.breadcrumbs.join(" / ")}`
    : source.title;
  return `### Source [${idx + 1}]: ${breadcrumb}
URL: ${source.url}${source.anchor ? `#${source.anchor}` : ""}
${source.snippet}`;
};

export function buildPrompt(question: string, sources: SourceDocument[]) {
  const intro = `You are the UCSC ITS Tech Support assistant. Answer using ONLY the sources below.
Rules:
- Cite supporting sources inline using [1], [2], etc.
- Prefer procedures and official policy quotes verbatim.
- If the sources do not contain an answer, reply with:
  "Sorry, I couldn't find an ITS KB page with information pertaining to your issue, but you can try searching the knowledge base directly."
  then add "If that doesn't help, you can call our office at ${env.SYSTEM_PHONE_FALLBACK}"
- Never invent URLs.`;

  const context = sources.map(CITATION_TEMPLATE).join("\n\n");
  return `${intro}

Question:
${question}

Sources:
${context}

Compose a concise, step-by-step answer tailored to UCSC students and staff, with citations after each sentence they support.`;
}
