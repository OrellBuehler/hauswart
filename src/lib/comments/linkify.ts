export type TextSegment = { text: string; href?: string };

const URL_PATTERN = /https?:\/\/[^\s<>"]+/gi;
const TRAILING_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?", "'"]);
const CLOSERS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

function count(value: string, char: string): number {
  return value.split(char).length - 1;
}

/** Cuts sentence punctuation and unbalanced closing brackets off the end of a matched URL. */
function trimUrl(raw: string): string {
  let url = raw;
  for (;;) {
    const last = url.at(-1);
    if (last === undefined) return url;
    const opener = CLOSERS[last];
    if (
      TRAILING_PUNCTUATION.has(last) ||
      (opener !== undefined && count(url, last) > count(url, opener))
    ) {
      url = url.slice(0, -1);
    } else {
      return url;
    }
  }
}

function safeHref(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch (err) {
    if (err instanceof TypeError) return null;
    throw err;
  }
}

/**
 * Splits plain text into text and http(s) link segments. The caller renders
 * the segments as text nodes and anchors, so nothing is ever parsed as HTML.
 */
export function linkify(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = trimUrl(match[0]);
    const href = safeHref(url);
    if (!href) continue;
    if (match.index > last) {
      segments.push({ text: text.slice(last, match.index) });
    }
    segments.push({ text: url, href });
    last = match.index + url.length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}
