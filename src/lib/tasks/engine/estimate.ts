import { addDays, dayNumber, localDateOf } from "$lib/dates";
import type { Completion, Estimate, Sample } from "./types";

const DAY_MS = 86_400_000;
const WINDOWS_DAYS = [28, 90];
const MIN_SPAN_DAYS = 7;
const MAX_HORIZON_DAYS = 365;
const MEDIUM_CONFIDENCE_SPAN_DAYS = 14;

export type CrossingTarget = {
  target: number;
  direction: "down" | "up";
  current?: number;
};

function slopePerDay(samples: Sample[]): number {
  const t0 = samples[0].at;
  const n = samples.length;
  const xs = samples.map((s) => (s.at - t0) / DAY_MS);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = samples.reduce((a, s) => a + s.value, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - meanX) * (samples[i].value - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  return num / den;
}

export function estimateCrossing(
  samples: Sample[],
  { target, direction, current }: CrossingTarget,
  today: string,
  tz: string,
): Estimate | null {
  const todayN = dayNumber(today);
  const dated = samples
    .filter((s) => Number.isFinite(s.at) && Number.isFinite(s.value))
    .map((s) => ({ ...s, day: dayNumber(localDateOf(tz, s.at)) }))
    .filter((s) => s.day <= todayN)
    .sort((a, b) => a.at - b.at);

  for (const windowDays of WINDOWS_DAYS) {
    const used = dated.filter((s) => s.day >= todayN - windowDays);
    if (used.length < 2) continue;
    const spanDays = (used[used.length - 1].at - used[0].at) / DAY_MS;
    if (spanDays < MIN_SPAN_DAYS) continue;

    const rate = direction === "up" ? slopePerDay(used) : -slopePerDay(used);
    if (!(rate > 1e-9)) return null;

    const now = current ?? used[used.length - 1].value;
    const remaining = direction === "up" ? target - now : now - target;
    if (!(remaining > 0)) return null;

    const days = Math.min(
      MAX_HORIZON_DAYS,
      Math.max(1, Math.ceil(Number((remaining / rate).toFixed(9)))),
    );
    return {
      date: addDays(today, days),
      confidence: spanDays < MEDIUM_CONFIDENCE_SPAN_DAYS ? "low" : "medium",
    };
  }
  return null;
}

export function estimateFromCompletions(
  completions: Completion[],
): Estimate | null {
  const dates = completions
    .filter((c) => c.kind === "done")
    .map((c) => c.completedDate)
    .sort()
    .slice(-3);
  if (dates.length < 2) return null;
  const days = dates.map(dayNumber);
  const intervals = days.slice(1).map((d, i) => d - days[i]);
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  return {
    date: addDays(dates[dates.length - 1], Math.max(1, Math.round(mean))),
    confidence: "low",
  };
}
