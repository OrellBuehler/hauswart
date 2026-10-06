import { z } from "zod";
import { HINT_KINDS } from "../enums";
import {
  atLeastOne,
  idSchema,
  isoTimestampSchema,
  paginated,
  paginationQuerySchema,
  queryBooleanSchema,
} from "./common";

export const hintKindSchema = z.enum(HINT_KINDS);

export const MAX_REACTION_DELAY_MINUTES = 1440;

/**
 * What should happen when a signal (an entity of an external system, named
 * by an opaque id) changes: after `delayMinutes`, tell `notify` about the
 * hint. Stored with the hint; an adapter carries it out.
 */
export const signalReactionSchema = z
  .strictObject({
    type: z.literal("signal_change"),
    entityId: z.string().trim().min(1).max(255),
    toState: z.string().trim().min(1).max(255),
    fromState: z.string().trim().min(1).max(255).optional(),
    delayMinutes: z
      .number()
      .int()
      .min(0)
      .max(MAX_REACTION_DELAY_MINUTES)
      .optional(),
    notify: z.union([
      z.enum(["all", "assignee"]),
      z.array(idSchema).min(1).max(20),
    ]),
  })
  .meta({ id: "SignalReaction" });
export type SignalReaction = z.infer<typeof signalReactionSchema>;

export const hintSchema = z
  .object({
    id: z.string(),
    assetId: z.string(),
    assetName: z.string(),
    title: z.string(),
    bodyMd: z.string(),
    kind: hintKindSchema,
    pinned: z.boolean(),
    sortOrder: z.number().int(),
    guestVisible: z.boolean(),
    /** A recurring task created from or linked to the hint. */
    taskId: z.string().nullable(),
    taskTitle: z.string().nullable(),
    reaction: signalReactionSchema.nullable(),
    commentCount: z.number().int(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .meta({ id: "Hint" });
export type Hint = z.infer<typeof hintSchema>;

export const listAssetHintsResponseSchema = paginated(hintSchema);

export const listHintsQuerySchema = paginationQuerySchema.extend({
  assetId: idSchema.optional(),
  /** Only hints that have a reaction. */
  reactive: queryBooleanSchema.optional(),
  kind: hintKindSchema.optional(),
});

const hintFields = {
  title: z.string().trim().min(1).max(200),
  bodyMd: z.string().max(10_000),
  kind: hintKindSchema,
  pinned: z.boolean(),
  sortOrder: z.number().int().min(0).max(100_000),
  guestVisible: z.boolean(),
  taskId: idSchema.nullable(),
  reaction: signalReactionSchema.nullable(),
};

export const createHintRequestSchema = z.strictObject({
  title: hintFields.title,
  bodyMd: hintFields.bodyMd.default(""),
  kind: hintFields.kind.default("tip"),
  pinned: hintFields.pinned.default(false),
  sortOrder: hintFields.sortOrder.optional(),
  guestVisible: hintFields.guestVisible.default(false),
  taskId: hintFields.taskId.optional(),
  reaction: hintFields.reaction.optional(),
});
export type CreateHintRequest = z.output<typeof createHintRequestSchema>;

export const updateHintRequestSchema = atLeastOne(
  z.strictObject({
    title: hintFields.title.optional(),
    bodyMd: hintFields.bodyMd.optional(),
    kind: hintFields.kind.optional(),
    pinned: hintFields.pinned.optional(),
    sortOrder: hintFields.sortOrder.optional(),
    guestVisible: hintFields.guestVisible.optional(),
    taskId: hintFields.taskId.optional(),
    reaction: hintFields.reaction.optional(),
  }),
);
export type UpdateHintRequest = z.output<typeof updateHintRequestSchema>;
