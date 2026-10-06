import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, everyDays, makeTask, NOW } from "$lib/testing/domain";
import { createTestUser } from "$lib/testing/auth";
import { notifications } from "$lib/server/db";
import type { ServiceContext } from "$lib/server/service";
import {
  EVALUATION_INTERVAL_MS,
  registerEvaluator,
  runEvaluationCycle,
} from "./scheduler";
import { getTask } from "./tasks";

describe("registerEvaluator", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("runs once shortly after start and then on the interval", async () => {
    const run = vi.fn(async () => {});
    const stop = registerEvaluator({
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

  it("never overlaps ticks", async () => {
    let release: () => void = () => {};
    const run = vi.fn(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const stop = registerEvaluator({
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

  it("logs a failing tick by name and keeps going", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const run = vi
      .fn()
      .mockRejectedValueOnce(new RangeError("private detail"))
      .mockResolvedValue(undefined);
    const stop = registerEvaluator({
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

  it("hands the clock to every tick and defaults to a five minute interval", async () => {
    expect(EVALUATION_INTERVAL_MS).toBe(5 * 60 * 1000);
    const run = vi.fn(async (_ctx: ServiceContext) => {});
    const stop = registerEvaluator({
      run,
      clock: () => 42,
      firstRunDelayMs: 1,
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(run.mock.calls[0][0]).toMatchObject({ now: 42 });
    await vi.advanceTimersByTimeAsync(EVALUATION_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  it("does not keep the process alive", () => {
    const unref = vi.fn();
    const spy = vi
      .spyOn(globalThis, "setInterval")
      .mockImplementation(
        () => ({ unref }) as unknown as ReturnType<typeof setInterval>,
      );
    const stop = registerEvaluator({ run: async () => {} });
    expect(unref).toHaveBeenCalled();
    spy.mockRestore();
    stop();
  });
});

describe("runEvaluationCycle", () => {
  const test = useTestDB();

  it("refreshes states and announces what became due in one pass", async () => {
    const user = await createTestUser();
    const ctx = ctxAt(test.db);
    const task = await makeTask(ctx, { trigger: everyDays(30, "2026-06-25") });
    const later = ctxAt(test.db, at("2026-06-25"));
    const result = await runEvaluationCycle(later);
    expect(result).toMatchObject({ evaluated: 1, failed: 0 });
    expect(getTask(ctx, task.id).state?.status).toBe("due");
    const rows = test.db.select().from(notifications).all();
    expect(rows.map((r) => [r.kind, r.userId])).toContainEqual([
      "due",
      user.id,
    ]);
    expect(NOW).toBeGreaterThan(0);
  });
});
