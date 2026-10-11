import { z } from "zod";
import {
  DOCUMENT_LINK_OWNER_TYPES,
  DOCUMENT_LINK_ROLES,
  DOCUMENT_PROVIDERS,
  type DocumentLinkOwnerType,
} from "../../../src/lib/api/enums";
import { isApiError } from "../../../src/lib/api/errors";
import { endpoints } from "../../../src/lib/api/registry";
import type {
  DocumentLink,
  ExternalDocument,
} from "../../../src/lib/api/schemas/documents";
import type { ToolContext } from "../context";
import { ToolError } from "../errors";
import { moreHint, plural } from "../format";
import { defineTool } from "../tool";
import { resolveContact, resolvePart, resolvePolicy } from "./resolve";

const PROVIDER = DOCUMENT_PROVIDERS[0];

const NO_SYSTEM =
  "The token's user has not connected a document system (Settings > Integrations), or it is switched off. Documents are read with each person's own account.";

const NOT_VISIBLE =
  "No such document: it does not exist, or the token user's account in the document system may not see it.";

const documentId = z
  .number()
  .int()
  .positive()
  .describe(
    "The document's id in the document system (`id` from search_documents)",
  );

const ownerTarget = {
  ownerType: z
    .enum(DOCUMENT_LINK_OWNER_TYPES)
    .describe(
      "What the document is linked to: asset, room, page, task, defect, service_log, part, contact, cost or insurance_policy",
    ),
  owner: z
    .string()
    .min(1)
    .max(160)
    .describe(
      "Its id. For an asset, room, part, contact or insurance policy the name works too (a policy also by its policy number), for a page its slug",
    ),
};

const same = (a: string | null | undefined, b: string) =>
  a?.trim().toLowerCase() === b.trim().toLowerCase();

/** The id of the thing a document is linked to; names are accepted where the API can search them. */
async function resolveOwner(
  ctx: ToolContext,
  type: DocumentLinkOwnerType,
  ref: string,
): Promise<string> {
  switch (type) {
    case "asset":
      return (await ctx.resolveAsset(ref)).id;
    case "room":
      return (await ctx.resolveRoom(ref)).id;
    case "part":
      return (await resolvePart(ctx, ref)).id;
    case "contact":
      return (await resolveContact(ctx, ref)).id;
    case "insurance_policy":
      return (await resolvePolicy(ctx, ref)).id;
    case "page": {
      const page = await ctx.api.call(endpoints.pagesGet, {
        params: { slug: ref },
      });
      return page.id;
    }
    default:
      return ref;
  }
}

/** The id of a tag or correspondent of the document system, given as its name (or its number). */
async function resolveNamed(
  ctx: ToolContext,
  what: "tag" | "correspondent",
  ref: string,
): Promise<number> {
  const params = { kind: PROVIDER };
  const query = { q: ref };
  const { items } =
    what === "tag"
      ? await ctx.api.call(endpoints.integrationsTags, { params, query })
      : await ctx.api.call(endpoints.integrationsCorrespondents, {
          params,
          query,
        });
  const exact = items.filter((item) => same(item.name, ref));
  const hits = exact.length > 0 ? exact : items;
  if (hits.length === 1) return hits[0].id;
  if (hits.length > 1) {
    throw new ToolError(
      "invalid_request",
      `${what} "${ref}" is ambiguous; use the id. Candidates: ${hits.map((h) => `${h.name} (${h.id})`).join(", ")}`,
    );
  }
  if (/^\d+$/.test(ref)) return Number(ref);
  throw new ToolError("not_found", `No ${what} named "${ref}".`);
}

/** A 404 from the document endpoints means no connection, or a document the user's account cannot see: say which. */
async function withSystem<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (isApiError(err) && err.code === "not_found") {
      if (/^document /i.test(err.message)) {
        throw new ToolError("not_found", NOT_VISIBLE);
      }
      if (/^connection /i.test(err.message)) {
        throw new ToolError("not_found", NO_SYSTEM);
      }
    }
    throw err;
  }
}

