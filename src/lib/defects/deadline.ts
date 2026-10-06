import { REMINDER_LEAD_DAYS } from "$lib/api/schemas/defects";
import type { DefectStatus } from "$lib/api/enums";
import { daysUntil } from "$lib/format";
import { isActiveStatus } from "./filters";

export type DeadlineTone = "overdue" | "soon" | "ok" | "none";

export type DeadlineInfo = {
  /** Days from today to the deadline; negative once it passed. */
  days: number;
  tone: DeadlineTone;
};

/** How pressing a deadline is; closed defects (fixed, rejected) never are. */
export function deadlineInfo(
  deadlineDate: string | null,
  status: DefectStatus,
  today: string,
): DeadlineInfo | null {
  if (deadlineDate === null) return null;
  const days = daysUntil(deadlineDate, today);
  if (!isActiveStatus(status)) return { days, tone: "none" };
  if (days < 0) return { days, tone: "overdue" };
  if (days <= REMINDER_LEAD_DAYS) return { days, tone: "soon" };
  return { days, tone: "ok" };
}

export const deadlineTones: Record<DeadlineTone, string> = {
  overdue: "text-destructive font-medium",
  soon: "text-warning font-medium",
  ok: "text-muted-foreground",
  none: "text-muted-foreground",
};
