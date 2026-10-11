import { sql, type AnyColumn } from "drizzle-orm";
import { z } from "zod";
import { toIso } from "$lib/api/schemas/common";
import type { NextAppointment } from "$lib/api/schemas/tasks";
import { parseStored } from "$lib/server/json";

/**
 * The earliest planned appointment of the task whose id column is given, as a correlated subquery
 * for a select list (null without one); it adds no join and no grouping. Parse it with
 * `parseNextAppointment`.
 *
 * "Earliest" orders timed and all-day appointments on one line by treating a date as midnight UTC,
 * which only matters for a timed and an all-day appointment of the same task on neighbouring days. An
 * appointment whose time has passed but that is still planned counts: it stays what the task is
 * waiting for until somebody completes or cancels it.
 */
export function nextAppointmentSql(taskIdColumn: AnyColumn) {
  return sql<
    string | null
  >`(select json_object('id', a.id, 'allDay', a.all_day, 'startsAt', a.starts_at, 'startDate', a.start_date) from appointments a where a.task_id = ${taskIdColumn} and a.status = 'planned' order by coalesce(a.starts_at, cast(strftime('%s', a.start_date) as integer) * 1000), a.id limit 1)`;
}

const rawSchema = z.object({
  id: z.string(),
  allDay: z.number(),
  startsAt: z.number().nullable(),
  startDate: z.string().nullable(),
});

export function parseNextAppointment(
  raw: string | null,
): NextAppointment | null {
  if (raw === null) return null;
  const value = parseStored(rawSchema, JSON.parse(raw), "next appointment");
  return {
    id: value.id,
    allDay: value.allDay === 1,
    startsAt: value.startsAt === null ? null : toIso(value.startsAt),
    startDate: value.startDate,
  };
}
