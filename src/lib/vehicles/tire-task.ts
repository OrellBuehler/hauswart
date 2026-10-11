import type { TireSeason } from "$lib/api/enums";

const SEASONS: readonly [RegExp, TireSeason][] = [
  [/ganzjahr|all[- ]?season/g, "all_season"],
  [/winter/g, "winter"],
  [/sommer|summer/g, "summer"],
];

export function tireChange(
  title: string,
): { season: TireSeason | null } | null {
  const text = title.toLocaleLowerCase();
  const tires = /reifen|pneu|räder|raeder|\btires?\b|\btyres?\b|\bwheels?\b/;
  const change =
    /wechs|aufzieh|montier|umstecken|umrüst|\bchange\b|\bswap\b|\bswitch\b|\bfit\b|\bmount/;
  if (!tires.test(text) || !change.test(text)) return null;
  let season: TireSeason | null = null;
  let at = -1;
  for (const [pattern, value] of SEASONS) {
    for (const match of text.matchAll(pattern)) {
      if (match.index > at) {
        at = match.index;
        season = value;
      }
    }
  }
  return { season };
}
