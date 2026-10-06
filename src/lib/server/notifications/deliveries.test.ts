import { afterEach, describe, expect, it, vi } from "vitest";
import { notificationDeliveries, notifications } from "$lib/server/db";
import { completeTask } from "$lib/server/tasks/completions";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, everyDays, makeTask } from "$lib/testing/domain";
import { hashActionToken } from "./actions";
import {
  registerNotificationChannel,
  type DeliveryOutcome,
  type NotificationChannel,
} from "./channels";
import {
  DELIVERY_EXPIRY_MS,
  MAX_DELIVERY_ATTEMPTS,
  retryDeliveries,
} from "./deliveries";
import { generateNotifications } from "./generate";
import { saveSettings } from "./settings";

const MIN = 60_000;

describe("outward deliveries", () => {
  const test = useTestDB();
  const ctx = (when: string, time = "12:00") => ctxAt(test.db, at(when, time));
  const stops: (() => void)[] = [];
  afterEach(() => {
    stops.splice(0).forEach((s) => s());
    vi.restoreAllMocks();
  });

  function channel(
    outcomes: (call: number) => DeliveryOutcome[] | Error = () => [
      { status: "sent", target: "phone" },
    ],
  ) {
    const deliver = vi.fn<NotificationChannel["deliver"]>(() => {
      const result = outcomes(deliver.mock.calls.length);
      if (result instanceof Error) throw result;
      return result;
    });
    stops.push(registerNotificationChannel({ name: "test", deliver }));
    return deliver;
  }

  const prefs = (userId: string, over: Record<string, unknown> = {}) =>
    saveSettings(ctx("2026-06-15"), userId, {
      pushEnabled: true,
      quietStart: null,
      quietEnd: null,
      pushStages: [
        "prep",
        "due_soon",
        "due",
        "overdue",
        "digest",
        "hint",
        "comment",
      ],
      targets: [],
      ...over,
    });

  const rows = () => test.db.select().from(notificationDeliveries).all();

  async function dueTask() {
    return makeTask(ctx("2026-06-15"), {
      title: "Filter",
      trigger: everyDays(30, "2026-06-15", "schedule"),
    });
  }

  it("mints a one-time token per recipient for task stages and stores only its hash", async () => {
    const anna = await createTestUser();
    const ben = await createTestUser();
    const deliver = channel();
    const task = await dueTask();
    await generateNotifications(ctx("2026-06-15", "07:00"));
    const due = deliver.mock.calls.filter(([n]) => n.kind === "due");
    expect(due).toHaveLength(2);
    const tokens = due.map(([, , request]) => request.actions[0]);
    expect(
      tokens.every((a) => a.kind === "complete" && a.id.length >= 32),
    ).toBe(true);
    expect(new Set(tokens.map((a) => a.id)).size).toBe(2);
    expect(due[0][0]).toMatchObject({
      taskId: task.id,
      occurrenceKey: "2026-06-15",
    });

    const stored = rows().filter((r) => r.occurrenceKey === "2026-06-15");
    expect(stored).toHaveLength(2);
    for (const row of stored) {
      expect(row).toMatchObject({
        channel: "test",
        target: "phone",
        status: "sent",
        attempts: 1,
      });
      expect(row.actionExpiresAt?.getTime()).toBe(
        at("2026-06-15", "07:00") + 7 * 24 * 60 * MIN,
      );
      expect(row.actionUsedAt).toBeNull();
      expect(tokens.map((a) => hashActionToken(a.id))).toContain(
        row.actionTokenHash,
      );
      expect(JSON.stringify(row)).not.toContain(tokens[0].id);
    }
    expect(stored.map((r) => r.userId).sort()).toEqual(
      [anna.id, ben.id].sort(),
    );
  });

  it("other notifications carry no action", async () => {
    const anna = await createTestUser();
    prefs(anna.id);
    const deliver = channel();
    await generateNotifications(ctx("2026-06-15", "07:00"));
    await dueTask();
    await generateNotifications(ctx("2026-06-15", "09:00"));
    const digest = deliver.mock.calls.filter(([n]) => n.kind === "digest");
    expect(digest.length).toBeGreaterThan(0);
    expect(digest.every(([, , r]) => r.actions.length === 0)).toBe(true);
    expect(rows().filter((r) => r.actionTokenHash !== null)).toHaveLength(1);
  });

  it("sends nothing to people who turned push off or did not choose the stage", async () => {
    const [anna, ben, cleo] = [
      await createTestUser(),
      await createTestUser(),
      await createTestUser(),
    ];
    prefs(anna.id, { pushEnabled: false });
    prefs(ben.id, { pushStages: ["overdue"] });
    const deliver = channel();
    await dueTask();
    await generateNotifications(ctx("2026-06-15", "07:00"));
    const recipients = deliver.mock.calls
      .filter(([n]) => n.kind === "due")
      .map(([, r]) => r.id);
    expect(recipients).toEqual([cleo.id]);
    expect(rows().every((r) => r.userId === cleo.id)).toBe(true);
  });

  it("gives the channel the recipient's language", async () => {
    await createTestUser({ locale: "en" });
    const deliver = channel();
    await dueTask();
    await generateNotifications(ctx("2026-06-15", "07:00"));
    expect(deliver.mock.calls[0][1]).toMatchObject({ locale: "en" });
  });

  describe("quiet hours", () => {
    it("holds a notification back and sends it, with a fresh token, once they are over", async () => {
      const anna = await createTestUser();
      prefs(anna.id, { quietStart: "22:00", quietEnd: "07:00" });
      const deliver = channel();
      await dueTask();
      await generateNotifications(ctx("2026-06-15", "06:00"));
      expect(deliver).not.toHaveBeenCalled();
      const held = rows().filter((r) => r.occurrenceKey === "2026-06-15");
      expect(held).toHaveLength(1);
      expect(held[0]).toMatchObject({
        status: "deferred",
        channel: "test",
        target: "",
        attempts: 0,
      });

      expect(await retryDeliveries(ctx("2026-06-15", "06:30"))).toMatchObject({
        sent: 0,
      });
      expect(deliver).not.toHaveBeenCalled();

      expect(await retryDeliveries(ctx("2026-06-15", "07:00"))).toMatchObject({
        sent: 1,
      });
      expect(deliver).toHaveBeenCalledTimes(1);
      const [n, recipient, request] = deliver.mock.calls[0];
      expect(n).toMatchObject({ kind: "due", occurrenceKey: "2026-06-15" });
      expect(recipient.id).toBe(anna.id);
      expect(request.actions).toHaveLength(1);
      const after = rows().filter((r) => r.occurrenceKey === "2026-06-15");
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({
        status: "sent",
        attempts: 1,
        target: "phone",
      });
      expect(after[0].actionTokenHash).toBe(
        hashActionToken(request.actions[0].id),
      );
    });

    it("drops what became stale while it waited: settled, read or too old", async () => {
      const anna = await createTestUser();
      prefs(anna.id, { quietStart: "22:00", quietEnd: "07:00" });
      const deliver = channel();
      const task = await dueTask();
      await generateNotifications(ctx("2026-06-15", "06:00"));
      await completeTask(ctx("2026-06-15", "06:10"), task.id, {
        kind: "done",
        source: "manual",
        userId: anna.id,
      });
      expect(await retryDeliveries(ctx("2026-06-15", "07:00"))).toMatchObject({
        skipped: 1,
      });
      expect(deliver).not.toHaveBeenCalled();
      expect(rows().find((r) => r.status === "skipped")?.errorCode).toBe(
        "stale",
      );
    });

    async function held() {
      const anna = await createTestUser();
      prefs(anna.id, { quietStart: "22:00", quietEnd: "07:00" });
      const deliver = channel();
      await dueTask();
      await generateNotifications(ctx("2026-06-15", "03:00"));
      expect(rows().length).toBeGreaterThan(0);
      return { anna, deliver };
    }

    it("drops a held notification that has been read", async () => {
      const { deliver } = await held();
      test.db
        .update(notifications)
        .set({ readAt: new Date(at("2026-06-15", "03:30")) })
        .run();
      await retryDeliveries(ctx("2026-06-15", "07:00"));
      expect(
        rows().every((r) => r.status === "skipped" && r.errorCode === "read"),
      ).toBe(true);
      expect(deliver).not.toHaveBeenCalled();
    });

    it("drops a held notification that is older than a day", async () => {
      const { deliver } = await held();
      const later = at("2026-06-15", "03:00") + DELIVERY_EXPIRY_MS + MIN;
      await retryDeliveries({ db: test.db, now: later });
      expect(
        rows().every(
          (r) => r.status === "skipped" && r.errorCode === "expired",
        ),
      ).toBe(true);
      expect(deliver).not.toHaveBeenCalled();
    });
  });

  describe("failures", () => {
    it("records a failed target and retries it twice, then gives up", async () => {
      await createTestUser();
      const deliver = channel(() => [
        { status: "failed", target: "phone", error: "timeout" },
      ]);
      await dueTask();
      await generateNotifications(ctx("2026-06-15", "07:00"));
      const first = () => rows().find((r) => r.occurrenceKey === "2026-06-15")!;
      expect(first()).toMatchObject({
        status: "failed",
        errorCode: "timeout",
        attempts: 1,
        actionTokenHash: null,
      });

      await retryDeliveries(ctx("2026-06-15", "07:01"));
      expect(deliver.mock.calls.filter(([n]) => n.kind === "due")).toHaveLength(
        1,
      );
      await retryDeliveries(ctx("2026-06-15", "07:02"));
      expect(first()).toMatchObject({ attempts: 2, status: "failed" });
      expect(deliver.mock.calls.at(-1)![2].targets).toEqual(["phone"]);
      await retryDeliveries(ctx("2026-06-15", "07:05"));
      await retryDeliveries(ctx("2026-06-15", "07:06"));
      expect(first()).toMatchObject({
        attempts: MAX_DELIVERY_ATTEMPTS,
        status: "failed",
      });
      await retryDeliveries(ctx("2026-06-15", "09:00"));
      expect(deliver.mock.calls.filter(([n]) => n.kind === "due")).toHaveLength(
        MAX_DELIVERY_ATTEMPTS,
      );
    });

    it("a retry that succeeds stores the token", async () => {
      await createTestUser();
      channel((call) =>
        call <= 1
          ? [{ status: "failed", target: "phone", error: "network" }]
          : [{ status: "sent", target: "phone" }],
      );
      await dueTask();
      await generateNotifications(ctx("2026-06-15", "07:00"));
      await retryDeliveries(ctx("2026-06-15", "07:02"));
      const row = rows().find((r) => r.occurrenceKey === "2026-06-15")!;
      expect(row).toMatchObject({ status: "sent", attempts: 2 });
      expect(row.actionTokenHash).not.toBeNull();
    });

    it("a channel that throws is one failed delivery, logged by name only", async () => {
      await createTestUser();
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      channel(() => new TypeError("leaky detail"));
      await dueTask();
      await generateNotifications(ctx("2026-06-15", "07:00"));
      const row = rows().find((r) => r.occurrenceKey === "2026-06-15")!;
      expect(row).toMatchObject({
        status: "failed",
        errorCode: "TypeError",
        target: "",
      });
      const logged = error.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain('"channel":"test"');
      expect(logged).not.toContain("leaky detail");
    });

    it("targets that were skipped leave no trace", async () => {
      await createTestUser();
      channel(() => [{ status: "skipped" }]);
      await dueTask();
      await generateNotifications(ctx("2026-06-15", "07:00"));
      expect(rows()).toEqual([]);
    });

    it("a channel that no longer exists keeps its held-back rows for later", async () => {
      const anna = await createTestUser();
      prefs(anna.id, { quietStart: "22:00", quietEnd: "07:00" });
      const stop = registerNotificationChannel({
        name: "gone",
        deliver: () => [],
      });
      await dueTask();
      await generateNotifications(ctx("2026-06-15", "06:00"));
      stop();
      await retryDeliveries(ctx("2026-06-15", "08:00"));
      expect(rows().every((r) => r.status === "deferred")).toBe(true);
    });
  });
});
