import { z } from "zod";
import {
  ASSIGN_MODES,
  COMPLETION_KINDS,
  COMPLETION_SOURCES,
  DUE_KINDS,
  DUE_REASONS,
  DUE_STATUSES,
  NOTIFY_MODES,
  PREPARATION_KINDS,
  PREPARATION_STATES,
  ROTATION_STRATEGIES,
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  TASK_SOURCES,
} from "../enums";
import { conditionOpSchema, triggerSchema } from "../../tasks/engine/types";
import {
  completionServiceLogSchema,
  serviceLogEntrySchema,
} from "./service-log";
import {
  atLeastOne,
  dateSchema,
  idSchema,
  isoTimestampSchema,
  nullableText,
  paginated,
  paginationQuerySchema,
  queryBooleanSchema,
} from "./common";

export const TASK_TITLE_MAX = 200;
export const MAX_ROTATION_USERS = 20;
export const UNDO_WINDOW_DAYS = 7;
export const RECENT_COMPLETIONS_IN_DETAIL = 20;

export const taskCategorySchema = z.enum(TASK_CATEGORIES);
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);
export const assignModeSchema = z.enum(ASSIGN_MODES);
export const rotationStrategySchema = z.enum(ROTATION_STRATEGIES);
export const notifyModeSchema = z.enum(NOTIFY_MODES);
export const taskSourceSchema = z.enum(TASK_SOURCES);
export const dueStatusSchema = z.enum(DUE_STATUSES);
export const completionSourceSchema = z.enum(COMPLETION_SOURCES);

/** The engine's trigger union, shared by editor, API and engine. */
export const triggerWireSchema = triggerSchema.meta({ id: "Trigger" });

export const progressSchema = z.object({
  current: z.number(),
  target: z.number(),
  unit: z.string().optional(),
});

export const estimateSchema = z.object({
  date: dateSchema,
  confidence: z.enum(["low", "medium"]),
});

/** What the engine says about one task right now; also the preview response. */
export const dueResultSchema = z
  .object({
    status: dueStatusSchema,
    dueDate: dateSchema.nullable(),
    dueKind: z.enum(DUE_KINDS),
    windowStart: dateSchema.optional(),
    occurrenceKey: z.string(),
    progress: progressSchema.optional(),
    estimate: estimateSchema.optional(),
    missedCount: z.number().int().optional(),
    reasons: z.array(z.enum(DUE_REASONS)),
  })
  .meta({ id: "DueResult" });
export type DueResultWire = z.infer<typeof dueResultSchema>;

export const taskStateSchema = z
  .object({
    status: dueStatusSchema,
    dueDate: dateSchema.nullable(),
    dueKind: z.enum(DUE_KINDS),
    occurrenceKey: z.string(),
    windowStart: dateSchema.nullable(),
    progress: progressSchema.nullable(),
    estimate: estimateSchema.nullable(),
    missedCount: z.number().int(),
    reasons: z.array(z.enum(DUE_REASONS)),
    currentAssigneeUserId: z.string().nullable(),
    evaluatedAt: isoTimestampSchema,
  })
  .meta({ id: "TaskState" });
export type TaskState = z.infer<typeof taskStateSchema>;

export const taskSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    descriptionMd: z.string(),
    category: taskCategorySchema,
    priority: taskPrioritySchema,
    effortMinutes: z.number().int().nullable(),
    assetId: z.string().nullable(),
    assetName: z.string().nullable(),
    roomId: z.string().nullable(),
    roomName: z.string().nullable(),
    trigger: triggerWireSchema,
    assignMode: assignModeSchema,
    assigneeUserId: z.string().nullable(),
    rotationOrder: z.array(z.string()),
    rotationStrategy: rotationStrategySchema,
    notifyMode: notifyModeSchema,
    graceDays: z.number().int(),
    dueSoonDays: z.number().int().nullable(),
    snoozedUntil: dateSchema.nullable(),
    archivedAt: isoTimestampSchema.nullable(),
    source: taskSourceSchema,
    externalSource: z.string().nullable(),
    externalRef: z.string().nullable(),
    externalUrl: z.string().nullable(),
    createdBy: z.string().nullable(),
    commentCount: z.number().int(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    state: taskStateSchema.nullable(),
  })
  .meta({ id: "Task" });
export type Task = z.infer<typeof taskSchema>;

