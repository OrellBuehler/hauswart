import { z } from "zod";
import {
  DUE_STATUSES,
  TASK_CATEGORIES,
  TASK_PRIORITIES,
} from "../../../src/lib/api/enums";
import { endpoints } from "../../../src/lib/api/registry";
import type { Task } from "../../../src/lib/api/schemas/tasks";
import { zonedTimeToInstant } from "../../../src/lib/dates";
import type { ToolContext } from "../context";
import { ToolError } from "../errors";
import {
  completionRow,
  describeTrigger,
  moreHint,
  plural,
  taskRow,
} from "../format";
import { defineTool } from "../tool";
import { parseTrigger, triggerHelp, triggerInput } from "./trigger-docs";

const id = z.string().min(1).max(64);
const date = z.iso.date();
const limit = z.number().int().min(1).max(100).default(30);
const cursor = z.string().min(1).max(512).optional();

const taskId = id.describe("Task id, from list_tasks or list_upcoming");

/** "due 2026-11-06", "estimated 2026-11-06", "snoozed until ..." for a summary. */
function whenNext(task: Task): string {
  const s = task.state;
  if (task.archivedAt) return "archived";
  if (task.snoozedUntil) return `snoozed until ${task.snoozedUntil}`;
  if (!s) return "not evaluated yet";
  if (s.dueDate) return `${s.status}, due ${s.dueDate}`;
  if (s.estimate) return `${s.status}, estimated ${s.estimate.date}`;
  return s.status;
}

/** A backdated completion: noon of that day in the household time zone. Today means now. */
function completedAt(ctx: ToolContext, day: string | undefined) {
  if (!day || day === ctx.today()) return undefined;
  if (day > ctx.today()) {
    throw new ToolError(
      "invalid_request",
      `completedDate ${day} is in the future (today is ${ctx.today()}).`,
    );
  }
  return new Date(
    zonedTimeToInstant(day, "12:00", ctx.household.timezone),
  ).toISOString();
}

export const listTasks = defineTool({
  name: "list_tasks",
  title: "List tasks",
  description:
    "Search and filter maintenance tasks with their due state, soonest and overdue first. Filters are optional and combine: status (ok|open|due|overdue|snoozed|unknown), category, room (id, slug or name) and asset (id or name), assignee (me, a name or an id; matches the current assignee), q (text in title). Archived tasks are hidden unless includeArchived. For a plain 'what is due' use list_upcoming.",
  mode: "read",
  input: {
    status: z.enum(DUE_STATUSES).optional(),
    category: z.enum(TASK_CATEGORIES).optional(),
    room: z.string().min(1).max(100).optional(),
    asset: z.string().min(1).max(120).optional(),
    assignee: z.string().min(1).max(64).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    includeArchived: z.boolean().default(false),
    limit,
    cursor,
  },
  async handler(args, ctx) {
    const [roomId, assetId, assignee, users] = await Promise.all([
      args.room ? ctx.resolveRoom(args.room).then((r) => r.id) : undefined,
      args.asset ? ctx.resolveAsset(args.asset).then((a) => a.id) : undefined,
      args.assignee ? ctx.resolveUser(args.assignee) : undefined,
      ctx.users(),
    ]);
    const page = await ctx.api.call(endpoints.tasksList, {
      query: {
        status: args.status,
        category: args.category,
        roomId,
        assetId,
        assignee,
        q: args.q,
        includeArchived: args.includeArchived ? "true" : undefined,
        cursor: args.cursor,
        limit: args.limit,
      },
    });
    return {
      summary: `${plural(page.items.length, "task")}.${moreHint(page.nextCursor)}`,
      data: {
        tasks: page.items.map((t) => taskRow(t, users)),
        nextCursor: page.nextCursor,
      },
    };
  },
});

export const getTask = defineTool({
  name: "get_task",
  title: "Get a task",
  description:
    "One task in full: description, schedule and its trigger JSON, current due state (status, due date, estimate, progress), assignment, preparations (things to do or buy beforehand) and the most recent completions (with ids for undo_completion).",
  mode: "read",
  input: { id: taskId },
  async handler({ id }, ctx) {
    const [t, users] = await Promise.all([
      ctx.api.call(endpoints.tasksGet, { params: { id } }),
      ctx.users(),
    ]);
    return {
      summary: `${t.title}: ${whenNext(t)}.`,
      data: {
        ...taskRow(t, users),
        description: t.descriptionMd,
        trigger: t.trigger,
        graceDays: t.graceDays || null,
        assignMode: t.assignMode,
        rotation: t.rotationOrder.map((u) => users.get(u) ?? u),
        reasons: t.state?.reasons,
        preparations: t.preparations.map((p) => ({
          id: p.id,
          title: p.title,
          kind: p.kind,
          state: p.state,
          leadDays: p.leadDays,
        })),
        recentCompletions: t.recentCompletions.slice(0, 10).map(completionRow),
      },
    };
  },
});

