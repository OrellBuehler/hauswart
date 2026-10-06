import { KeptError } from "./errors";

export interface RetryOptions {
  /** Retries after the first attempt (default 2). */
  maxRetries?: number;
  /** First back-off for a server error; doubles per retry (default 500 ms). */
  baseDelayMs?: number;
  /** Longest wait accepted; a `Retry-After` beyond it is not waited out but thrown (default 60 s). */
  maxDelayMs?: number;
  /** Replaceable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_BASE_DELAY_MS = 500;
export const DEFAULT_MAX_DELAY_MS = 60_000;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn` and retries it after a 429 or a 5xx answer (`rate_limited` /
 * `server`), honouring `Retry-After`. Every other failure, and the last
 * attempt's own error, is thrown unchanged. Only use it for idempotent reads.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
  const baseDelay = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelay = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (
        attempt >= maxRetries ||
        !(err instanceof KeptError) ||
        (err.code !== "rate_limited" && err.code !== "server")
      ) {
        throw err;
      }
      const delay =
        err.retryAfter !== null
          ? err.retryAfter * 1000
          : err.code === "rate_limited"
            ? 1000 * (attempt + 1)
            : baseDelay * 2 ** attempt;
      if (delay > maxDelay) throw err;
      await sleep(delay);
    }
  }
}

/** `Retry-After` as whole seconds (0 to 3600), from delta-seconds or an HTTP date; null when absent or unusable. */
export function parseRetryAfter(
  value: string | null,
  now: number = Date.now(),
): number | null {
  if (value === null) return null;
  const raw = value.trim();
  if (raw === "") return null;
  let seconds: number;
  if (/^\d{1,9}$/.test(raw)) {
    seconds = Number(raw);
  } else {
    if (!/[a-z]/i.test(raw)) return null;
    const at = Date.parse(raw);
    if (Number.isNaN(at)) return null;
    seconds = Math.ceil((at - now) / 1000);
  }
  return Math.min(3600, Math.max(0, seconds));
}
