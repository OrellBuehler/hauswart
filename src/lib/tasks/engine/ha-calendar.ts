import { addDays, diffDays, isValidDate, maxDate } from "$lib/dates";
import { datedResult, noDateResult } from "./common";
import type { DueResult, EvalContext, HaCalendarTrigger } from "./types";

const EARLY_ATTRIBUTION_DAYS = 7;

export function haCalendarKey(
  trigger: Pick<HaCalendarTrigger, "entityId" | "summaryMatch">,
): string {
  return `${trigger.entityId}#${trigger.summaryMatch ?? ""}`;
}

export function evaluateHaCalendar(
  trigger: HaCalendarTrigger,
  ctx: EvalContext,
): DueResult {
  const events = [
    ...new Set(
      (ctx.externalDates[haCalendarKey(trigger)] ?? []).filter(isValidDate),
    ),
  ].sort();
  const occurrences = events
    .map((event) => ({ event, due: addDays(event, trigger.offsetDays) }))
    .filter((o) => maxDate(o.event, o.due) >= ctx.today);
  if (occurrences.length === 0) {
    return noDateResult("unknown", "none", ["no_upcoming_events"]);
  }

  const satisfied = new Set<string>();
  for (const c of ctx.completions) {
    if (c.occurrenceKey && events.includes(c.occurrenceKey)) {
      satisfied.add(c.occurrenceKey);
      continue;
    }
    const target = occurrences.find(
      (o) =>
        maxDate(o.event, o.due) >= c.completedDate &&
        diffDays(o.due, c.completedDate) <= EARLY_ATTRIBUTION_DAYS,
    );
    if (target) satisfied.add(target.event);
  }

  const next = occurrences.find((o) => !satisfied.has(o.event));
  if (!next) return noDateResult("ok", "none", ["completed"]);
  return datedResult(next.due, "exact", next.event, ctx);
}
