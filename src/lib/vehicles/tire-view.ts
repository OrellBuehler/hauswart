import type { TireSet } from "$lib/api/schemas/tire-sets";
import { TIRE_AGE_WARNING_YEARS, TREAD_WARNING_MM } from "./tires";

export type TireWarning =
  | { kind: "tread"; depthMm: number; limitMm: number }
  | { kind: "age"; years: number };

type WarningFacts = Pick<
  TireSet,
  "season" | "treadWarning" | "treadDepthMm" | "ageYears" | "retiredAt"
>;

export function tireWarnings(set: WarningFacts): TireWarning[] {
  if (set.retiredAt !== null) return [];
  const warnings: TireWarning[] = [];
  if (set.treadWarning && set.treadDepthMm !== null) {
    warnings.push({
      kind: "tread",
      depthMm: set.treadDepthMm,
      limitMm: TREAD_WARNING_MM[set.season],
    });
  }
  if (set.ageYears !== null && set.ageYears >= TIRE_AGE_WARNING_YEARS) {
    warnings.push({ kind: "age", years: set.ageYears });
  }
  return warnings;
}

export function mountedSet<T extends Pick<TireSet, "mounted">>(
  sets: readonly T[],
): T | undefined {
  return sets.find((set) => set.mounted);
}

export function mountableSets<T extends Pick<TireSet, "mounted" | "retiredAt">>(
  sets: readonly T[],
): T[] {
  return sets.filter((set) => !set.mounted && set.retiredAt === null);
}
