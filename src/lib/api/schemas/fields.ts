import { z } from "zod";

/** Optional web address: `http`/`https` only; an empty string clears it. */
export function nullableHttpUrl(max = 2048) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .pipe(
      z
        .url({ protocol: /^https?$/, error: "Expected an http(s) URL." })
        .nullable(),
    );
}

/** Optional e-mail address; an empty string clears it. */
export function nullableEmail(max = 254) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .pipe(z.email().nullable());
}

/** Money in integer minor units. */
export const minorAmountSchema = z.number().int().min(0).max(1_000_000_000_00);
