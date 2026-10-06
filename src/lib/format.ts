import { getLocale } from "$lib/paraglide/runtime";

const INTL_LOCALES = { de: "de-CH", en: "en-GB" } as const;

/** A calendar date in the user's language, e.g. "06.10.2026" or "06/10/2026". */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(INTL_LOCALES[getLocale()], {
    dateStyle: "medium",
  }).format(new Date(iso));
}

/** Basis points as a percentage, e.g. 5000 -> "50" and 3333 -> "33.33". */
export function formatPercent(basisPoints: number): string {
  return new Intl.NumberFormat(INTL_LOCALES[getLocale()], {
    maximumFractionDigits: 2,
  }).format(basisPoints / 100);
}
