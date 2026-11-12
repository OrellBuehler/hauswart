import { z } from "zod";
import { attachmentSchema } from "./attachments";
import { httpUrlSchema, idSchema } from "./common";

export const TASK_STEP_TITLE_MAX = 200;
export const TASK_STEP_BODY_MAX = 2000;
/** The most steps one task has. */
export const MAX_TASK_STEPS = 30;
export const STEPS_SOURCE_LABEL_MAX = 200;
export const STEPS_SOURCE_URL_MAX = 2000;
/** The highest page number of a file a source can point at. */
export const STEPS_SOURCE_PAGE_MAX = 9999;

/**
 * One step of a task: what to do (`title`, one line), the detail (`body`, plain text) and its pictures,
 * which are attachments of the owner type `task_step` in the order they were uploaded.
 */
export const taskStepSchema = z
  .object({
    id: z.string(),
    /** 0-based place in the list; the steps come in this order. */
    position: z.number().int(),
    title: z.string(),
    body: z.string(),
    images: z.array(attachmentSchema),
  })
  .meta({ id: "TaskStep" });
export type TaskStep = z.infer<typeof taskStepSchema>;

/** The file of hauswart a source points at (typically the manual attached to the device). */
export const stepsSourceAttachmentSchema = z
  .object({
    id: z.string(),
    filename: z.string(),
    mime: z.string(),
    /** `GET` this for the file. */
    url: z.string(),
  })
  .meta({ id: "StepsSourceAttachment" });

/**
 * Where the steps of a task come from, for people to check them against: a page on the web (`url`) or a
 * page of a file in hauswart (`attachment`, `page`), with a `label` ("Manufacturer's instructions"). When
 * the file has been deleted meanwhile, `attachmentId`, `attachment` and `page` read as null, and when nothing
 * else is left the whole source is null.
 */
export const stepsSourceSchema = z
  .object({
    label: z.string().nullable(),
    url: z.string().nullable(),
    attachmentId: z.string().nullable(),
    page: z.number().int().nullable(),
    attachment: stepsSourceAttachmentSchema.nullable(),
  })
  .meta({ id: "StepsSource" });
export type StepsSource = z.infer<typeof stepsSourceSchema>;

/** The steps of a task as `GET /tasks/{id}` carries them and `PUT /tasks/{id}/steps` answers. */
export const taskStepsSchema = z
  .object({
    steps: z.array(taskStepSchema),
    stepsSource: stepsSourceSchema.nullable(),
    stepCount: z.number().int(),
  })
  .meta({ id: "TaskSteps" });
export type TaskSteps = z.infer<typeof taskStepsSchema>;

/**
 * A step in the list `PUT /tasks/{id}/steps` replaces. With an `id` of a step of this task it keeps that step (its
 * pictures and its creation time stay); without one a new step is made.
 */
export const taskStepInputSchema = z.strictObject({
  id: idSchema.optional(),
  title: z
    .string()
    .trim()
    .min(1)
    .max(TASK_STEP_TITLE_MAX)
    .refine((title) => !/[\r\n]/.test(title), {
      error: "A step title is one line; put the detail in the body.",
    }),
  body: z.string().trim().max(TASK_STEP_BODY_MAX).default(""),
});
export type TaskStepInput = z.output<typeof taskStepInputSchema>;

/**
 * Where the steps come from. A web address (`url`) or a file of hauswart (`attachmentId`, optionally the `page` of
 * it), not both; `label` stands with either or alone. A field that is left out or null is empty, and an object with
 * nothing in it is refused (send `source: null` to remove the source).
 */
export const stepsSourceInputSchema = z
  .strictObject({
    label: z.string().trim().min(1).max(STEPS_SOURCE_LABEL_MAX).nullish(),
    url: httpUrlSchema(STEPS_SOURCE_URL_MAX).nullish(),
    attachmentId: idSchema.nullish(),
    page: z.number().int().min(1).max(STEPS_SOURCE_PAGE_MAX).nullish(),
  })
  .superRefine((source, ctx) => {
    if (source.url != null && source.attachmentId != null) {
      ctx.addIssue({
        code: "custom",
        path: ["attachmentId"],
        message: "Give a url or an attachmentId, not both.",
      });
    }
    if (source.page != null && source.attachmentId == null) {
      ctx.addIssue({
        code: "custom",
        path: ["page"],
        message: "A page needs the attachmentId of the file it is in.",
      });
    }
    if (
      source.label == null &&
      source.url == null &&
      source.attachmentId == null
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Give a label, a url or an attachmentId; send null to remove the source.",
      });
    }
  });
export type StepsSourceInput = z.output<typeof stepsSourceInputSchema>;

export const putTaskStepsRequestSchema = z
  .strictObject({
    steps: z.array(taskStepInputSchema).max(MAX_TASK_STEPS),
    /** Left out: unchanged. `null`: removed. */
    source: stepsSourceInputSchema.nullable().optional(),
  })
  .superRefine((request, ctx) => {
    const seen = new Set<string>();
    for (const [index, step] of request.steps.entries()) {
      if (step.id === undefined) continue;
      if (seen.has(step.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", index, "id"],
          message: "The same step is listed twice.",
        });
      }
      seen.add(step.id);
    }
  });
export type PutTaskStepsRequest = z.output<typeof putTaskStepsRequestSchema>;