const usage = (link: ExternalDocument["linkedTo"][number]) => ({
  linkId: link.linkId,
  type: link.ownerType,
  id: link.ownerId,
  title: link.ownerTitle,
  url: link.ownerUrl,
  role: link.role,
});

const documentRow = (d: ExternalDocument) => ({
  id: d.externalId,
  title: d.title,
  date: d.createdDate,
  correspondent: d.correspondentName,
  tags: d.tagNames.length > 0 ? d.tagNames : null,
  pages: d.pageCount,
  notes: d.noteCount > 0 ? d.noteCount : null,
  warrantyUntil: d.warrantyUntil,
  warrantyExtendedUntil: d.warrantyExtendedUntil,
  usedIn: d.linkedTo.length > 0 ? d.linkedTo.map(usage) : null,
});

const linkRow = (l: DocumentLink) => ({
  id: l.id,
  documentId: l.externalId,
  title: l.document?.title,
  notShared: l.available ? null : true,
  date: l.document?.createdDate,
  correspondent: l.document?.correspondentName,
  pages: l.document?.pageCount,
  role: l.role,
  label: l.label,
  ownerType: l.ownerType,
  ownerId: l.ownerId,
  ownerTitle: l.ownerTitle,
  ownerUrl: l.ownerUrl,
});

export const searchDocuments = defineTool({
  name: "search_documents",
  title: "Search archived documents",
  description:
    "Invoices, receipts, manuals and letters in the token user's own document system (Paperless-ngx); everybody reads with their own account, so another person's private documents never show. With q the title and the text of the documents are searched live (at most 100 hits); without it the household's synced documents are listed, newest first. Filter by tag or correspondent (name or id) and by linked: true (used somewhere in hauswart) or false (not linked yet). Each document says where hauswart uses it (usedIn). Link one with link_document, read one with get_document. The search tool also finds documents that are already linked, by title.",
  mode: "read",
  input: {
    q: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe("Words in the title or the text of the document"),
    tag: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe("Tag name or id"),
    correspondent: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe("Correspondent name or id"),
    linked: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).max(512).optional(),
  },
  async handler(args, ctx) {
    const page = await withSystem(async () => {
      const [tag, correspondent] = await Promise.all([
        args.tag ? resolveNamed(ctx, "tag", args.tag) : undefined,
        args.correspondent
          ? resolveNamed(ctx, "correspondent", args.correspondent)
          : undefined,
      ]);
      return ctx.api.call(endpoints.documentsList, {
        query: {
          q: args.q,
          tag,
          correspondent,
          linked:
            args.linked === undefined
              ? undefined
              : args.linked
                ? "true"
                : "false",
          cursor: args.cursor,
          limit: args.limit,
        },
      });
    });
    return {
      summary: `${plural(page.items.length, "document")}.${moreHint(page.nextCursor)}`,
      data: {
        documents: page.items.map(documentRow),
        nextCursor: page.nextCursor,
      },
    };
  },
});

export const getDocument = defineTool({
  name: "get_document",
  title: "Get an archived document",
  description:
    "One document of the token user's document system: title, date, correspondent, tags, pages, number of notes, warranty dates, the address of the document in the document system (webUrl) and every place hauswart links it to (links, with the link id unlink_document needs). Asked live with the user's own account: a document that account cannot see is not_found. The file itself is not transferred.",
  mode: "read",
  input: { documentId },
  async handler({ documentId: id }, ctx) {
    const doc = await withSystem(() =>
      ctx.api.call(endpoints.documentsGet, {
        params: { provider: PROVIDER, externalId: id },
      }),
    );
    return {
      summary: `${doc.title}${doc.correspondentName ? `, ${doc.correspondentName}` : ""}.`,
      data: {
        ...documentRow(doc),
        webUrl: doc.webUrl,
        links: doc.links.map(linkRow),
      },
    };
  },
});

