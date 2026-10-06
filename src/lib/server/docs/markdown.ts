import sanitizeHtml from "sanitize-html";
import {
  MAX_MARKDOWN_BYTES,
  MAX_SYNC_MARKDOWN_BYTES,
  MarkdownError,
  decodeEntities,
  headingsOfSegments,
  plainTextOfSegments,
  renderSegments,
  type Heading,
} from "./markdown-core";
import { RENDER_TIMEOUT_MS, runMarkdownJob } from "./markdown-runner";

export {
  MAX_MARKDOWN_BYTES,
  MAX_NESTING_DEPTH,
  MAX_SYNC_MARKDOWN_BYTES,
  MarkdownError,
  slugify,
  type Heading,
  type MarkdownErrorCode,
} from "./markdown-core";
export { RENDER_TIMEOUT_MS } from "./markdown-runner";

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

export interface AsyncOptions {
  /** Abandon the worker job after this long (default `RENDER_TIMEOUT_MS`). */
  timeoutMs?: number;
}

type BlockKind = "secret" | "warning" | "info";

type Segment =
  | { kind: "md"; text: string }
  | { kind: "block"; type: BlockKind; children: Segment[] };

const MAX_BLOCK_DEPTH = 8;
const BLOCK_KINDS: ReadonlySet<string> = new Set(["secret", "warning", "info"]);

interface Fence {
  char: string;
  length: number;
}

interface Frame {
  type: BlockKind | "flat" | "root";
  hidden: boolean;
  children: Segment[];
  buffer: string[];
  /** For a fail-closed secret frame: the fence state outside it, restored when it closes. */
  outerFence?: Fence | null;
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
 * Fail-closed secret marker: `:::secret` after any mix of whitespace, blockquote markers and list
 * markers, followed by anything (`:::secretive`, `:::secrets`, `:::secret-notes`, ...).
 */
const SECRET_MARKER = /^(?:[\s>]|(?:[-*+]|\d{1,9}[.)])(?=\s))*:{3,}\s*secret/i;

/**
 * Splits markdown into plain markdown segments and `:::kind` container blocks.
 *
 * Secret handling is fail-closed: when secrets are not visible, any line that starts with
 * `:::secret` (after whitespace, blockquote or list markers; whatever follows on the line, so
 * `:::secretive` and `:::secret-notes` count) opens a secret block regardless of fence or html
 * block state, an unclosed block runs to the end of the document, and the block (including
 * nested blocks) is dropped from the source before any markdown parsing happens, so its content
 * can never reach the output, the plain text or the headings. Closing a secret needs a bare
 * `:::` line at the block's own level. Fences (``` / ~~~) are honoured so `:::` inside code is
 * literal, but never outside a secret to decide whether a secret starts. Members (secrets
 * visible) get the plain behaviour: only `:::secret` at the start of a line outside fences opens
 * a block.
 */
