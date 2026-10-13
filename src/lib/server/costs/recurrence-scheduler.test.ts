import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCostRecurrenceRequestSchema } from "$lib/api/schemas/cost-recurrences";
import { at, ctxAt } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import type { ServiceContext } from "$lib/server/service";
import { listCosts } from "./costs";
import {
  RECURRENCE_INTERVAL_MS,
  registerCostRecurrences,
} from "./recurrence-scheduler";
import { createCostRecurrence } from "./recurrences";

describe("registerCostRecurrences", () => {
  const test = useTestDB();
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("runs once shortly after start and then on the interval, and stops when told to", async () => {
    const run = vi.fn(async () => {});
    const stop = registerCostRecurrences({
      run,
      intervalMs: 1000,
      firstRunDelayMs: 10,
    });
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("checks every five minutes by default", () => {
    expect(RECURRENCE_INTERVAL_MS).toBe(5 * 60 * 1000);
  });

  it("never overlaps ticks", async () => {
    let release: () => void = () => {};
    const run = vi.fn(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const stop = registerCostRecurrences({
      run,
      intervalMs: 100,
      firstRunDelayMs: 10,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(2);
    release();
    stop();
  });

  it("logs a failing tick by name only and keeps going", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const run = vi
      .fn()
      .mockRejectedValueOnce(new RangeError("private detail"))
      .mockResolvedValue(undefined);
    const stop = registerCostRecurrences({
      run,
      intervalMs: 100,
      firstRunDelayMs: 10,
    });
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("RangeError");
    expect(String(error.mock.calls[0][0])).not.toContain("private detail");
    stop();
  });

  it("hands the injected clock and the database to every tick", async () => {
    const seen: ServiceContext[] = [];
    let now = at("2026-03-01");
    const stop = registerCostRecurrences({
      run: (ctx) => {
        seen.push(ctx);
      },
      clock: () => now,
      intervalMs: 100,
      firstRunDelayMs: 10,
    });
    await vi.advanceTimersByTimeAsync(10);
    now = at("2026-03-02");
    await vi.advanceTimersByTimeAsync(100);
    stop();
    expect(seen.map((c) => c.now)).toEqual([
      at("2026-03-01"),
      at("2026-03-02"),
    ]);
    expect(seen[0].db).toBe(test.db);
  });

  it("books what is due, each occurrence once however many ticks pass, and catches up the day after", async () => {
    createCostRecurrence(
      ctxAt(test.db),
      createCostRecurrenceRequestSchema.parse({
        title: "Miete",
        amountMinor: 150000,
        category: "other",
        frequency: "monthly",
        startDate: "2026-01-31",
        dayOfMonth: 31,
        splitMode: "none",
      }),
      null,
    );
    let now = at("2026-02-27", "12:00");
    const stop = registerCostRecurrences({
      clock: () => now,
      intervalMs: 100,
      firstRunDelayMs: 10,
    });
    const dates = () =>
      listCosts(ctxAt(test.db), {}, { limit: 50 }, "me")
        .items.map((e) => e.date)
        .sort();
    await vi.advanceTimersByTimeAsync(10);
    expect(dates()).toEqual(["2026-01-31"]);
    await vi.advanceTimersByTimeAsync(500);
    expect(dates()).toEqual(["2026-01-31"]);
    // The server was down over the end of February and into April.
    now = at("2026-04-02", "08:00");
    await vi.advanceTimersByTimeAsync(100);
    expect(dates()).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(dates()).toHaveLength(3);
    stop();
  });
});
