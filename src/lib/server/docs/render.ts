import { slugify } from "$lib/server/slug";
import { attachmentsById } from "$lib/server/attachments/attachments";
import type { ServiceContext } from "$lib/server/service";
import {
  extractHeadingsAsync,
  extractPlainTextAsync,
  renderMarkdownAsync,
  type Heading,
} from "./markdown";

type Db = Pick<ServiceContext, "db">;

/**
 * Where `{token}` goes in the cached guest HTML. The guest link's token is not known when a page
 * is saved, so links in `renderedHtmlGuest` carry this literal placeholder and the guest route
 * substitutes the token of the request with `fillGuestToken` when it serves the page. Guest
 * links: attachments `/g/{token}/files/<attachmentId>` (only attachments marked guest visible
 * resolve; the images of the others are removed), pages `/g/{token}/docs/<slug>`.
 */
export const GUEST_TOKEN_PLACEHOLDER = "{token}";

export function fillGuestToken(html: string, token: string): string {
  return html.replaceAll(GUEST_TOKEN_PLACEHOLDER, encodeURIComponent(token));
}

export const memberAttachmentUrl = (id: string) =>
  `/api/v1/attachments/${id}/content`;
export const guestAttachmentUrl = (id: string) =>
  `/g/${GUEST_TOKEN_PLACEHOLDER}/files/${id}`;
export const memberPageUrl = (slug: string) => `/docs/${slug}`;
export const guestPageUrl = (slug: string) =>
  `/g/${GUEST_TOKEN_PLACEHOLDER}/docs/${slug}`;

const ATTACHMENT_REF = /attachment:([A-Za-z0-9_-]{1,64})/gi;
// Same shape the markdown renderer accepts for a wiki link.
const WIKI_LINK = /\[\[([^[\]\n|]{1,200}?)(?:\|[^[\]\n]{1,200}?)?\]\]/g;
const MENTIONS_SECRET = /secret/i;

/** Ids of the attachments the markdown links or embeds with `attachment:<id>`. */
export function referencedAttachmentIds(md: string): string[] {
  return [...new Set([...md.matchAll(ATTACHMENT_REF)].map((m) => m[1]!))];
}

/** Page slugs the markdown links to with `[[slug]]` or `[[slug|label]]`, as the renderer reads them. */
export function wikiLinkSlugs(md: string): string[] {
  const slugs = new Set<string>();
  for (const match of md.matchAll(WIKI_LINK)) {
    const target = match[1]!.trim();
    if (target.length > 0) slugs.add(slugify(target));
  }
  return [...slugs];
}

export interface RenderedPage {
  memberHtml: string;
  guestHtml: string;
  /** Without secret blocks. */
  plainText: string;
  headings: { member: Heading[]; guest: Heading[] };
}

/**
 * Renders a page for both audiences. Everything goes through the worker-backed markdown
 * functions (`MarkdownError` `too_large` / `too_complex` / `unavailable` propagate), one job at a
 * time so a single save never occupies the whole queue. Attachment links resolve only to
 * attachments that exist; the guest rendering additionally needs them to be guest visible.
 */
export async function renderPageContent(
  ctx: Db,
  md: string,
): Promise<RenderedPage> {
  const known = attachmentsById(ctx, referencedAttachmentIds(md));
  const memberHtml = await renderMarkdownAsync(md, {
    audience: "member",
    resolveAttachmentUrl: (id) =>
      known.has(id) ? memberAttachmentUrl(id) : null,
    resolvePageUrl: (slug) => memberPageUrl(slugify(slug)),
  });
  const guestHtml = await renderMarkdownAsync(md, {
    audience: "guest",
    resolveAttachmentUrl: (id) =>
      known.get(id)?.guestVisible ? guestAttachmentUrl(id) : null,
    resolvePageUrl: (slug) => guestPageUrl(slugify(slug)),
  });
  const plainText = await extractPlainTextAsync(md);
  const member = await extractHeadingsAsync(md, { includeSecrets: true });
  // Without a mention of "secret" nothing can have been hidden: the guest sees the same headings.
  const guest = MENTIONS_SECRET.test(md)
    ? await extractHeadingsAsync(md)
    : member;
  return {
    memberHtml,
    guestHtml,
    plainText,
    headings: { member, guest },
  };
}

/** What the editor preview shows: the member rendering and its headings. */
export async function renderPreview(
  ctx: Db,
  md: string,
): Promise<{ html: string; headings: Heading[] }> {
  const known = attachmentsById(ctx, referencedAttachmentIds(md));
  const html = await renderMarkdownAsync(md, {
    audience: "member",
    resolveAttachmentUrl: (id) =>
      known.has(id) ? memberAttachmentUrl(id) : null,
    resolvePageUrl: (slug) => memberPageUrl(slugify(slug)),
  });
  const headings = await extractHeadingsAsync(md, { includeSecrets: true });
  return { html, headings };
}