const triggerArg = triggerInput.describe(
  "When the task is due. JSON object with a `type`; see the tool description.",
);

const taskFields = {
  description: z
    .string()
    .max(50_000)
    .describe("Instructions in markdown.")
    .optional(),
  category: z.enum(TASK_CATEGORIES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  graceDays: z
    .number()
    .int()
    .min(0)
    .max(365)
    .describe("Days after the due date before it counts as overdue.")
    .optional(),
};

export const previewTrigger = defineTool({
  name: "preview_trigger",
  title: "Preview a trigger",
  description: `Checks a trigger and shows when a task with it would first be due, without creating anything. Use it before create_task or update_task with a new schedule.\n\n${triggerHelp()}`,
  mode: "read",
  input: {
    trigger: triggerArg,
    graceDays: taskFields.graceDays,
    today: date.optional().describe("Evaluate as of this date; default today."),
  },
  async handler(args, ctx) {
    const trigger = parseTrigger(args.trigger);
    const r = await ctx.api.call(endpoints.tasksPreview, {
      body: { trigger, graceDays: args.graceDays, today: args.today },
    });
    return {
      summary: `${describeTrigger(trigger)}: ${r.status}${r.dueDate ? `, due ${r.dueDate}` : r.estimate ? `, estimated ${r.estimate.date}` : ""}.`,
      data: r,
    };
  },
});

export const createTask = defineTool({
  name: "create_task",
  title: "Create a task",
  description: `Creates a recurring or one-off task. The first due date is computed immediately and returned. Needs title and trigger; asset (id or name) and room (id, slug or name) accept either; the task takes the asset's room unless room is given (check with list_assets / list_rooms). assignee: me, a name or an id (fixed assignee).\n\n${triggerHelp()}`,
  mode: "create",
  input: {
    title: z.string().trim().min(1).max(200),
    trigger: triggerArg,
    ...taskFields,
    effortMinutes: z.number().int().min(1).max(10_080).optional(),
    asset: z.string().min(1).max(120).optional(),
    room: z.string().min(1).max(100).optional(),
    assignee: z.string().min(1).max(64).optional(),
  },
  async handler(args, ctx) {
    const trigger = parseTrigger(args.trigger);
    const [asset, room, assigneeUserId] = await Promise.all([
      args.asset ? ctx.resolveAsset(args.asset) : undefined,
      args.room ? ctx.resolveRoom(args.room) : undefined,
      args.assignee ? ctx.resolveUser(args.assignee) : undefined,
    ]);
    const task = await ctx.api.call(endpoints.tasksCreate, {
      body: {
        title: args.title,
        trigger,
        descriptionMd: args.description,
        category: args.category,
        priority: args.priority,
        effortMinutes: args.effortMinutes,
        graceDays: args.graceDays,
        assetId: asset?.id,
        roomId: room?.id ?? asset?.roomId ?? undefined,
        ...(assigneeUserId
          ? { assignMode: "fixed" as const, assigneeUserId }
          : {}),
        source: "mcp",
      },
    });
    const users = await ctx.users();
    return {
      summary: `Created "${task.title}" (${describeTrigger(trigger)}): ${whenNext(task)}.`,
      data: taskRow(task, users),
    };
  },
});

export const updateTask = defineTool({
  name: "update_task",
  title: "Update a task",
  description: `Changes fields of a task; only the fields you pass change. Pass null to clear effortMinutes, asset, room or assignee. archived: true archives (hides) the task, false restores it. A new trigger replaces the old one and the task is re-evaluated; completion history is kept.\n\n${triggerHelp()}`,
  mode: "update",
  input: {
    id: taskId,
    title: z.string().trim().min(1).max(200).optional(),
    trigger: triggerArg.optional(),
    ...taskFields,
    effortMinutes: z.number().int().min(1).max(10_080).nullable().optional(),
    asset: z.string().min(1).max(120).nullable().optional(),
    room: z.string().min(1).max(100).nullable().optional(),
    assignee: z.string().min(1).max(64).nullable().optional(),
    archived: z.boolean().optional(),
  },
  async handler({ id, ...args }, ctx) {
    const [asset, room, assigneeUserId] = await Promise.all([
      args.asset ? ctx.resolveAsset(args.asset) : undefined,
      args.room ? ctx.resolveRoom(args.room) : undefined,
      args.assignee ? ctx.resolveUser(args.assignee) : undefined,
    ]);
    const body = {
      title: args.title,
      trigger: args.trigger ? parseTrigger(args.trigger) : undefined,
      descriptionMd: args.description,
      category: args.category,
      priority: args.priority,
      graceDays: args.graceDays,
      effortMinutes: args.effortMinutes,
      assetId: args.asset === null ? null : asset?.id,
      roomId: args.room === null ? null : room?.id,
      archived: args.archived,
      ...(args.assignee === null
        ? { assignMode: "none" as const, assigneeUserId: null }
        : assigneeUserId
          ? { assignMode: "fixed" as const, assigneeUserId }
          : {}),
    };
    if (Object.values(body).every((v) => v === undefined)) {
      throw new ToolError(
        "invalid_request",
        "Pass at least one field to change.",
      );
    }
    const task = await ctx.api.call(endpoints.tasksUpdate, {
      params: { id },
      body,
    });
    return {
      summary: `Updated "${task.title}": ${whenNext(task)}.`,
      data: taskRow(task, await ctx.users()),
    };
  },
});

const note = z
  .string()
  .trim()
  .max(2000)
  .describe("Optional remark stored with the entry.")
  .optional();

export const completeTask = defineTool({
  name: "complete_task",
  title: "Mark a task done",
  description:
    "Records that a task was done and returns when it is due next. completedDate (YYYY-MM-DD) backdates it, default today; it cannot be in the future. The entry is attributed to this MCP token's user. Returns the completion id; undo_completion reverses a mistake.",
  mode: "create",
  input: {
    id: taskId,
    note,
    completedDate: date
      .optional()
      .describe("When it was done, YYYY-MM-DD; default today."),
  },
  async handler({ id, note, completedDate }, ctx) {
    const r = await ctx.api.call(endpoints.tasksComplete, {
      params: { id },
      body: {
        note,
        completedAt: completedAt(ctx, completedDate),
        idempotencyKey: ctx.newKey(),
      },
    });
    return {
      summary: `Marked "${r.task.title}" done on ${r.completion.completedDate}. Now: ${whenNext(r.task)}.`,
      data: {
        completion: completionRow(r.completion),
        task: taskRow(r.task, await ctx.users()),
      },
    };
  },
});

export const skipTask = defineTool({
  name: "skip_task",
  title: "Skip a task",
  description:
    "Skips the current occurrence of a task (not needed this time): the next occurrence follows, but it does not count as done in the statistics.",
  mode: "create",
  input: { id: taskId, note },
  async handler({ id, note }, ctx) {
    const r = await ctx.api.call(endpoints.tasksSkip, {
      params: { id },
      body: { note, idempotencyKey: ctx.newKey() },
    });
    return {
      summary: `Skipped "${r.task.title}". Now: ${whenNext(r.task)}.`,
      data: {
        completion: completionRow(r.completion),
        task: taskRow(r.task, await ctx.users()),
      },
    };
  },
});

export const snoozeTask = defineTool({
  name: "snooze_task",
  title: "Snooze a task",
  description:
    "Hides a task until a date: it sends no reminders and shows as snoozed. until must be after today; null ends a snooze.",
  mode: "update",
  input: {
    id: taskId,
    until: date.nullable().describe("YYYY-MM-DD, or null to end the snooze."),
  },
  async handler({ id, until }, ctx) {
    const task = await ctx.api.call(endpoints.tasksSnooze, {
      params: { id },
      body: { until },
    });
    return {
      summary: until
        ? `Snoozed "${task.title}" until ${until}.`
        : `Ended the snooze of "${task.title}": ${whenNext(task)}.`,
      data: taskRow(task, await ctx.users()),
    };
  },
});

export const undoCompletion = defineTool({
  name: "undo_completion",
  title: "Undo a completion",
  description:
    "Revokes a completion or skip by its id (from complete_task, skip_task or get_task): the task returns to its previous due date. Possible within 7 days of recording; undoing twice is harmless.",
  mode: "undo",
  input: { completionId: id.describe("Completion id") },
  async handler({ completionId }, ctx) {
    await ctx.api.call(endpoints.completionsUndo, {
      params: { id: completionId },
    });
    return {
      summary: `Undid completion ${completionId}.`,
      data: { completionId, undone: true },
    };
  },
});

export const taskTools = [
  listTasks,
  getTask,
  previewTrigger,
  createTask,
  updateTask,
  completeTask,
  skipTask,
  snoozeTask,
  undoCompletion,
];
