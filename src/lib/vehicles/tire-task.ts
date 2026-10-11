import type { TireSeason } from "$lib/api/enums";
import { templateOfMark } from "./template-mark";

const SEASONS: readonly [RegExp, TireSeason][] = [
  [/ganzjahr|all[- ]?season/g, "all_season"],
  [/winter/g, "winter"],
  [/sommer|summer/g, "summer"],
];

/**
 * Whether a title reads like a tire change, and which season it changes to. A guess from the words,
 * for tasks that carry no mark of a template; "Radwechsel" counts, a bare "Rad" does not (a bicycle).
 */
export function tireChangeByTitle(
  title: string,
): { season: TireSeason | null } | null {
  const text = title.toLocaleLowerCase();
  const tires =
    /reifen|pneu|räder|raeder|\bradwechsel|\btires?\b|\btyres?\b|\bwheels?\b/;
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

/**
 * Whether completing this task is a tire change, and to which season. A task a tire template made
 * says so by its mark, whatever it is called now, and the other templates' tasks never are one;
 * a task without a (readable) mark is judged by its title.
 */
export function tireChange(task: {
  title: string;
  externalSource?: string | null | undefined;
  externalRef?: string | null | undefined;
}): { season: TireSeason | null } | null {
  switch (templateOfMark(task)) {
    case null:
      return tireChangeByTitle(task.title);
    case "tires_winter":
      return { season: "winter" };
    case "tires_summer":
      return { season: "summer" };
    default:
      return null;
  }
}
