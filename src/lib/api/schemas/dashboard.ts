import { z } from "zod";
import { DUE_KINDS, PREPARATION_STATES, TASK_CATEGORIES } from "../enums";
import { dateSchema, isoTimestampSchema } from "./common";
import { dashboardCostsSchema } from "./costs";
import { defectSeveritySchema, defectStatusSchema } from "./defects";
import { orderNowItemSchema } from "./parts";
import { warrantyStatusSchema } from "./warranties";
import {
  completionSchema,
  dueStatusSchema,
  estimateSchema,
  progressSchema,
  taskPrioritySchema,
} from "./tasks";

export const dashboardTaskSchema = z
  .object({
    taskId: z.string(),
    title: z.string(),
    category: z.enum(TASK_CATEGORIES),
    priority: taskPrioritySchema,
    assetId: z.string().nullable(),
    assetName: z.string().nullable(),
    roomId: z.string().nullable(),
    roomName: z.string().nullable(),
    assigneeUserId: z.string().nullable(),
    assigneeName: z.string().nullable(),
    status: dueStatusSchema,
    dueKind: z.enum(DUE_KINDS),
    /** Due date, or the estimate's date for estimated tasks; null for signal-based ones. */
    date: dateSchema.nullable(),
    estimated: z.boolean(),
    estimate: estimateSchema.nullable(),
    progress: progressSchema.nullable(),
    /** Open notes on the task's asset, to mention at this appointment; 0 without an asset. */
    openNoteCount: z.number().int(),
  })
  .meta({ id: "DashboardTask" });

export const dashboardPreparationSchema = z
  .object({
    taskId: z.string(),
    taskTitle: z.string(),
    prepId: z.string(),
    title: z.string(),
    state: z.enum(PREPARATION_STATES),
    date: dateSchema.nullable(),
  })
  .meta({ id: "DashboardPreparation" });

/** Every dashboard list item carries `id`, `title` and `date` (the date that matters for it). */
const dashboardItemFields = {
  id: z.string(),
  title: z.string(),
  date: dateSchema.nullable(),
};

/** An open defect; `date` is its deadline. */
export const dashboardDefectSchema = z
  .object({
    ...dashboardItemFields,
    number: z.number().int(),
    status: defectStatusSchema,
    severity: defectSeveritySchema,
    roomName: z.string().nullable(),
    assetName: z.string().nullable(),
  })
  .meta({ id: "DashboardDefect" });

/** An asset whose warranty is about to end or just ended; `date` is its last day. */
export const dashboardWarrantySchema = z
  .object({
    ...dashboardItemFields,
    assetId: z.string(),
    status: warrantyStatusSchema,
    daysLeft: z.number().int(),
  })
  .meta({ id: "DashboardWarranty" });

export const dashboardSchema = z
  .object({
    today: dateSchema,
    generatedAt: isoTimestampSchema,
    counts: z.object({
      overdue: z.number().int(),
      today: z.number().int(),
      thisWeek: z.number().int(),
      preparations: z.number().int(),
    }),
    upcoming: z.object({
      overdue: z.array(dashboardTaskSchema),
      today: z.array(dashboardTaskSchema),
      thisWeek: z.array(dashboardTaskSchema),
      later: z.array(dashboardTaskSchema),
      signalBased: z.array(dashboardTaskSchema),
    }),
    preparations: z.array(dashboardPreparationSchema),
    recentCompletions: z.array(completionSchema),
    openDefects: z.array(dashboardDefectSchema),
    expiringWarranties: z.array(dashboardWarrantySchema),
    orderNow: z.array(orderNowItemSchema),
    costsYearToDate: dashboardCostsSchema,
    /** The caller's own offers from a connected finance app that wait for a decision; other members' offers are never counted. */
    pendingFinanceSuggestions: z.number().int().min(0),
  })
  .meta({ id: "Dashboard" });
export type Dashboard = z.infer<typeof dashboardSchema>;

export const DASHBOARD_HORIZON_DAYS = 60;
export const DASHBOARD_RECENT_COMPLETIONS = 10;

export const groupStatsSchema = z
  .object({
    done: z.number().int(),
    skipped: z.number().int(),
    onTime: z.number().int(),
    measurable: z.number().int(),
    onTimeShare: z.number().nullable(),
  })
  .meta({ id: "GroupStats" });

export const statsQuerySchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

/** `byUser` is keyed by user id (`_unassigned` for completions without one), `byCategory` by task category. */
export const statsSchema = z
  .object({
    from: dateSchema,
    to: dateSchema,
    total: groupStatsSchema,
    byUser: z.record(z.string(), groupStatsSchema),
    byCategory: z.record(z.string(), groupStatsSchema),
  })
  .meta({ id: "Stats" });
export type Stats = z.infer<typeof statsSchema>;
