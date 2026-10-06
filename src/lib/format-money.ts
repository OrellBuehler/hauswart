import { formatAmount, minor, parseAmount, currencyExponent } from "$lib/money";
import { getLocale } from "$lib/paraglide/runtime";

const INTL_LOCALES = { de: "de-CH", en: "en-GB" } as const;

/** An amount in minor units as currency text, e.g. "CHF 12.50" in the user's language. */
export function formatMoney(value: number, currency: string): string {
  return formatAmount(minor(value), currency, INTL_LOCALES[getLocale()]);
}

/**
 * Reads a form field into minor units. An empty field is `null`; text that is
 * not an amount (or has too many decimals) is `undefined`.
 */
export function readMoney(
  text: string,
  currency: string,
): number | null | undefined {
  if (text.trim() === "") return null;
  try {
    return parseAmount(text, currencyExponent(currency));
  } catch (err) {
    if (err instanceof SyntaxError || err instanceof RangeError) {
      return undefined;
    }
    throw err;
  }
}
