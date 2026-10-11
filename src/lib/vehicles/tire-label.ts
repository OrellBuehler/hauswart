import type { TireSet } from "$lib/api/schemas/tire-sets";
import { tireSeasonLabels } from "./labels";

export function setTitle(set: Pick<TireSet, "season" | "size">): string {
  const season = tireSeasonLabels[set.season]();
  return set.size ? `${season} ${set.size}` : season;
}

export function setMake(set: Pick<TireSet, "brand" | "model">): string {
  return [set.brand, set.model].filter(Boolean).join(" ");
}
