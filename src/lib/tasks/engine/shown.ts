import type { DueKind, Estimate } from "./types";

type Dated = {
  dueDate: string | null;
  dueKind: DueKind;
  estimate?: Estimate | null | undefined;
};

/**
 * The date a task is shown with in lists and sentences. Usually the due date. A counter task with a
 * time limit (`orEvery`) that is expected to reach its counter before the limit has both: `dueDate`
 * stays the hard limit (it is what the status, the notifications and the iCal feed are about) and
 * `estimate` carries the earlier guess, which is the date shown, marked as a guess.
 */
export function shownDate(due: Dated): string | null {
  if (due.dueKind === "estimated" && due.estimate) return due.estimate.date;
  return due.dueDate ?? due.estimate?.date ?? null;
}

/** Whether `shownDate` is a guess and not a date somebody or something fixed. */
export function shownDateIsEstimate(due: Dated): boolean {
  return (
    shownDate(due) !== null &&
    (due.dueKind === "estimated" || due.dueDate === null)
  );
}
