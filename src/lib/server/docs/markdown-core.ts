import { Marked, type Token } from "marked";
import sanitizeHtml from "sanitize-html";

/*
 * Pure markdown processing shared by the main thread and the render worker. Imports are
 * relative or from node_modules only: the worker runs outside the SvelteKit module graph.
 */

export interface Heading {
  level: number;
  text: string;
  id: string;
}

export type MarkdownErrorCode = "too_large" | "too_complex" | "unavailable";

export class MarkdownError extends Error {
  constructor(
    readonly code: MarkdownErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "MarkdownError";
  }
}

/** Longest markdown source accepted at all (UTF-8 bytes). */
export const MAX_MARKDOWN_BYTES = 200 * 1024;
/** Longest source the synchronous functions accept; larger input must use the worker. */
export const MAX_SYNC_MARKDOWN_BYTES = 2 * 1024;
/** Deepest blockquote/list nesting that is parsed; deeper segments are shown as plain text. */
export const MAX_NESTING_DEPTH = 20;

export type MarkdownJob =
  | { op: "render"; segments: string[]; nonce: string }
  | { op: "text"; segments: string[] }
  | { op: "headings"; segments: string[] };

export type MarkdownJobResult =
  { ok: true; result: unknown } | { ok: false; error: string };

export const HEADING_ID_PREFIX = "h-";

const UMLAUTS: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  å: "a",
};

export function slugify(text: string): string {
  const lower = text.toLowerCase().normalize("NFC");
  const transliterated = lower.replace(
    /[äöüßæœøå]/g,
    (char) => UMLAUTS[char] ?? char,
  );
  const base = transliterated
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.length > 0 ? base : "section";
}

export class SlugCounter {
  private readonly seen = new Map<string, number>();

  next(text: string): string {
    const base = slugify(text);
    const count = this.seen.get(base) ?? 0;
    this.seen.set(base, count + 1);
    return `${HEADING_ID_PREFIX}${count === 0 ? base : `${base}-${count}`}`;
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface WikiToken {
  type: "wikilink";
  raw: string;
  slug: string;
  label: string;
}

const WIKILINK = /^\[\[([^[\]\n|]{1,200}?)(?:\|([^[\]\n]{1,200}?))?\]\]/;

const wikiLinkExtension = {
  name: "wikilink",
  level: "inline" as const,
  start(src: string) {
    const index = src.indexOf("[[");
    return index === -1 ? undefined : index;
  },
  tokenizer(src: string): WikiToken | undefined {
    const match = WIKILINK.exec(src);
    if (!match) return undefined;
    const slug = match[1]!.trim();
    if (slug.length === 0) return undefined;
    const label = (match[2] ?? match[1]!).trim();
    return {
      type: "wikilink",
      raw: match[0],
      slug,
      label: label.length > 0 ? label : slug,
    };
  },
};

export function inlinePlainText(tokens: Token[] | undefined): string {
  if (!tokens) return "";
  let out = "";
  for (const token of tokens) {
    const t = token as Token & {
      tokens?: Token[];
      text?: string;
      label?: string;
    };
    if (t.type === "wikilink") out += (t as unknown as WikiToken).label;
    else if (t.type === "html") out += stripTags(t.raw);
    else if (t.type === "br") out += " ";
    else if (t.tokens) out += inlinePlainText(t.tokens);
    else if (typeof t.text === "string") out += t.text;
  }
  return out;
}

function stripTags(html: string): string {
  return decodeEntities(
    sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }),
  );
}

