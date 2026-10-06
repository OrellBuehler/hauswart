import { Marked, type Token } from "marked";
import sanitizeHtml from "sanitize-html";

export type MarkdownAudience = "member" | "guest";

export interface RenderMarkdownOptions {
  audience: MarkdownAudience;
  includeSecrets?: boolean;
  resolveAttachmentUrl?: (id: string) => string | null;
  resolvePageUrl?: (slug: string) => string | null;
}

export interface VisibilityOptions {
  includeSecrets?: boolean;
}

export interface PlainTextOptions extends VisibilityOptions {
  maxLength?: number;
}

export interface Heading {
  level: number;
  text: string;
  id: string;
}

type BlockKind = "secret" | "warning" | "info";

type Segment =
  | { kind: "md"; text: string }
  | { kind: "block"; type: BlockKind; children: Segment[] };

const MAX_BLOCK_DEPTH = 8;
const BLOCK_KINDS: ReadonlySet<string> = new Set(["secret", "warning", "info"]);

interface Frame {
  type: BlockKind | "flat" | "root";
  hidden: boolean;
  children: Segment[];
  buffer: string[];
}

function flush(frame: Frame): void {
  if (frame.buffer.length === 0) return;
  const text = frame.buffer.join("\n");
  frame.buffer = [];
  if (text.trim().length > 0) frame.children.push({ kind: "md", text });
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const BLOCK_OPEN = /^ {0,3}:{3,}[ \t]*([A-Za-z][A-Za-z0-9_-]*)(.*)$/;
const BLOCK_CLOSE = /^ {0,3}:{3,}[ \t]*$/;

/**
 * Splits markdown into plain markdown segments and `:::kind` container blocks.
 *
 * Secret handling is fail-closed: anything that starts with `:::secret` (whatever follows on
 * the line) opens a secret block, an unclosed block runs to the end of the document, and when
 * secrets are not visible the block (including nested blocks) is dropped from the source before
 * any markdown parsing happens, so its content can never reach the output, the plain text or
 * the headings. Fences (``` / ~~~) are honoured so `:::` inside code is literal.
 */
function splitBlocks(md: string, showSecrets: boolean): Segment[] {
  const root: Frame = { type: "root", hidden: false, children: [], buffer: [] };
  const stack: Frame[] = [root];
  let fence: { char: string; length: number } | null = null;
  let wrapperDepth = 0;

  const top = () => stack[stack.length - 1]!;

  for (const line of md.replace(/\r\n?/g, "\n").split("\n")) {
    const current = top();

    if (fence) {
      const close = FENCE_CLOSE.exec(line);
      if (
        close &&
        close[1]![0] === fence.char &&
        close[1]!.length >= fence.length
      ) {
        fence = null;
      }
      if (!current.hidden) current.buffer.push(line);
      continue;
    }

    const open = FENCE_OPEN.exec(line);
    if (open && !(open[1]![0] === "`" && open[2]!.includes("`"))) {
      fence = { char: open[1]![0]!, length: open[1]!.length };
      if (!current.hidden) current.buffer.push(line);
      continue;
    }

    const blockOpen = BLOCK_OPEN.exec(line);
    if (blockOpen) {
      const name = blockOpen[1]!.toLowerCase();
      const isSecret = name === "secret";
      const hidden = current.hidden || (isSecret && !showSecrets);
      const known = BLOCK_KINDS.has(name);
      const flat = !known || wrapperDepth >= MAX_BLOCK_DEPTH;
      if (!hidden) flush(current);
      stack.push({
        type: flat ? "flat" : (name as BlockKind),
        hidden,
        children: [],
        buffer: [],
      });
      if (!flat) wrapperDepth++;
      continue;
    }

    if (BLOCK_CLOSE.test(line) && stack.length > 1) {
      const frame = stack.pop()!;
      const parent = top();
      if (frame.type !== "flat") wrapperDepth--;
      if (!frame.hidden) {
        flush(frame);
        if (frame.type === "flat") parent.children.push(...frame.children);
        else
          parent.children.push({
            kind: "block",
            type: frame.type as BlockKind,
            children: frame.children,
          });
      }
      continue;
    }

    if (!current.hidden) current.buffer.push(line);
  }

  while (stack.length > 1) {
    const frame = stack.pop()!;
    const parent = top();
    if (frame.hidden) continue;
    flush(frame);
    if (frame.type === "flat") parent.children.push(...frame.children);
    else
      parent.children.push({
        kind: "block",
        type: frame.type as BlockKind,
        children: frame.children,
      });
  }
  flush(root);
  return root.children;
}

function flattenSegments(segments: Segment[], out: string[] = []): string[] {
  for (const segment of segments) {
    if (segment.kind === "md") out.push(segment.text);
    else flattenSegments(segment.children, out);
  }
  return out;
}

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

class SlugCounter {
  private readonly seen = new Map<string, number>();

  next(text: string): string {
    const base = slugify(text);
    const count = this.seen.get(base) ?? 0;
    this.seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  }
}

function escapeHtml(value: string): string {
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

function inlinePlainText(tokens: Token[] | undefined): string {
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

function decodeEntities(value: string): string {
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

function newMarked(headings?: { nonce: string; counter: SlugCounter }): Marked {
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

function walkHeadings(
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

// eslint-disable-next-line no-control-regex
const URL_CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const URL_SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const ATTACHMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Returns the (trimmed) url when it is an http/https/mailto/tel url or a relative path,
 * otherwise null. Rejects control characters (browsers strip tab/newline inside urls, which
 * is the classic `java\nscript:` bypass) and protocol-relative urls in any slash/backslash mix.
 */
function checkUrl(value: string, schemes: readonly string[]): string | null {
  if (URL_CONTROL.test(value)) return null;
  const url = value.trim();
  if (url.length === 0) return null;
  if (/^[/\\]{2}/.test(url)) return null;
  const scheme = URL_SCHEME.exec(url);
  if (scheme) return schemes.includes(scheme[1]!.toLowerCase()) ? url : null;
  return url;
}

const LINK_SCHEMES = ["http", "https", "mailto", "tel"] as const;
const IMAGE_SCHEMES = ["http", "https"] as const;
const DROP_ATTR = "data-hw-drop";
const dropped = (tagName: string) => ({
  tagName,
  attribs: { [DROP_ATTR]: "1" },
});

interface Resolvers {
  attachment: (id: string) => string | null;
  page: (slug: string) => string | null;
}

function resolveInternal(
  value: string,
  resolvers: Resolvers,
): string | null | undefined {
  const trimmed = value.trim();
  const attachment = /^attachment:(.*)$/i.exec(trimmed);
  if (attachment) {
    const id = attachment[1]!.trim();
    if (!ATTACHMENT_ID.test(id)) return null;
    return resolvers.attachment(id);
  }
  const wiki = /^wiki:(.*)$/i.exec(trimmed);
  if (wiki) {
    let slug: string;
    try {
      slug = decodeURIComponent(wiki[1]!);
    } catch {
      return null;
    }
    slug = slug.trim();
    if (slug.length === 0 || slug.length > 200 || URL_CONTROL.test(slug))
      return null;
    return resolvers.page(slug);
  }
  return undefined;
}

function buildSanitizer(nonce: string, resolvers: Resolvers) {
  const idPrefix = `hw-${nonce}-`;
  const headingTransform = (
    tagName: string,
    attribs: sanitizeHtml.Attributes,
  ) => {
    const id = attribs.id;
    const next: sanitizeHtml.Attributes = {};
    if (id && id.startsWith(idPrefix) && id.length > idPrefix.length) {
      next.id = id.slice(idPrefix.length);
    }
    return { tagName, attribs: next };
  };

  const options: sanitizeHtml.IOptions = {
    allowedTags: [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "br",
      "ul",
      "ol",
      "li",
      "code",
      "pre",
      "blockquote",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "a",
      "img",
      "hr",
      "strong",
      "em",
      "del",
      "input",
      "details",
      "summary",
    ],
    allowedAttributes: {
      h1: ["id"],
      h2: ["id"],
      h3: ["id"],
      h4: ["id"],
      h5: ["id"],
      h6: ["id"],
      a: ["href", "title", "rel", "target", DROP_ATTR],
      img: [
        "src",
        "alt",
        "title",
        "loading",
        "decoding",
        "referrerpolicy",
        DROP_ATTR,
      ],
      input: ["type", "disabled", "checked", DROP_ATTR],
      details: ["open"],
      th: [
        { name: "align", multiple: false, values: ["left", "center", "right"] },
      ],
      td: [
        { name: "align", multiple: false, values: ["left", "center", "right"] },
      ],
      ol: ["start"],
      code: ["class"],
    },
    allowedClasses: { code: ["language-*"] },
    allowedSchemes: [...LINK_SCHEMES],
    allowedSchemesByTag: { img: [...IMAGE_SCHEMES] },
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    exclusiveFilter: (frame) => {
      if (frame.attribs[DROP_ATTR] !== "1") return false;
      return frame.tag === "a" ? "excludeTag" : true;
    },
    transformTags: {
      h1: headingTransform,
      h2: headingTransform,
      h3: headingTransform,
      h4: headingTransform,
      h5: headingTransform,
      h6: headingTransform,
      ol: (tagName, attribs) => {
        const next: sanitizeHtml.Attributes = {};
        if (/^\d{1,9}$/.test(attribs.start ?? "")) next.start = attribs.start!;
        return { tagName, attribs: next };
      },
      a: (tagName, attribs) => {
        const raw = attribs.href;
        if (raw === undefined) return dropped(tagName);
        const internal = resolveInternal(raw, resolvers);
        const candidate = internal === undefined ? raw : internal;
        const href =
          candidate === null ? null : checkUrl(candidate, LINK_SCHEMES);
        if (href === null) return dropped(tagName);
        const next: sanitizeHtml.Attributes = { href };
        if (attribs.title) next.title = attribs.title;
        if (/^https?:/i.test(href)) {
          next.target = "_blank";
          next.rel = "noopener noreferrer nofollow";
        }
        return { tagName, attribs: next };
      },
      img: (tagName, attribs) => {
        const raw = attribs.src;
        if (raw === undefined) return dropped(tagName);
        const internal = resolveInternal(raw, resolvers);
        const candidate = internal === undefined ? raw : internal;
        const src =
          candidate === null ? null : checkUrl(candidate, IMAGE_SCHEMES);
        if (src === null) return dropped(tagName);
        const next: sanitizeHtml.Attributes = {
          src,
          alt: attribs.alt ?? "",
          loading: "lazy",
          decoding: "async",
          referrerpolicy: "no-referrer",
        };
        if (attribs.title) next.title = attribs.title;
        return { tagName, attribs: next };
      },
      input: (tagName, attribs) => {
        if ((attribs.type ?? "").toLowerCase() !== "checkbox")
          return dropped(tagName);
        const next: sanitizeHtml.Attributes = {
          type: "checkbox",
          disabled: "disabled",
        };
        if ("checked" in attribs) next.checked = "checked";
        return { tagName, attribs: next };
      },
    },
  };
  return (html: string) => sanitizeHtml(html, options);
}

const CALLOUT_CLASS: Record<BlockKind, string> = {
  secret: "secret",
  warning: "callout callout-warning",
  info: "callout callout-info",
};

/**
 * Renders markdown to sanitized HTML.
 *
 * - GFM (tables, task lists, strikethrough, autolinks); output restricted to a strict tag/attribute
 *   allowlist (no style, iframe, script, svg, forms, data: uris).
 * - Links: http/https/mailto/tel and relative paths only; external http(s) links get
 *   `rel="noopener noreferrer nofollow" target="_blank"`. Images: http/https and relative only.
 * - `attachment:<id>` (link or image) is rewritten via `resolveAttachmentUrl`; `[[slug]]` and
 *   `[[slug|label]]` via `resolvePageUrl`. Unresolvable images are removed, unresolvable links
 *   keep their text without a link.
 * - `:::secret` blocks are removed from the source for guests unless `includeSecrets`; members
 *   always see them wrapped in `<div class="secret">`. `:::warning` / `:::info` become
 *   `<div class="callout callout-…">`. Blocks must start at the beginning of a line (up to 3
 *   spaces); unknown `:::name` blocks are transparent. Reference-style link definitions are
 *   scoped to the segment between block markers.
 * - Heading ids are generated here (see `slugify`); ids written by authors are discarded.
 */
export function renderMarkdown(
  md: string,
  options: RenderMarkdownOptions,
): string {
  const showSecrets =
    options.audience === "member" || options.includeSecrets === true;
  const segments = splitBlocks(md, showSecrets);
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const counter = new SlugCounter();
  const marked = newMarked({ nonce, counter });
  const sanitize = buildSanitizer(nonce, {
    attachment: (id) => options.resolveAttachmentUrl?.(id) ?? null,
    page: (slug) => options.resolvePageUrl?.(slug) ?? null,
  });

  const render = (nodes: Segment[]): string => {
    let html = "";
    for (const node of nodes) {
      if (node.kind === "md") {
        html += sanitize(marked.parse(node.text, { async: false }));
      } else {
        html += `<div class="${CALLOUT_CLASS[node.type]}">${render(node.children)}</div>\n`;
      }
    }
    return html;
  };
  return render(segments);
}

/**
 * Plain text of the visible markdown for search snippets. The result is NOT html-safe: escape
 * it when displaying. Secret blocks are excluded unless `includeSecrets` is set.
 */
export function extractPlainText(
  md: string,
  options: PlainTextOptions = {},
): string {
  const marked = newMarked();
  const parts: string[] = [];
  for (const text of flattenSegments(
    splitBlocks(md, options.includeSecrets === true),
  )) {
    const html = (marked.parse(text, { async: false }) as string).replace(
      BLOCK_END,
      "$& ",
    );
    parts.push(
      sanitizeHtml(html, {
        allowedTags: [],
        allowedAttributes: {},
        nonTextTags: ["script", "style", "textarea", "option", "noscript"],
      }),
    );
  }
  const plain = decodeEntities(parts.join(" ")).replace(/\s+/g, " ").trim();
  const max = options.maxLength;
  if (max !== undefined && plain.length > max) {
    return plain.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
  }
  return plain;
}

const BLOCK_END =
  /<\/(?:p|li|h[1-6]|td|th|tr|blockquote|pre|summary|details|ul|ol|table)>|<(?:br|hr)\s*\/?>/gi;

/**
 * Headings of the visible markdown with the same ids `renderMarkdown` puts on them, for a table
 * of contents. Headings inside hidden secret blocks are not listed.
 */
export function extractHeadings(
  md: string,
  options: VisibilityOptions = {},
): Heading[] {
  const marked = newMarked();
  const counter = new SlugCounter();
  const headings: Heading[] = [];
  for (const text of flattenSegments(
    splitBlocks(md, options.includeSecrets === true),
  )) {
    walkHeadings(marked.lexer(text), (level, tokens) => {
      const plain = decodeEntities(inlinePlainText(tokens))
        .replace(/\s+/g, " ")
        .trim();
      headings.push({
        level,
        text: plain,
        id: counter.next(inlinePlainText(tokens)),
      });
    });
  }
  return headings;
}
