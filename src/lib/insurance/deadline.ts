import { daysUntil } from "$lib/format";

/** From this many days on the deadline is "soon": about when the reminder task starts its preparation. */
export const DEADLINE_SOON_DAYS = 30;

export type DeadlineTone = "overdue" | "soon" | "ok";

export type DeadlineInfo = {
  /** Days from today to the deadline; negative once it has passed. */
  days: number;
  tone: DeadlineTone;
};

/** How pressing a cancellation deadline is. `null` for a policy without one. */
export function deadlineInfo(
  deadline: string | null,
  today: string,
): DeadlineInfo | null {
  if (deadline === null) return null;
  const days = daysUntil(deadline, today);
  if (days < 0) return { days, tone: "overdue" };
  if (days <= DEADLINE_SOON_DAYS) return { days, tone: "soon" };
  return { days, tone: "ok" };
}

export const deadlineTones: Record<DeadlineTone, string> = {
  overdue: "text-destructive font-medium",
  soon: "text-warning font-medium",
  ok: "text-muted-foreground",
};

/**
 * Whether the current term is over: the end date is the last day of cover, so the policy runs until
 * the end of that day. After an automatic renewal somebody has to move the end date, so a past date on
 * an active policy is a to-do, not an error.
 */
export function termEnded(endDate: string | null, today: string): boolean {
  return endDate !== null && endDate < today;
}
