import type { FuelUnit, OdometerUnit } from "#lib/api/enums.ts";
import { formatNumber } from "#lib/format.ts";
import { currencyExponent } from "#lib/money.ts";
import { getLocale } from "#lib/paraglide/runtime.js";

const INTL_LOCALES = { de: "de-CH", en: "en-GB" } as const;

const fixed = (value: number, digits: number): string =>
  new Intl.NumberFormat(INTL_LOCALES[getLocale()], {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);

export function formatFuelQuantity(quantity: number, unit: FuelUnit): string {
  return `${formatNumber(quantity)} ${unit}`;
}

export function formatConsumption(
  per100: number,
  unit: FuelUnit,
  distanceUnit: OdometerUnit,
): string {
  return `${fixed(per100, 1)} ${unit}/100 ${distanceUnit}`;
}

export function formatRate(
  rateMinor: number,
  currency: string,
  per: string,
): string {
  const exponent = currencyExponent(currency);
  const digits = exponent + 1;
  const text = new Intl.NumberFormat(INTL_LOCALES[getLocale()], {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(rateMinor / 10 ** exponent);
  return `${text}/${per}`;
}
