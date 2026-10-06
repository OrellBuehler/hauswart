/**
 * Amounts are integers in minor units (e.g. cents). Never use floats for money.
 */
export type Minor = number & { readonly __brand: "Minor" };

export function minor(value: number): Minor {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `Amount must be an integer in minor units, got ${value}`,
    );
  }
  return value as Minor;
}

/**
 * Parses a decimal string such as "1'234.50", "1 234,50" or "-12.3" into minor units.
 */
export function parseAmount(input: string, decimals = 2): Minor {
  const cleaned = input.trim().replace(/[\s'’]/g, "");
  const match = /^([+-])?(\d+)(?:[.,](\d+))?$/.exec(cleaned);
  if (!match) {
    throw new SyntaxError(`Not a valid amount: "${input}"`);
  }
  const [, sign, whole, fraction = ""] = match;
  if (fraction.length > decimals) {
    throw new RangeError(`Too many decimal places in "${input}"`);
  }
  const value =
    Number(whole) * 10 ** decimals +
    Number(fraction.padEnd(decimals, "0") || "0");
  return minor(sign === "-" ? -value : value);
}

const exponents = new Map<string, number>();

/** Number of minor-unit digits of an ISO 4217 currency (CHF 2, JPY 0, KWD 3). */
export function currencyExponent(currency: string): number {
  const code = currency.toUpperCase();
  let exp = exponents.get(code);
  if (exp === undefined) {
    exp = new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
    }).resolvedOptions().maximumFractionDigits!;
    exponents.set(code, exp);
  }
  return exp;
}

export function formatAmount(
  value: Minor,
  currency: string,
  locale = "en",
): string {
  const exp = currencyExponent(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(value / 10 ** exp);
}

/** Ownership share of an account in basis points: 10000 = 100%. */
export const FULL_SHARE_BPS = 10_000;

/**
 * Whether totals count every account at 100% ("total") or at the user's
 * ownership share ("share").
 */
export type ShareBasis = "total" | "share";

export function parseShareBasis(
  value: string | null | undefined,
  fallback: ShareBasis,
): ShareBasis {
  return value === "total" || value === "share" ? value : fallback;
}

/**
 * `basisPoints / 10000` of an amount, in integer arithmetic. Rounds half away
 * from zero (50% of 5 is 3, of -5 is -3), so the result never depends on the
 * sign of the amount. BigInt keeps the intermediate product exact.
 */
export function shareOf(amount: Minor, basisPoints: number): Minor {
  if (!Number.isInteger(basisPoints) || basisPoints < 0) {
    throw new RangeError(
      `Share must be a non-negative integer of basis points, got ${basisPoints}`,
    );
  }
  if (basisPoints === FULL_SHARE_BPS) return amount;
  const product = BigInt(Math.abs(amount)) * BigInt(basisPoints);
  const half = BigInt(FULL_SHARE_BPS / 2);
  const rounded = Number((product + half) / BigInt(FULL_SHARE_BPS));
  return minor(amount < 0 ? -rounded : rounded);
}

/**
 * Parses a percentage such as "50", "33.33" or "70 %" into basis points.
 * Accepts more than 0 and up to 100 with at most two decimals.
 */
export function parseSharePercent(input: string): number {
  const cleaned = input.trim().replace(/\s*%$/, "");
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(cleaned);
  if (!match) throw new SyntaxError(`Not a valid percentage: "${input}"`);
  const bps =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  if (bps <= 0 || bps > FULL_SHARE_BPS) {
    throw new RangeError("Share must be more than 0% and at most 100%.");
  }
  return bps;
}

/** Plain percentage for form fields: 5000 -> "50", 3333 -> "33.33". */
export function shareToInput(basisPoints: number): string {
  return String(basisPoints / 100);
}

/** Display text: 5000 -> "50%", 3333 -> "33.33%". */
export function formatShare(basisPoints: number): string {
  return `${shareToInput(basisPoints)}%`;
}

/** Plain decimal string for form fields, e.g. 194975 -> "1949.75" (round-trips with parseAmount). */
export function toDecimalString(value: Minor, decimals = 2): string {
  const digits = String(Math.abs(value)).padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals);
  return `${value < 0 ? "-" : ""}${whole}${decimals > 0 ? `.${fraction}` : ""}`;
}

/**
 * Divides `amount` in proportion to `weights` so that the parts add up to the
 * amount exactly (largest remainder). Works on the absolute value and puts the
 * sign back, so a refund splits exactly like the expense it reverses. The
 * remainder minor units go to the largest fractional parts; ties go to the
 * earlier weight, so callers pass the weights in a stable order. A weight of
 * 0 never receives anything. Weights need not sum to 10000.
 */
export function allocate(amount: Minor, weights: readonly number[]): Minor[] {
  if (weights.length === 0) {
    throw new RangeError("Cannot divide an amount between nobody");
  }
  for (const w of weights) {
    if (!Number.isSafeInteger(w) || w < 0) {
      throw new RangeError(`Weights must be non-negative integers, got ${w}`);
    }
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) throw new RangeError("Weights must not all be zero");
  const abs = BigInt(Math.abs(amount));
  const total = BigInt(sum);
  const parts = weights.map((w, index) => {
    const product = abs * BigInt(w);
    return { index, w, base: product / total, rem: product % total };
  });
  let left = abs - parts.reduce((acc, part) => acc + part.base, 0n);
  const order = parts
    .filter((p) => p.w > 0)
    .sort((a, b) =>
      a.rem === b.rem ? a.index - b.index : a.rem < b.rem ? 1 : -1,
    );
  const out = parts.map((p) => p.base);
  for (const p of order) {
    if (left === 0n) break;
    out[p.index] += 1n;
    left -= 1n;
  }
  return out.map((v) => minor(amount < 0 && v !== 0n ? -Number(v) : Number(v)));
}