export const completionSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    taskTitle: z.string(),
    kind: z.enum(COMPLETION_KINDS),
    source: completionSourceSchema,
    completedAt: isoTimestampSchema,
    completedDate: dateSchema,
    userId: z.string().nullable(),
    userName: z.string().nullable(),
    counterValue: z.number().nullable(),
    occurrenceKey: z.string().nullable(),
    dueDateAtCompletion: dateSchema.nullable(),
    note: z.string().nullable(),
    revokedAt: isoTimestampSchema.nullable(),
    createdAt: isoTimestampSchema,
  })
  .meta({ id: "Completion" });
export type Completion = z.infer<typeof completionSchema>;

export const leadValueSchema = z.object({
  entityId: z.string().min(1).max(255),
  op: conditionOpSchema,
  value: z.union([z.string().max(255), z.number()]),
});
export type LeadValue = z.infer<typeof leadValueSchema>;

export const preparationSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    title: z.string(),
    kind: z.enum(PREPARATION_KINDS),
    leadDays: z.number().int().nullable(),
    leadValue: leadValueSchema.nullable(),
    partId: z.string().nullable(),
    qty: z.number().int(),
    sortOrder: z.number().int(),
    state: z.enum(PREPARATION_STATES),
  })
  .meta({ id: "Preparation" });
export type Preparation = z.infer<typeof preparationSchema>;

export const taskDetailSchema = taskSchema
  .extend({
    preparations: z.array(preparationSchema),
    recentCompletions: z.array(completionSchema),
  })
  .meta({ id: "TaskDetail" });
export type TaskDetail = z.infer<typeof taskDetailSchema>;

export const listTasksQuerySchema = paginationQuerySchema.extend({
  status: dueStatusSchema.optional(),
  category: taskCategorySchema.optional(),
  assetId: idSchema.optional(),
  roomId: idSchema.optional(),
  /** `me` or a user id. Matches the current assignee (rotation included). */
  assignee: z.string().min(1).max(64).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  includeArchived: queryBooleanSchema.optional(),
  externalSource: z.string().min(1).max(64).optional(),
  externalRef: z.string().min(1).max(255).optional(),
});
export const listTasksResponseSchema = paginated(taskSchema);

const taskFields = {
  title: z.string().trim().min(1).max(TASK_TITLE_MAX),
  descriptionMd: z.string().max(50_000),
  category: taskCategorySchema,
  priority: taskPrioritySchema,
  effortMinutes: z.number().int().min(1).max(10_080).nullable(),
  assetId: idSchema.nullable(),
  roomId: idSchema.nullable(),
  trigger: triggerSchema,
  assignMode: assignModeSchema,
  assigneeUserId: idSchema.nullable(),
  rotationOrder: z.array(idSchema).max(MAX_ROTATION_USERS),
  rotationStrategy: rotationStrategySchema,
  notifyMode: notifyModeSchema,
  graceDays: z.number().int().min(0).max(365),
  dueSoonDays: z.number().int().min(0).max(365).nullable(),
  externalSource: z.string().trim().min(1).max(64).nullable(),
  externalRef: z.string().trim().min(1).max(255).nullable(),
  externalUrl: nullableText(2048),
};

const externalPair = (v: {
  externalSource?: string | null;
  externalRef?: string | null;
}) =>
  ((v.externalSource ?? null) === null) === ((v.externalRef ?? null) === null);

export const createTaskRequestSchema = z
  .strictObject({
    title: taskFields.title,
    descriptionMd: taskFields.descriptionMd.default(""),
    category: taskFields.category.default("other"),
    priority: taskFields.priority.default("normal"),
    effortMinutes: taskFields.effortMinutes.optional(),
    assetId: taskFields.assetId.optional(),
    roomId: taskFields.roomId.optional(),
    trigger: taskFields.trigger,
    assignMode: taskFields.assignMode.default("none"),
    assigneeUserId: taskFields.assigneeUserId.optional(),
    rotationOrder: taskFields.rotationOrder.default([]),
    rotationStrategy: taskFields.rotationStrategy.default("alternate"),
    notifyMode: taskFields.notifyMode.default("assignee"),
    graceDays: taskFields.graceDays.default(0),
    dueSoonDays: taskFields.dueSoonDays.optional(),
    source: taskSourceSchema.default("manual"),
    externalSource: taskFields.externalSource.optional(),
    externalRef: taskFields.externalRef.optional(),
    externalUrl: taskFields.externalUrl.optional(),
  })
  .refine(externalPair, {
    error: "externalSource and externalRef go together.",
    path: ["externalRef"],
  });
export type CreateTaskRequest = z.output<typeof createTaskRequestSchema>;

