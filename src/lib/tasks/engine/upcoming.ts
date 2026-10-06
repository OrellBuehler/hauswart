import { addDays, isoWeekEnd } from "$lib/dates";
import type { PrepState } from "./preparations";
import type { DueResult } from "./types";

export type UpcomingPrep = {
  id: string;
  label?: string;
  state: PrepState;
};

export type UpcomingInput = {
  taskId: string;
  title: string;
  due: DueResult;
  preps?: UpcomingPrep[];
};

export type UpcomingItem = {
  taskId: string;
  title: string;
  due: DueResult;
  date: string | null;
  estimated: boolean;
};

export type UpcomingPrepItem = {
  taskId: string;
  title: string;
  prepId: string;
  label?: string;
  state: PrepState;
  date: string | null;
};

export type Upcoming = {
  overdue: UpcomingItem[];
  today: UpcomingItem[];
  thisWeek: UpcomingItem[];
  later: UpcomingItem[];
  signalBased: UpcomingItem[];
  preparations: UpcomingPrepItem[];
};

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byDate(a: UpcomingItem, b: UpcomingItem): number {
  return (
    compareText(a.date ?? "", b.date ?? "") ||
    Number(a.estimated) - Number(b.estimated) ||
    compareText(a.title, b.title) ||
    compareText(a.taskId, b.taskId)
  );
}

export function buildUpcoming(
  items: UpcomingInput[],
  today: string,
  horizonDays: number,
): Upcoming {
  const result: Upcoming = {
    overdue: [],
    today: [],
    thisWeek: [],
    later: [],
    signalBased: [],
    preparations: [],
  };
  const horizonEnd = addDays(today, horizonDays);
  const weekEnd = isoWeekEnd(today);

  for (const item of items) {
    const { due } = item;
    const date = due.dueDate ?? due.estimate?.date ?? null;
    const estimated = due.dueKind === "estimated" || due.dueDate === null;

    for (const prep of item.preps ?? []) {
      if (prep.state !== "now") continue;
      result.preparations.push({
        taskId: item.taskId,
        title: item.title,
        prepId: prep.id,
        ...(prep.label !== undefined ? { label: prep.label } : {}),
        state: prep.state,
        date,
      });
    }

    if (due.status === "snoozed") continue;
    const entry: UpcomingItem = {
      taskId: item.taskId,
      title: item.title,
      due,
      date,
      estimated: date !== null && estimated,
    };
    if (date === null) {
      if (due.progress || due.status === "unknown") {
        result.signalBased.push(entry);
      }
    } else if (date < today && !entry.estimated) {
      result.overdue.push(entry);
    } else if (date <= today) {
      result.today.push(entry);
    } else if (date > horizonEnd) {
      continue;
    } else if (date <= weekEnd) {
      result.thisWeek.push(entry);
    } else {
      result.later.push(entry);
    }
  }

  result.overdue.sort(byDate);
  result.today.sort(byDate);
  result.thisWeek.sort(byDate);
  result.later.sort(byDate);
  result.signalBased.sort(
    (a, b) => compareText(a.title, b.title) || compareText(a.taskId, b.taskId),
  );
  result.preparations.sort(
    (a, b) =>
      compareText(a.date ?? "9999-99-99", b.date ?? "9999-99-99") ||
      compareText(a.title, b.title) ||
      compareText(a.prepId, b.prepId),
  );
  return result;
}
