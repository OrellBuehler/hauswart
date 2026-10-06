import { z } from "zod";
import { COMMENT_ENTITY_TYPES } from "../../../src/lib/api/enums";
import { endpoints } from "../../../src/lib/api/registry";
import type { Comment } from "../../../src/lib/api/schemas/comments";
import { moreHint, plural } from "../format";
import { defineTool } from "../tool";

const target = {
  entityType: z
    .enum(COMMENT_ENTITY_TYPES)
    .describe(
      "What the comment is on: task, defect, asset, room, part, contact, service_log, asset_hint or doc_page",
    ),
  entityId: z
    .string()
    .min(1)
    .max(64)
    .describe("Its id (for a doc_page the `id` from get_page, not the slug)"),
};

const commentRow = (c: Comment) => ({
  id: c.id,
  by: c.author?.displayName,
  at: c.createdAt,
  text: c.deleted ? null : c.bodyMd,
  edited: c.editedAt ? true : null,
  deleted: c.deleted ? true : null,
});

export const listComments = defineTool({
  name: "list_comments",
  title: "List comments",
  description:
    "The comment thread of one task, defect, asset, room, part, contact, service log entry, care hint or documentation page, oldest first. The `commentCount` on those records tells which have one.",
  mode: "read",
  input: {
    ...target,
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(512).optional(),
  },
  async handler(args, ctx) {
    const page = await ctx.api.call(endpoints.commentsList, { query: args });
    return {
      summary: `${plural(page.items.length, "comment")}.${moreHint(page.nextCursor)}`,
      data: {
        comments: page.items.map(commentRow),
        nextCursor: page.nextCursor,
      },
    };
  },
});

export const addComment = defineTool({
  name: "add_comment",
  title: "Add a comment",
  description:
    "Writes a comment (markdown, at most 10 000 characters) on a task, defect, asset, room, part, contact, service log entry, care hint or documentation page, as the token's user. The other involved household members get a notification, so comment only when it is worth their attention.",
  mode: "create",
  input: {
    ...target,
    bodyMd: z.string().trim().min(1).max(10_000),
  },
  async handler(args, ctx) {
    const comment = await ctx.api.call(endpoints.commentsCreate, {
      body: args,
    });
    return {
      summary: `Commented on the ${args.entityType.replace("_", " ")}.`,
      data: commentRow(comment),
    };
  },
});

export const commentTools = [listComments, addComment];
