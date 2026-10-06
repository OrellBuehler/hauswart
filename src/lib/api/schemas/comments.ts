import { z } from "zod";
import { COMMENT_ENTITY_TYPES } from "../enums";
import {
  idSchema,
  isoTimestampSchema,
  paginated,
  paginationQuerySchema,
} from "./common";

export const COMMENT_MAX_LENGTH = 10_000;

export const commentEntityTypeSchema = z.enum(COMMENT_ENTITY_TYPES);

export const commentSchema = z
  .object({
    id: z.string(),
    entityType: commentEntityTypeSchema,
    entityId: z.string(),
    /** Null when the author's account no longer exists. */
    author: z.object({ id: z.string(), displayName: z.string() }).nullable(),
    /** Empty for a deleted comment. */
    bodyMd: z.string(),
    createdAt: isoTimestampSchema,
    editedAt: isoTimestampSchema.nullable(),
    /** The comment was removed; the thread keeps its place for it. */
    deleted: z.boolean(),
    /** Whether the caller may edit it (its author, while not deleted). */
    canEdit: z.boolean(),
    /** Whether the caller may delete it (its author or an administrator). */
    canDelete: z.boolean(),
  })
  .meta({ id: "Comment" });
export type Comment = z.infer<typeof commentSchema>;

/** Oldest first. */
export const listCommentsQuerySchema = paginationQuerySchema.extend({
  entityType: commentEntityTypeSchema,
  entityId: idSchema,
});
export const listCommentsResponseSchema = paginated(commentSchema);

const bodyMdSchema = z.string().trim().min(1).max(COMMENT_MAX_LENGTH);

export const createCommentRequestSchema = z.strictObject({
  entityType: commentEntityTypeSchema,
  entityId: idSchema,
  bodyMd: bodyMdSchema,
});
export type CreateCommentRequest = z.output<typeof createCommentRequestSchema>;

export const updateCommentRequestSchema = z.strictObject({
  bodyMd: bodyMdSchema,
});
export type UpdateCommentRequest = z.output<typeof updateCommentRequestSchema>;
