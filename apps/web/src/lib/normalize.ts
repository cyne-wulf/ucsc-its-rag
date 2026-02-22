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

type Heuristic = {
  test: (normalizedQuery: string) => boolean;
  addition: string;
};

const QUERY_HEURISTICS: Heuristic[] = [
  {
    test: (query) =>
      /\bmac\b|\bmacbook\b|\bmacos\b/.test(query) &&
      /(wifi|wi-?fi|internet|network|resnet|eduroam)/.test(query),
    addition:
      "help connecting a mac to ucsc eduroam wifi or resnet when there is no internet",
  },
  {
    test: (query) =>
      /(wifi|wi-?fi|internet|network|resnet|eduroam)/.test(query) &&
      /(connect|setup|set up|no|lost|cant|cannot|help)/.test(query),
    addition:
      "ucsc eduroam wifi troubleshooting steps for getting devices online on campus",
  },
];

export function augmentQuery(normalizedQuery: string) {
  let augmented = normalizedQuery;
  for (const heuristic of QUERY_HEURISTICS) {
    if (heuristic.test(normalizedQuery)) {
      augmented = `${augmented} ${heuristic.addition}`;
    }
  }
  return normalizeWhitespace(augmented);
}
