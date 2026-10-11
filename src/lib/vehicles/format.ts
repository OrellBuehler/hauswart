import type { OdometerUnit } from "$lib/api/enums";
import { formatNumber } from "$lib/format";

/** An odometer reading with its unit in the user's language, e.g. "45’200 km". */
export function formatOdometer(value: number, unit: OdometerUnit): string {
  return `${formatNumber(value)} ${unit}`;
}

/**
 * Reads what a person typed as a plain number: `'`, `’` or spaces as thousands separators and a
 * point or comma as the decimal sign. `null` for an empty field, `undefined` for text that is no
 * number or lies outside `0..max`.
 */
export function parseDecimalInput(
  text: string,
  max: number,
): number | null | undefined {
  const cleaned = text.trim().replace(/[\s'’]/g, "");
  if (cleaned === "") return null;
  if (!/^\d+(?:[.,]\d+)?$/.test(cleaned)) return undefined;
  const value = Number(cleaned.replace(",", "."));
  return Number.isFinite(value) && value >= 0 && value <= max
    ? value
    : undefined;
}

export const parseOdometerValue = parseDecimalInput;
