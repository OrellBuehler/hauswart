export const WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_USER_IP = 5;
export const MAX_FAILURES_PER_USER = 20;
export const MAX_FAILURES_PER_IP = 20;

const SWEEP_THRESHOLD = 5000;

export class RateLimitedError extends Error {
  constructor(readonly retryAfterMs: number) {
    const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
    super(
      `Too many attempts, try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
    );
    this.name = "RateLimitedError";
  }

  get retryAfterSeconds(): number {
    return Math.max(1, Math.ceil(this.retryAfterMs / 1000));
  }
}

export type Acquired =
  | {
      allowed: true;
      /** Call after a successful attempt: refunds the reservation and clears the username+IP counter. */
      release: () => void;
    }
  | { allowed: false; retryAfterMs: number; retryAfterMinutes: number };

/**
 * Sliding-window failure limiter. An attempt is *reserved* synchronously
 * (before any await) and only refunded on success, so parallel guesses cannot
 * slip past the check while an earlier one is still being verified.
 *
 * Three counters: username+IP (tight), IP (across usernames), and username
 * across all IPs (looser). The last one stops a distributed guess against one
 * account, at the price that an attacker can lock a known username out for up
 * to one window by deliberately failing; the looser cap keeps that
 * unattractive while a legitimate user on their usual IP is only hit by the
 * tighter counters of others.
 */
export class LoginRateLimiter {
  private failures = new Map<string, number[]>();

  constructor(
    private readonly clock: () => number = Date.now,
    private readonly windowMs = WINDOW_MS,
    private readonly maxPerUserIp = MAX_FAILURES_PER_USER_IP,
    private readonly maxPerIp = MAX_FAILURES_PER_IP,
    private readonly maxPerUser = MAX_FAILURES_PER_USER,
  ) {}

  private userIpKey(username: string, ip: string): string {
    return `u|${ip}|${username}`;
  }

  private ipKey(ip: string): string {
    return `ip|${ip}`;
  }

  private userKey(username: string): string {
    return `n|${username}`;
  }

  private recent(key: string, now: number): number[] {
    const list = this.failures.get(key);
    if (!list) return [];
    const cutoff = now - this.windowMs;
    const kept = list.filter((t) => t > cutoff);
    if (kept.length === 0) this.failures.delete(key);
    else if (kept.length !== list.length) this.failures.set(key, kept);
    return kept;
  }

  private blockedFor(key: string, max: number, now: number): number {
    const list = this.recent(key, now);
    if (list.length < max) return 0;
    return list[list.length - max] + this.windowMs - now;
  }

  /** Synchronously checks the limits and, if allowed, reserves one attempt. */
  acquire(username: string, ip: string): Acquired {
    const now = this.clock();
    const uiKey = this.userIpKey(username, ip);
    const ipKey = this.ipKey(ip);
    const uKey = this.userKey(username);
    const wait = Math.max(
      this.blockedFor(uiKey, this.maxPerUserIp, now),
      this.blockedFor(ipKey, this.maxPerIp, now),
      this.blockedFor(uKey, this.maxPerUser, now),
    );
    if (wait > 0) {
      return {
        allowed: false,
        retryAfterMs: wait,
        retryAfterMinutes: Math.max(1, Math.ceil(wait / 60_000)),
      };
    }
    if (this.failures.size > SWEEP_THRESHOLD) this.sweep(now);
    for (const key of [uiKey, ipKey, uKey]) {
      const list = this.recent(key, now);
      list.push(now);
      this.failures.set(key, list);
    }
    return {
      allowed: true,
      release: () => {
        this.removeOne(ipKey, now);
        this.removeOne(uKey, now);
        this.failures.delete(uiKey);
      },
    };
  }

  /** Throws RateLimitedError when blocked. */
  acquireOrThrow(username: string, ip: string): () => void {
    const r = this.acquire(username, ip);
    if (!r.allowed) throw new RateLimitedError(r.retryAfterMs);
    return r.release;
  }

  private removeOne(key: string, stamp: number): void {
    const list = this.failures.get(key);
    if (!list) return;
    const i = list.indexOf(stamp);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) this.failures.delete(key);
  }

  reset(): void {
    this.failures.clear();
  }

  private sweep(now: number): void {
    for (const key of [...this.failures.keys()]) this.recent(key, now);
  }
}

export type Hit = { allowed: true } | { allowed: false; retryAfterMs: number };

/**
 * Sliding-window request counter: at most `max` hits per key in `windowMs`.
 * Every hit counts, successful or not. Used for per-token and per-IP request
 * limits in `bind`; credential guessing is limited by LoginRateLimiter.
 */
export class RequestRateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly clock: () => number = Date.now,
  ) {}

  hit(key: string): Hit {
    const now = this.clock();
    const cutoff = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return { allowed: false, retryAfterMs: list[0] + this.windowMs - now };
    }
    if (this.hits.size > SWEEP_THRESHOLD) this.sweep(cutoff);
    list.push(now);
    this.hits.set(key, list);
    return { allowed: true };
  }

  /** Whether `key` is over its limit, without counting a hit. */
  peek(key: string): Hit {
    const now = this.clock();
    const cutoff = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length >= this.max) {
      return { allowed: false, retryAfterMs: list[0] + this.windowMs - now };
    }
    return { allowed: true };
  }

  reset(): void {
    this.hits.clear();
  }

  private sweep(cutoff: number): void {
    for (const [key, list] of this.hits) {
      if (list.every((t) => t <= cutoff)) this.hits.delete(key);
    }
  }
}

/** Password guesses at `POST /auth/login` and `POST /auth/token` share one budget. */
export const loginRateLimiter = new LoginRateLimiter();

/** Requests per bearer token (keyed by token id). */
export const TOKEN_REQUESTS_PER_MINUTE = 300;
export const tokenRequestLimiter = new RequestRateLimiter(
  TOKEN_REQUESTS_PER_MINUTE,
  60_000,
);

/** State-changing requests per client address on public endpoints (login, setup, token). */
export const PUBLIC_POSTS_PER_MINUTE = 30;
export const publicRequestLimiter = new RequestRateLimiter(
  PUBLIC_POSTS_PER_MINUTE,
  60_000,
);

/** Markdown previews per user (the editor previews while typing, debounced). */
export const PREVIEWS_PER_MINUTE = 60;
export const previewRequestLimiter = new RequestRateLimiter(
  PREVIEWS_PER_MINUTE,
  60_000,
);

/** Requests per client address on the public calendar feeds and guest pages. */
export const SHARE_REQUESTS_PER_MINUTE = 240;
export const shareRequestLimiter = new RequestRateLimiter(
  SHARE_REQUESTS_PER_MINUTE,
  60_000,
);

/** Requests per feed token or guest link (all addresses together). */
export const SHARE_TOKEN_REQUESTS_PER_MINUTE = 120;
export const shareTokenLimiter = new RequestRateLimiter(
  SHARE_TOKEN_REQUESTS_PER_MINUTE,
  60_000,
);

/** Unknown, expired or revoked tokens presented per client address: guessing is cheap to spot. */
export const SHARE_MISSES_PER_WINDOW = 20;
export const shareMissLimiter = new RequestRateLimiter(
  SHARE_MISSES_PER_WINDOW,
  WINDOW_MS,
);

/** Wrong guest PINs: per link and address, per link, per address. */
export const guestPinRateLimiter = new LoginRateLimiter(
  Date.now,
  WINDOW_MS,
  5,
  20,
  10,
);

/** Test hook: forget all counters. */
export function resetRateLimiters(): void {
  shareRequestLimiter.reset();
  shareTokenLimiter.reset();
  shareMissLimiter.reset();
  guestPinRateLimiter.reset();
  loginRateLimiter.reset();
  tokenRequestLimiter.reset();
  publicRequestLimiter.reset();
  previewRequestLimiter.reset();
}
