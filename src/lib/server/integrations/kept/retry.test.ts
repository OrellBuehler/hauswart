import { describe, expect, it, vi } from "vitest";
import { KeptError } from "./errors";
import { parseRetryAfter, withRetry } from "./retry";

const sleeps = () => {
  const sleep = vi.fn(async (_ms: number) => {});
  return sleep;
};

describe("withRetry", () => {
  it("returns the first success without sleeping", async () => {
    const sleep = sleeps();
    expect(await withRetry(async () => 7, { sleep })).toBe(7);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries rate_limited by Retry-After and server errors by backoff, at most twice", async () => {
    const sleep = sleeps();
    let calls = 0;
    const result = await withRetry(
      async (attempt) => {
        calls++;
        if (attempt === 0)
          throw new KeptError("rate_limited", { retryAfter: 4 });
        if (attempt === 1) throw new KeptError("server", { status: 502 });
        return "ok";
      },
      { sleep },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([4000, 1000]);
  });

  it("falls back to a stepped wait without Retry-After", async () => {
    const sleep = sleeps();
    await expect(
      withRetry(
        async () => {
          throw new KeptError("rate_limited", { status: 429 });
        },
        { sleep },
      ),
    ).rejects.toMatchObject({ code: "rate_limited" });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it("honours maxRetries", async () => {
    const sleep = sleeps();
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new KeptError("server");
        },
        { sleep, maxRetries: 0 },
      ),
    ).rejects.toMatchObject({ code: "server" });
    expect(calls).toBe(1);
    calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new KeptError("server");
        },
        { sleep, maxRetries: 4, baseDelayMs: 10 },
      ),
    ).rejects.toMatchObject({ code: "server" });
    expect(calls).toBe(5);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([10, 20, 40, 80]);
  });

  it("throws other errors immediately", async () => {
    const sleep = sleeps();
    for (const code of [
      "unauthorized",
      "forbidden",
      "not_found",
      "bad_request",
      "timeout",
      "network",
      "invalid_response",
    ] as const) {
      let calls = 0;
      await expect(
        withRetry(
          async () => {
            calls++;
            throw new KeptError(code);
          },
          { sleep },
        ),
      ).rejects.toMatchObject({ code });
      expect(calls, code).toBe(1);
    }
    await expect(
      withRetry(
        async () => {
          throw new TypeError("boom");
        },
        { sleep },
      ),
    ).rejects.toThrow(TypeError);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("rethrows a Retry-After above maxDelayMs without waiting", async () => {
    const sleep = sleeps();
    await expect(
      withRetry(
        async () => {
          throw new KeptError("rate_limited", { retryAfter: 120 });
        },
        { sleep, maxDelayMs: 30_000 },
      ),
    ).rejects.toMatchObject({ retryAfter: 120 });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("actually waits with the default sleep", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const p = withRetry(async () => {
        if (calls++ === 0)
          throw new KeptError("rate_limited", { retryAfter: 2 });
        return "done";
      });
      await vi.advanceTimersByTimeAsync(1999);
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(2);
      expect(await p).toBe("done");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("parseRetryAfter", () => {
  it("reads delta-seconds, HTTP dates, and clamps", () => {
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter(" 17 ")).toBe(17);
    expect(parseRetryAfter("999999")).toBe(3600);
    const now = Date.parse("2026-10-06T12:00:00Z");
    expect(parseRetryAfter("Tue, 06 Oct 2026 12:00:30 GMT", now)).toBe(30);
    expect(parseRetryAfter("Tue, 06 Oct 2026 11:00:00 GMT", now)).toBe(0);
  });

  it("returns null for absent or unusable values", () => {
    for (const v of [null, "", "  ", "soon", "-5", "1.5", "12abc"]) {
      expect(parseRetryAfter(v), String(v)).toBeNull();
    }
  });
});
