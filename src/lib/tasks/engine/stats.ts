export const UNASSIGNED_USER = "_unassigned";
export const UNCATEGORIZED = "_uncategorized";

export type StatsCompletion = {
  userId: string | null;
  kind: "done" | "skipped";
  category?: string | null;
  completedDate: string;
  dueDateAtCompletion?: string | null;
};

export type GroupStats = {
  done: number;
  skipped: number;
  onTime: number;
  measurable: number;
  onTimeShare: number | null;
};

export type CompletionStats = {
  total: GroupStats;
  byUser: Record<string, GroupStats>;
  byCategory: Record<string, GroupStats>;
};

type Counts = Omit<GroupStats, "onTimeShare">;

function emptyCounts(): Counts {
  return { done: 0, skipped: 0, onTime: 0, measurable: 0 };
}

function add(counts: Counts, c: StatsCompletion): void {
  if (c.kind === "skipped") {
    counts.skipped += 1;
    return;
  }
  counts.done += 1;
  if (c.dueDateAtCompletion) {
    counts.measurable += 1;
    if (c.completedDate <= c.dueDateAtCompletion) counts.onTime += 1;
  }
}

function finish(counts: Counts): GroupStats {
  return {
    ...counts,
    onTimeShare:
      counts.measurable > 0 ? counts.onTime / counts.measurable : null,
  };
}

function group(
  completions: StatsCompletion[],
  keyOf: (c: StatsCompletion) => string,
): Record<string, GroupStats> {
  const groups = new Map<string, Counts>();
  for (const c of completions) {
    const key = keyOf(c);
    let counts = groups.get(key);
    if (!counts) {
      counts = emptyCounts();
      groups.set(key, counts);
    }
    add(counts, c);
  }
  return Object.fromEntries(
    [...groups].map(([key, counts]) => [key, finish(counts)]),
  );
}

export function computeStats(completions: StatsCompletion[]): CompletionStats {
  const total = emptyCounts();
  for (const c of completions) add(total, c);
  return {
    total: finish(total),
    byUser: group(completions, (c) => c.userId ?? UNASSIGNED_USER),
    byCategory: group(completions, (c) => c.category ?? UNCATEGORIZED),
  };
}
