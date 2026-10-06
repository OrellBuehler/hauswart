import type { z } from "zod";
import { zonedTimeToInstant } from "$lib/dates";
import type { DB } from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";
import { createTask, type TaskRecord } from "$lib/server/tasks/tasks";
import { createTaskRequestSchema } from "$lib/api/schemas/tasks";

export const TEST_TZ = "Europe/Zurich";

/** The instant of a wall-clock time in the household zone, e.g. `at("2026-06-15", "09:30")`. */
export function at(date: string, time = "12:00"): number {
  return zonedTimeToInstant(date, time, TEST_TZ);
}

/** Monday, 2026-06-15, noon in Zurich. */
export const NOW = at("2026-06-15");

export function ctxAt(db: DB, now: number = NOW): ServiceContext {
  return { db, now };
}

type TaskOverrides = z.input<typeof createTaskRequestSchema>;

/** Task input as the API would hand it to the service: defaults filled in by the schema. */
export function taskInput(
  overrides: Partial<TaskOverrides> = {},
): z.output<typeof createTaskRequestSchema> {
  return createTaskRequestSchema.parse({
    title: "Filter wechseln",
    trigger: {
      v: 1,
      type: "interval",
      every: 3,
      unit: "month",
      anchor: "completion",
      startDate: "2026-06-20",
    },
    ...overrides,
  });
}

export function makeTask(
  ctx: ServiceContext,
  overrides: Partial<TaskOverrides> = {},
  createdBy: string | null = null,
): Promise<TaskRecord> {
  return createTask(ctx, taskInput(overrides), createdBy);
}

export const weekly = (startDate: string, byWeekday: number[] = [1]) => ({
  v: 1 as const,
  type: "calendar" as const,
  freq: "weekly" as const,
  interval: 1,
  byWeekday,
  startDate,
});

export const everyDays = (
  every: number,
  startDate: string,
  anchor: "completion" | "schedule" = "completion",
) => ({
  v: 1 as const,
  type: "interval" as const,
  every,
  unit: "day" as const,
  anchor,
  startDate,
});
