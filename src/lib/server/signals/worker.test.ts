import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createAsset } from "$lib/server/assets/assets";
import { createHint } from "$lib/server/hints/hints";
import {
  notificationDeliveries,
  notifications,
  pendingReactions,
} from "$lib/server/db";
import * as db from "$lib/server/db";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { createHintRequestSchema } from "$lib/api/schemas/hints";
import { registerNotificationChannel } from "$lib/server/notifications/channels";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { at } from "$lib/testing/domain";
import { ingestSignals } from "./ingest";
import { listSamples, upsertSignals } from "./service";
import { registerSignalWorker, runSignalWorker } from "./worker";

const MIN = 60_000;
const DOOR = "binary_sensor.example_garage";
const reading = (value: string, changedAt: number) => ({
  key: DOOR,
  numeric: null,
  text: value,
  changedAt,
});

describe("signal worker", () => {
  const test = useTestDB();
  const stops: (() => void)[] = [];
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "setInterval",
        "clearTimeout",
        "clearInterval",
        "Date",
      ],
    });
    vi.setSystemTime(at("2026-06-15", "09:00"));
  });
  afterEach(() => {
    stops.splice(0).forEach((s) => s());
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function reactingHint(delayMinutes: number) {
    const user = await createTestUser();
    const asset = createAsset(
      { db: test.db },
      createAssetRequestSchema.parse({ name: "Garage door" }),
    );
    createHint(
      { db: test.db },
      asset.id,
      createHintRequestSchema.parse({
        title: "Close the door",
        reaction: {
          type: "signal_change",
          entityId: DOOR,
          toState: "open",
          delayMinutes,
          notify: "all",
        },
      }),
    );
    await ingestSignals(
      { db: test.db, now: Date.now() },
      [reading("closed", Date.now())],
      "ha",
    );
    vi.setSystemTime(Date.now() + MIN);
    await ingestSignals(
      { db: test.db, now: Date.now() },
      [reading("open", Date.now())],
      "ha",
    );
    return user;
  }
  const hints = () =>
    test.db
      .select()
      .from(notifications)
      .where(eq(notifications.kind, "hint"))
      .all();

  it("fires a reaction once its delay has passed, within one worker interval", async () => {
    const user = await reactingHint(10);
    const delivered: string[] = [];
    stops.push(
      registerNotificationChannel({
        name: "test",
        deliver: (n, recipient) => {
          if (n.kind === "hint") delivered.push(recipient.id);
          return [];
        },
      }),
    );
    stops.push(
      registerSignalWorker({ intervalMs: 30_000, firstRunDelayMs: 1_000 }),
    );
    await vi.advanceTimersByTimeAsync(9 * MIN);
    expect(hints()).toEqual([]);
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(hints()).toHaveLength(1);
    expect(hints()[0].userId).toBe(user.id);
    expect(delivered).toEqual([user.id]);
    // and not again
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(hints()).toHaveLength(1);
    expect(delivered).toHaveLength(1);
  });

  it("a restart in between loses nothing: the pending reaction is in the database", async () => {
    await reactingHint(10);
    const first = registerSignalWorker({
      intervalMs: 30_000,
      firstRunDelayMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(4 * MIN);
    first();
    expect(test.db.select().from(pendingReactions).all()[0].status).toBe(
      "pending",
    );
    // the process is gone for a while; a new one starts later
    vi.setSystemTime(Date.now() + 20 * MIN);
    stops.push(
      registerSignalWorker({ intervalMs: 30_000, firstRunDelayMs: 1_000 }),
    );
    await vi.advanceTimersByTimeAsync(2_000);
    expect(hints()).toHaveLength(1);
  });

  it("a state that went back before the delay ended sends nothing", async () => {
    await reactingHint(10);
    vi.setSystemTime(Date.now() + 3 * MIN);
    await ingestSignals(
      { db: test.db, now: Date.now() },
      [reading("closed", Date.now())],
      "ha",
    );
    stops.push(
      registerSignalWorker({ intervalMs: 30_000, firstRunDelayMs: 1_000 }),
    );
    await vi.advanceTimersByTimeAsync(20 * MIN);
    expect(hints()).toEqual([]);
  });

  it("logs a failing pass by name and keeps going", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const spy = vi.spyOn(db, "getDB").mockImplementation(() => {
      throw new TypeError("secret detail");
    });
    stops.push(
      registerSignalWorker({ intervalMs: 1_000, firstRunDelayMs: 100 }),
    );
    await vi.advanceTimersByTimeAsync(3_000);
    const logged = error.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("signals.worker_failed");
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("secret detail");
    spy.mockRestore();
  });

  it("stopping the worker stops the passes", async () => {
    await reactingHint(1);
    const stop = registerSignalWorker({
      intervalMs: 30_000,
      firstRunDelayMs: 1_000,
    });
    stop();
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(hints()).toEqual([]);
  });

  it("prunes old samples now and then", async () => {
    const old = at("2024-01-01");
    upsertSignals(
      { db: test.db, now: old },
      [{ key: "sensor.example_old", numeric: 1, text: "1", changedAt: old }],
      "ha",
    );
    expect(listSamples({ db: test.db }, "sensor.example_old")).toHaveLength(1);
    stops.push(
      registerSignalWorker({ intervalMs: 30_000, firstRunDelayMs: 1_000 }),
    );
    await vi.advanceTimersByTimeAsync(2_000);
    expect(listSamples({ db: test.db }, "sensor.example_old")).toEqual([]);
  });

  it("also drops delivery records after 90 days", async () => {
    const user = await createTestUser();
    const row = test.db
      .insert(notifications)
      .values({
        userId: user.id,
        kind: "info",
        dedupeKey: "old",
        titleKey: "notification_info",
      })
      .returning()
      .get();
    const old = Date.now() - 91 * 24 * 60 * MIN;
    test.db
      .insert(notificationDeliveries)
      .values({
        notificationId: row.id,
        userId: user.id,
        channel: "test",
        status: "sent",
        sentAt: new Date(old),
      })
      .run();
    stops.push(
      registerSignalWorker({ intervalMs: 30_000, firstRunDelayMs: 1_000 }),
    );
    await vi.advanceTimersByTimeAsync(2_000);
    expect(test.db.select().from(notificationDeliveries).all()).toEqual([]);
    expect(test.db.select().from(notifications).all()).toHaveLength(1);
  });

  it("runSignalWorker reports what it did", async () => {
    await reactingHint(0);
    expect(await runSignalWorker({ db: test.db, now: Date.now() })).toEqual({
      reactions: 0,
      delivered: 0,
    });
  });
});