export const updateTaskRequestSchema = atLeastOne(
  z.strictObject({
    title: taskFields.title.optional(),
    descriptionMd: taskFields.descriptionMd.optional(),
    category: taskFields.category.optional(),
    priority: taskFields.priority.optional(),
    effortMinutes: taskFields.effortMinutes.optional(),
    assetId: taskFields.assetId.optional(),
    roomId: taskFields.roomId.optional(),
    trigger: taskFields.trigger.optional(),
    assignMode: taskFields.assignMode.optional(),
    assigneeUserId: taskFields.assigneeUserId.optional(),
    rotationOrder: taskFields.rotationOrder.optional(),
    rotationStrategy: taskFields.rotationStrategy.optional(),
    notifyMode: taskFields.notifyMode.optional(),
    graceDays: taskFields.graceDays.optional(),
    dueSoonDays: taskFields.dueSoonDays.optional(),
    externalUrl: taskFields.externalUrl.optional(),
    archived: z.boolean().optional(),
  }),
);
export type UpdateTaskRequest = z.output<typeof updateTaskRequestSchema>;

export const previewTaskRequestSchema = z.strictObject({
  trigger: triggerSchema,
  graceDays: taskFields.graceDays.optional(),
  dueSoonDays: z.number().int().min(0).max(365).optional(),
  /** Evaluate as of this date instead of today. */
  today: dateSchema.optional(),
});

export const completeTaskRequestSchema = z.strictObject({
  note: nullableText(2000).optional(),
  /** Which occurrence this settles; defaults to the one currently shown. */
  occurrenceKey: z.string().min(1).max(64).optional(),
  /** When it was done (backdating); defaults to now, never in the future. */
  completedAt: isoTimestampSchema.optional(),
  /** Repeating a request with the same key returns the first result. */
  idempotencyKey: z.string().min(8).max(128).optional(),
  /** Browser sessions only; API tokens are attributed by their kind. */
  source: z.enum(["manual", "qr", "notification"]).optional(),
  counterValue: z.number().finite().optional(),
  /** Also log the work in the asset's service log (tasks with an asset only). */
  serviceLog: completionServiceLogSchema.optional(),
});
export type CompleteTaskRequest = z.output<typeof completeTaskRequestSchema>;

export const skipTaskRequestSchema = completeTaskRequestSchema.omit({
  counterValue: true,
  serviceLog: true,
});
export type SkipTaskRequest = z.output<typeof skipTaskRequestSchema>;

export const completeTaskResponseSchema = z.object({
  completion: completionSchema,
  task: taskSchema,
  /** The service log entry created with `serviceLog`; null when none was asked for. */
  serviceLog: serviceLogEntrySchema.nullable(),
});

export const snoozeTaskRequestSchema = z.strictObject({
  /** Hide the task until this date (exclusive of earlier days); `null` ends a snooze. */
  until: dateSchema.nullable(),
});

export const listCompletionsQuerySchema = paginationQuerySchema.extend({
  taskId: idSchema.optional(),
  userId: idSchema.optional(),
  includeRevoked: queryBooleanSchema.optional(),
});
export const listCompletionsResponseSchema = paginated(completionSchema);

export const taskParamsSchema = z.object({ id: idSchema });
export const preparationParamsSchema = z.object({
  id: idSchema,
  prepId: idSchema,
});

const prepFields = {
  title: z.string().trim().min(1).max(200),
  kind: z.enum(PREPARATION_KINDS),
  leadDays: z.number().int().min(0).max(3650).nullable(),
  leadValue: leadValueSchema.nullable(),
  partId: idSchema.nullable(),
  qty: z.number().int().min(1).max(999),
  sortOrder: z.number().int().min(0).max(100_000),
};

export const createPreparationRequestSchema = z.strictObject({
  title: prepFields.title,
  kind: prepFields.kind.default("generic"),
  leadDays: prepFields.leadDays.optional(),
  leadValue: prepFields.leadValue.optional(),
  partId: prepFields.partId.optional(),
  qty: prepFields.qty.default(1),
  sortOrder: prepFields.sortOrder.optional(),
});
export type CreatePreparationRequest = z.output<
  typeof createPreparationRequestSchema
>;

export const updatePreparationRequestSchema = atLeastOne(
  z.strictObject({
    title: prepFields.title.optional(),
    kind: prepFields.kind.optional(),
    leadDays: prepFields.leadDays.optional(),
    leadValue: prepFields.leadValue.optional(),
    partId: prepFields.partId.optional(),
    qty: prepFields.qty.optional(),
    sortOrder: prepFields.sortOrder.optional(),
  }),
);
export type UpdatePreparationRequest = z.output<
  typeof updatePreparationRequestSchema
>;

export const listPreparationsResponseSchema = paginated(preparationSchema);

export const completePreparationRequestSchema = z.strictObject({
  occurrenceKey: z.string().min(1).max(64).optional(),
});
