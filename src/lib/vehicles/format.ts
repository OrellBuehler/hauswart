import type { OdometerUnit } from "$lib/api/enums";
import { formatNumber } from "$lib/format";

/** An odometer reading with its unit in the user's language, e.g. "45’200 km". */
export function formatOdometer(value: number, unit: OdometerUnit): string {
  return `${formatNumber(value)} ${unit}`;
}

function withoutSpacing(text: string): string {
  return text.trim().replace(/[\s'’]/g, "");
}

/**
 * Reads what a person typed as a plain number, decimals included (an amount, litres, millimetres):
 * `'`, `’` or spaces as thousands separators and a point or comma as the decimal sign. `null` for an
 * empty field, `undefined` for text that is no number or lies outside `0..max`.
 */
export function parseDecimalInput(
  text: string,
  max: number,
): number | null | undefined {
  const cleaned = withoutSpacing(text);
  if (cleaned === "") return null;
  if (!/^\d+(?:[.,]\d+)?$/.test(cleaned)) return undefined;
  const value = Number(cleaned.replace(",", "."));
  return Number.isFinite(value) && value >= 0 && value <= max
    ? value
    : undefined;
}

/** Groups of exactly three digits after a first group of one to three, always behind the same point or comma. */
const GROUPED = /^[1-9]\d{0,2}(?:([.,])\d{3})(?:\1\d{3})*$/;

/**
 * Reads an odometer field: like `parseDecimalInput`, except that a point or comma followed by exactly
 * three digits is a thousands separator, as people write a reading ("95.000" and "95,000" are 95000,
 * "1.234.567" is 1234567; "95.5" and "95,50" stay decimals). `'`, `’` and spaces are separators too.
 */
export function parseOdometerValue(
  text: string,
  max: number,
): number | null | undefined {
  const cleaned = withoutSpacing(text);
  if (GROUPED.test(cleaned)) {
    const value = Number(cleaned.replace(/[.,]/g, ""));
    return value <= max ? value : undefined;
  }
  return parseDecimalInput(cleaned, max);
}