export function decodeEntities(value: string): string {
  return value.replace(
    /&(amp|lt|gt|quot|apos|nbsp|#39|#x27|#\d{1,7}|#x[0-9a-f]{1,6});/gi,
    (_m, entity: string) => {
      switch (entity.toLowerCase()) {
        case "amp":
          return "&";
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "quot":
          return '"';
        case "apos":
        case "#39":
        case "#x27":
          return "'";
        case "nbsp":
          return " ";
      }
      const code = entity.startsWith("#x")
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
      return String.fromCodePoint(code);
    },
  );
}

export function newMarked(headings?: {
  nonce: string;
  counter: SlugCounter;
}): Marked {
  const instance = new Marked({
    gfm: true,
    breaks: false,
    extensions: [
      {
        ...wikiLinkExtension,
        renderer(token: unknown) {
          const t = token as WikiToken;
          return `<a href="wiki:${encodeURIComponent(t.slug)}">${escapeHtml(t.label)}</a>`;
        },
      },
    ],
  });
  if (headings) {
    instance.use({
      renderer: {
        heading(tok) {
          const id = headings.counter.next(inlinePlainText(tok.tokens));
          const inline = this.parser.parseInline(tok.tokens);
          return `<h${tok.depth} id="hw-${headings.nonce}-${id}">${inline}</h${tok.depth}>\n`;
        },
      },
    });
  }
  return instance;
}

export function walkHeadings(
  tokens: Token[],
  visit: (depth: number, tokens: Token[]) => void,
): void {
  for (const token of tokens) {
    const t = token as Token & {
      depth?: number;
      tokens?: Token[];
      items?: Token[];
    };
    if (t.type === "heading") {
      visit(t.depth!, t.tokens ?? []);
      continue;
    }
    if (t.type === "list" && t.items) walkHeadings(t.items, visit);
    else if (t.type === "table") continue;
    else if (t.tokens && t.type !== "paragraph" && t.type !== "text")
      walkHeadings(t.tokens, visit);
  }
}

export const BLOCK_END =
  /<\/(?:p|li|h[1-6]|td|th|tr|blockquote|pre|summary|details|ul|ol|table)>|<(?:br|hr)\s*\/?>/gi;

const isBlank = (code: number) => code === 32 || code === 9;
const isDigit = (code: number) => code >= 48 && code <= 57;

interface LineScan {
  /** Quote and list markers on the line plus half the indentation in front of the first one. */
  depth: number;
  /** Index of the first marker character to escape (the delimiter of an ordered marker), -1 if none. */
  escapeAt: number;
}

function scanLine(text: string, from: number, end: number): LineScan {
  let markers = 0;
  let columns = 0;
  let escapeAt = -1;
  let i = from;
  while (i < end) {
    const code = text.charCodeAt(i);
    if (code === 32 || code === 9) {
      if (markers === 0) columns += code === 9 ? 4 : 1;
      i++;
    } else if (code === 62) {
      if (escapeAt === -1) escapeAt = i;
      markers++;
      i++;
    } else if (
      (code === 45 || code === 42 || code === 43) &&
      (i + 1 >= end || isBlank(text.charCodeAt(i + 1)))
    ) {
      if (escapeAt === -1) escapeAt = i;
      markers++;
      i++;
    } else if (isDigit(code)) {
      let j = i;
      while (j < end && j - i < 9 && isDigit(text.charCodeAt(j))) j++;
      const delimiter = text.charCodeAt(j);
      if (
        j < end &&
        (delimiter === 46 || delimiter === 41) &&
        (j + 1 >= end || isBlank(text.charCodeAt(j + 1)))
      ) {
        if (escapeAt === -1) escapeAt = j;
        markers++;
        i = j + 1;
      } else break;
    } else break;
  }
  return {
    depth: markers + (columns >> 1),
    escapeAt: markers > 0 ? escapeAt : -1,
  };
}

/**
 * marked recurses once per blockquote/list level, so unbounded nesting overflows the stack.
 * Lines that nest deeper than `max` levels (a cheap, over-counting estimate) have their first
 * marker backslash-escaped, which turns the line into plain paragraph text; everything else is
 * left alone. Linear time; returns the same string when nothing is too deep.
 */
export function limitNesting(text: string, max = MAX_NESTING_DEPTH): string {
  let out: string[] | null = null;
  let copied = 0;
  let start = 0;
  while (start <= text.length) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    const { depth, escapeAt } = scanLine(text, start, end);
    if (depth > max && escapeAt >= 0) {
      out ??= [];
      out.push(text.slice(copied, escapeAt), "\\");
      copied = escapeAt;
    }
    start = end + 1;
  }
  if (!out) return text;
  out.push(text.slice(copied));
  return out.join("");
}

function preFallback(text: string): string {
  return `<pre>${escapeHtml(text)}</pre>\n`;
}

/**
 * Runs `parse` on the nesting-limited text. A stack overflow inside marked (which the limit
 * should make impossible) is caught too and answered with `fallback` (escaped plain text).
 */
function guarded<T>(
  text: string,
  parse: (limited: string) => T,
  fallback: () => T,
): T {
  try {
    return parse(limitNesting(text));
  } catch (error) {
    if (error instanceof RangeError) return fallback();
    throw error;
  }
}

/** Unsanitized html for each markdown segment, heading ids numbered across all segments. */
export function renderSegments(texts: string[], nonce: string): string[] {
  const marked = newMarked({ nonce, counter: new SlugCounter() });
  return texts.map((text) =>
    guarded(
      text,
      (limited) => marked.parse(limited, { async: false }),
      () => preFallback(text),
    ),
  );
}

/** Plain text of each markdown segment (not html-safe). */
export function plainTextOfSegments(texts: string[]): string[] {
  const marked = newMarked();
  return texts.map((text) =>
    guarded(
      text,
      (limited) =>
        sanitizeHtml(
          (marked.parse(limited, { async: false }) as string).replace(
            BLOCK_END,
            "$& ",
          ),
          {
            allowedTags: [],
            allowedAttributes: {},
            nonTextTags: ["script", "style", "textarea", "option", "noscript"],
          },
        ),
      () => text,
    ),
  );
}

/** Headings across all markdown segments with the ids `renderSegments` produces. */
export function headingsOfSegments(texts: string[]): Heading[] {
  const marked = newMarked();
  const counter = new SlugCounter();
  const headings: Heading[] = [];
  for (const text of texts) {
    guarded(
      text,
      (limited) =>
        walkHeadings(marked.lexer(limited), (level, tokens) => {
          const plain = decodeEntities(inlinePlainText(tokens))
            .replace(/\s+/g, " ")
            .trim();
          headings.push({
            level,
            text: plain,
            id: counter.next(inlinePlainText(tokens)),
          });
        }),
      () => undefined,
    );
  }
  return headings;
}
