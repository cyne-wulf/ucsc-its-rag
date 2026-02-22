import { env } from "./env";

export function normalizeWhitespace(input: string) {
  return input.replace(/\s+/g, " ").trim();
}

function expandAcronyms(input: string) {
  if (!env.ACRONYM_MAP) return input;
  let expanded = input;
  for (const [acronym, expansion] of Object.entries(env.ACRONYM_MAP)) {
    const regex = new RegExp(`\\b${acronym}\\b`, "gi");
    expanded = expanded.replace(regex, expansion);
  }
  return expanded;
}

export function normalizeQuery(input: string) {
  const expanded = expandAcronyms(input);
  return normalizeWhitespace(expanded).toLowerCase();
}

export function cleanSnippet(text: string) {
  return normalizeWhitespace(text);
}