function splitBlocks(md: string, showSecrets: boolean): Segment[] {
  const root: Frame = { type: "root", hidden: false, children: [], buffer: [] };
  const stack: Frame[] = [root];
  let fence: Fence | null = null;
  let wrapperDepth = 0;

  const top = () => stack[stack.length - 1]!;

  for (const line of md.replace(/\r\n?/g, "\n").split("\n")) {
    const current = top();

    // Fail closed: whatever the fence or html-block state says, a secret marker hides the
    // rest of the block. Fence state inside it starts fresh and is restored after it.
    if (!showSecrets && !current.hidden && SECRET_MARKER.test(line)) {
      stack.push({
        type: "flat",
        hidden: true,
        children: [],
        buffer: [],
        outerFence: fence,
      });
      fence = null;
      continue;
    }

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
      if (frame.outerFence !== undefined) fence = frame.outerFence;
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

function byteLength(md: string): number {
  return Buffer.byteLength(md, "utf8");
}

function checkSize(md: string, max: number): void {
  // Cheap bound first: a string of N chars is at most 3N bytes.
  if (md.length * 3 <= max || byteLength(md) <= max) return;
  throw new MarkdownError("too_large", `Markdown exceeds ${max} bytes`);
}

function isShown(options: VisibilityOptions & { audience?: MarkdownAudience }) {
  return options.audience === "member" || options.includeSecrets === true;
}

/** The markdown texts of a segment tree, in document order. */
function collectTexts(segments: Segment[]): string[] {
  return flattenSegments(segments);
}

function assemble(
  segments: Segment[],
  htmls: string[],
  sanitize: (html: string) => string,
): string {
  let next = 0;
  const render = (nodes: Segment[]): string => {
    let out = "";
    for (const node of nodes) {
      if (node.kind === "md") out += sanitize(htmls[next++]!);
      else
        out += `<div class="${CALLOUT_CLASS[node.type]}">${render(node.children)}</div>\n`;
    }
    return out;
  };
  return render(segments);
}

function prepareRender(md: string, options: RenderMarkdownOptions) {
  const segments = splitBlocks(md, isShown(options));
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const sanitize = buildSanitizer(nonce, {
    attachment: (id) => options.resolveAttachmentUrl?.(id) ?? null,
    page: (slug) => options.resolvePageUrl?.(slug) ?? null,
  });
  return { segments, nonce, texts: collectTexts(segments), sanitize };
}

function joinPlainText(parts: string[], options: PlainTextOptions): string {
  const plain = decodeEntities(parts.join(" ")).replace(/\s+/g, " ").trim();
  const max = options.maxLength;
  if (max !== undefined && plain.length > max) {
    return plain.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
  }
  return plain;
}

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
 * - `:::secret` blocks are removed from the source for guests unless `includeSecrets`, failing
 *   closed (see `splitBlocks`); members always see them wrapped in `<div class="secret">`.
 *   `:::warning` / `:::info` become `<div class="callout callout-…">`. Blocks must start at the
 *   beginning of a line (up to 3 spaces); unknown `:::name` blocks are transparent. Reference-style
 *   link definitions are scoped to the segment between block markers.
 * - Heading ids are generated here (`h-` + `slugify`); ids written by authors are discarded.
 * - Parsing cost: marked is quadratic on some inputs (unmatched emphasis delimiters) and
 *   recursive on nested quotes and lists. Lines nested deeper than `MAX_NESTING_DEPTH` levels
 *   are rendered as plain paragraph text (their first marker is escaped); a segment that still
 *   overflows the stack is shown as escaped plain text in a `<pre>`.
 *
 * This synchronous variant runs on the calling thread and therefore only accepts input up to
 * `MAX_SYNC_MARKDOWN_BYTES` (worst case a few tens of milliseconds); larger input throws
 * `MarkdownError('too_large')`. Use `renderMarkdownAsync` for documents.
 */
export function renderMarkdown(
  md: string,
  options: RenderMarkdownOptions,
): string {
  checkSize(md, MAX_SYNC_MARKDOWN_BYTES);
  const { segments, nonce, texts, sanitize } = prepareRender(md, options);
  return assemble(segments, renderSegments(texts, nonce), sanitize);
}

/**
 * Same output as `renderMarkdown` for documents up to `MAX_MARKDOWN_BYTES`. The marked pass runs
 * in a worker thread with a timeout (`MarkdownError('too_complex')`, worker terminated and
 * replaced); secrets are stripped on the calling thread first, so the worker never sees them.
 * Rejects with `MarkdownError('too_large')` above the cap and `'unavailable'` when no worker can
 * run.
 */
export async function renderMarkdownAsync(
  md: string,
  options: RenderMarkdownOptions & AsyncOptions,
): Promise<string> {
  checkSize(md, MAX_MARKDOWN_BYTES);
  const { segments, nonce, texts, sanitize } = prepareRender(md, options);
  if (texts.length === 0) return assemble(segments, [], sanitize);
  const htmls = await runMarkdownJob<string[]>(
    { op: "render", segments: texts, nonce },
    options.timeoutMs ?? RENDER_TIMEOUT_MS,
  );
  return assemble(segments, htmls, sanitize);
}

/**
 * Plain text of the visible markdown for search snippets. The result is NOT html-safe: escape
 * it when displaying. Secret blocks are excluded unless `includeSecrets` is set. Synchronous and
 * bounded like `renderMarkdown`; use `extractPlainTextAsync` for documents.
 */
export function extractPlainText(
  md: string,
  options: PlainTextOptions = {},
): string {
  checkSize(md, MAX_SYNC_MARKDOWN_BYTES);
  const texts = collectTexts(splitBlocks(md, options.includeSecrets === true));
  return joinPlainText(plainTextOfSegments(texts), options);
}

export async function extractPlainTextAsync(
  md: string,
  options: PlainTextOptions & AsyncOptions = {},
): Promise<string> {
  checkSize(md, MAX_MARKDOWN_BYTES);
  const texts = collectTexts(splitBlocks(md, options.includeSecrets === true));
  if (texts.length === 0) return "";
  const parts = await runMarkdownJob<string[]>(
    { op: "text", segments: texts },
    options.timeoutMs ?? RENDER_TIMEOUT_MS,
  );
  return joinPlainText(parts, options);
}

/**
 * Headings of the visible markdown with the same ids `renderMarkdown` puts on them, for a table
 * of contents. Headings inside hidden secret blocks are not listed. Synchronous and bounded like
 * `renderMarkdown`; use `extractHeadingsAsync` for documents.
 */
export function extractHeadings(
  md: string,
  options: VisibilityOptions = {},
): Heading[] {
  checkSize(md, MAX_SYNC_MARKDOWN_BYTES);
  const texts = collectTexts(splitBlocks(md, options.includeSecrets === true));
  return headingsOfSegments(texts);
}

export async function extractHeadingsAsync(
  md: string,
  options: VisibilityOptions & AsyncOptions = {},
): Promise<Heading[]> {
  checkSize(md, MAX_MARKDOWN_BYTES);
  const texts = collectTexts(splitBlocks(md, options.includeSecrets === true));
  if (texts.length === 0) return [];
  return runMarkdownJob<Heading[]>(
    { op: "headings", segments: texts },
    options.timeoutMs ?? RENDER_TIMEOUT_MS,
  );
}