export const listDocumentLinks = defineTool({
  name: "list_document_links",
  title: "List document links",
  description:
    "The links between archived documents and things in hauswart. Pass ownerType and owner to see the documents of one asset, room, page, task, defect, service log entry, part, contact, cost entry or insurance policy (manuals, receipts, invoices, correspondence, policies), or documentId to see where one document is used. Without any of them all links are listed, newest first. A document the token user's own account cannot read shows as notShared, without a title. Each link has the role (manual, receipt, warranty, datasheet, correspondence, invoice, policy, registration, other) and an optional label.",
  mode: "read",
  input: {
    ownerType: ownerTarget.ownerType.optional(),
    owner: ownerTarget.owner.optional(),
    documentId: documentId.optional(),
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(512).optional(),
  },
  async handler(args, ctx) {
    if ((args.ownerType === undefined) !== (args.owner === undefined)) {
      throw new ToolError(
        "invalid_request",
        "Pass ownerType and owner together.",
      );
    }
    const ownerId =
      args.ownerType && args.owner
        ? await resolveOwner(ctx, args.ownerType, args.owner)
        : undefined;
    const page = await ctx.api.call(endpoints.documentLinksList, {
      query: {
        ownerType: args.ownerType,
        ownerId,
        ...(args.documentId
          ? { provider: PROVIDER, externalId: args.documentId }
          : {}),
        cursor: args.cursor,
        limit: args.limit,
      },
    });
    return {
      summary: `${plural(page.items.length, "link")}.${moreHint(page.nextCursor)}`,
      data: { links: page.items.map(linkRow), nextCursor: page.nextCursor },
    };
  },
});

export const linkDocument = defineTool({
  name: "link_document",
  title: "Link a document",
  description:
    "Links an archived document to an asset, room, page, task, defect, service log entry, part, contact or cost entry, so it shows up there (the document itself stays where it is). role says what it is for: manual, receipt, warranty, datasheet, correspondence, invoice or other (default). A receipt or warranty document on an asset fills the asset's warranty dates when they are empty or came from a document. The token user's own account must be able to read the document (find the id with search_documents); linking the same document to the same thing with the same role twice is a conflict. Linking to a documentation page also needs the docs:write scope.",
  mode: "create",
  input: {
    documentId,
    ...ownerTarget,
    role: z.enum(DOCUMENT_LINK_ROLES).default("other"),
    label: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe('A short note, for example "page 3" or "till receipt"'),
  },
  async handler(args, ctx) {
    const ownerId = await resolveOwner(ctx, args.ownerType, args.owner);
    const link = await withSystem(() =>
      ctx.api.call(endpoints.documentLinksCreate, {
        body: {
          provider: PROVIDER,
          externalId: args.documentId,
          ownerType: args.ownerType,
          ownerId,
          role: args.role,
          label: args.label,
        },
      }),
    );
    return {
      summary: `Linked "${link.document?.title ?? `document ${link.externalId}`}" to ${link.ownerType.replace("_", " ")} "${link.ownerTitle ?? link.ownerId}" as ${link.role}.`,
      data: linkRow(link),
    };
  },
});

export const unlinkDocument = defineTool({
  name: "unlink_document",
  title: "Remove a document link",
  description:
    "Removes one link between a document and a thing in hauswart (the id comes from list_document_links or get_document). Only the link goes: the document stays in the document system, and an asset keeps the warranty dates it took from it. Linking to a documentation page needs docs:write to undo as well.",
  mode: "undo",
  input: {
    linkId: z.string().min(1).max(64).describe("The link's `id`"),
  },
  async handler({ linkId }, ctx) {
    await ctx.api.call(endpoints.documentLinksDelete, {
      params: { id: linkId },
    });
    return { summary: "Link removed.", data: { removed: linkId } };
  },
});

export const documentTools = [
  searchDocuments,
  getDocument,
  listDocumentLinks,
  linkDocument,
  unlinkDocument,
];
