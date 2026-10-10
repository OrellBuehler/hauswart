import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { notificationDeliveries, notifications } from "$lib/server/db";
import { registerNotificationChannel } from "$lib/server/notifications/channels";
import { generateNotifications } from "$lib/server/notifications/generate";
import { retryDeliveries } from "$lib/server/notifications/deliveries";
import { saveSettings } from "$lib/server/notifications/settings";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, everyDays, makeTask } from "$lib/testing/domain";
import { createNotifyChannel } from "./channel";
import { renderPush } from "./render";
import { useFakeHomeAssistant } from "./testing";

interface Payload {
  title: string;
  message: string;
  data: {
    url: string;
    clickAction: string;
    tag: string;
    actions?: { action: string; title: string }[];
    push?: { "interruption-level": string };
  };
}

describe("ha_notify channel", () => {
  const test = useTestDB();
  const { fake, connect } = useFakeHomeAssistant();
  const stops: (() => void)[] = [];
  beforeEach(() => {
    stops.push(registerNotificationChannel(createNotifyChannel()));
  });
  afterEach(() => {
    stops.splice(0).forEach((s) => s());
    vi.restoreAllMocks();
  });
  const ctx = (when = "2026-06-15", time = "07:00") =>
    ctxAt(test.db, at(when, time));

  const settings = (userId: string, over: Record<string, unknown> = {}) =>
    saveSettings(ctx(), userId, {
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
      targets: [
        {
          channel: "ha_notify",
          target: "mobile_app_example_phone",
          enabled: true,
        },
      ],
      ...over,
    });

  const addServices = (...names: string[]) =>
    fake.services.get("notify")!.push(...names);

  const dueTask = () =>
    makeTask(ctx(), {
      title: "Filter wechseln",
      trigger: everyDays(30, "2026-06-15", "schedule"),
    });

  const dueCalls = () =>
    fake.notifications.filter(
      (c) =>
        (c.data as Payload).title === "Fällig" ||
        (c.data as Payload).title === "Due",
    );

  it("sends a task notification to the person's notify service with the link, tag and a done button", async () => {
    connect({ config: { appUrl: "https://app.example.org" } });
    const anna = await createTestUser({ locale: "de" });
    settings(anna.id);
    const task = await dueTask();
    await generateNotifications(ctx());

    const [call] = dueCalls();
    expect(call).toMatchObject({
      domain: "notify",
      service: "mobile_app_example_phone",
    });
    const payload = call.data as Payload;
    expect(payload.title).toBe("Fällig");
    expect(payload.message).toBe("«Filter wechseln» ist fällig (15.06.2026)");
    expect(payload.data).toMatchObject({
      url: `https://app.example.org/tasks/${task.id}`,
      clickAction: `https://app.example.org/tasks/${task.id}`,
      tag: `hw-task-${task.id}`,
      push: { "interruption-level": "active" },
    });
    expect(payload.data.actions).toHaveLength(1);
    expect(payload.data.actions![0]).toMatchObject({ title: "Erledigt" });
    expect(payload.data.actions![0].action).toMatch(
      /^HW_DONE_[A-Za-z0-9_-]{32}$/,
    );

    const row = test.db
      .select()
      .from(notificationDeliveries)
      .all()
      .find((r) => r.status === "sent" && r.actionTokenHash);
    expect(row).toMatchObject({
      channel: "ha_notify",
      target: "mobile_app_example_phone",
      userId: anna.id,
    });
  });

  it("writes the text in each recipient's language", async () => {
    connect();
    addServices("mobile_app_de", "mobile_app_en");
    const [de, en] = [
      await createTestUser({ locale: "de" }),
      await createTestUser({ locale: "en" }),
    ];
    settings(de.id, {
      targets: [
        { channel: "ha_notify", target: "mobile_app_de", enabled: true },
      ],
    });
    settings(en.id, {
      targets: [
        { channel: "ha_notify", target: "mobile_app_en", enabled: true },
      ],
    });
    await dueTask();
    await generateNotifications(ctx());
    const by = (service: string) =>
      fake.notifications
        .filter((c) => c.service === service)
        .map((c) => c.data as Payload)
        .find((p) => p.data.actions);
    expect(by("mobile_app_de")).toMatchObject({
      title: "Fällig",
      message: "«Filter wechseln» ist fällig (15.06.2026)",
    });
    expect(by("mobile_app_en")?.title).toBe("Due");
    expect(by("mobile_app_en")?.message).toBe(
      '"Filter wechseln" is due (15 Jun 2026)',
    );
    expect(by("mobile_app_en")?.data.actions?.[0].title).toBe("Done");
  });

  it("without an app address the link is the bare path; the ORIGIN environment is the fallback", async () => {
    connect();
    const anna = await createTestUser();
    settings(anna.id);
    const task = await dueTask();
    await generateNotifications(ctx());
    expect((dueCalls()[0].data as Payload).data.url).toBe(`/tasks/${task.id}`);
    fake.reset();
    vi.stubEnv("ORIGIN", "https://origin.example.org");
    try {
      test.db.delete(notifications).run();
      await generateNotifications(ctx("2026-06-15", "07:05"));
      expect((dueCalls()[0].data as Payload).data.url).toBe(
        `https://origin.example.org/tasks/${task.id}`,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("sends to every enabled target and reports a failing one without stopping the others", async () => {
    connect();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const anna = await createTestUser();
    settings(anna.id, {
      targets: [
        {
          channel: "ha_notify",
          target: "mobile_app_example_phone",
          enabled: true,
        },
        { channel: "ha_notify", target: "mobile_app_missing", enabled: true },
        { channel: "ha_notify", target: "mobile_app_off", enabled: false },
      ],
    });
    await dueTask();
    await generateNotifications(ctx());
    expect(fake.notifications.map((c) => c.service)).toEqual([
      "mobile_app_example_phone",
    ]);
    const rows = test.db
      .select()
      .from(notificationDeliveries)
      .all()
      .filter((r) => r.occurrenceKey === "2026-06-15");
    expect(rows.map((r) => [r.target, r.status, r.errorCode]).sort()).toEqual([
      ["mobile_app_example_phone", "sent", null],
      ["mobile_app_missing", "failed", "bad_request"],
    ]);
    // the retry addresses only the failed target
    addServices("mobile_app_missing");
    await retryDeliveries(ctx("2026-06-15", "07:03"));
    expect(fake.notifications.map((c) => c.service)).toEqual([
      "mobile_app_example_phone",
      "mobile_app_missing",
    ]);
    const after = test.db
      .select()
      .from(notificationDeliveries)
      .all()
      .filter((r) => r.target === "mobile_app_missing");
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("does nothing without a connection, with the connection switched off, or for people without targets", async () => {
    const anna = await createTestUser();
    const ben = await createTestUser();
    settings(anna.id);
    await dueTask();
    await generateNotifications(ctx("2026-06-15", "07:00"));
    expect(fake.notifications).toEqual([]);
    connect({ enabled: false });
    test.db.delete(notifications).run();
    await generateNotifications(ctx("2026-06-15", "07:10"));
    expect(fake.notifications).toEqual([]);
    connect({ enabled: true });
    test.db.delete(notifications).run();
    await generateNotifications(ctx("2026-06-15", "07:20"));
    expect(dueCalls()).toHaveLength(1); // Anna only
    void ben;
    expect(
      test.db
        .select()
        .from(notificationDeliveries)
        .all()
        .every((r) => r.userId === anna.id),
    ).toBe(true);
  });

  it("respects push preferences", async () => {
    connect();
    addServices("mobile_app_off", "mobile_app_stage", "mobile_app_ok");
    const [off, wrongStage, ok] = [
      await createTestUser(),
      await createTestUser(),
      await createTestUser(),
    ];
    settings(off.id, {
      pushEnabled: false,
      targets: [
        { channel: "ha_notify", target: "mobile_app_off", enabled: true },
      ],
    });
    settings(wrongStage.id, {
      pushStages: ["overdue"],
      targets: [
        { channel: "ha_notify", target: "mobile_app_stage", enabled: true },
      ],
    });
    settings(ok.id, {
      targets: [
        { channel: "ha_notify", target: "mobile_app_ok", enabled: true },
      ],
    });
    await dueTask();
    await generateNotifications(ctx());
    expect([...new Set(fake.notifications.map((c) => c.service))]).toEqual([
      "mobile_app_ok",
    ]);
  });

  describe("quiet hours", () => {
    it("holds the push back until they are over", async () => {
      connect();
      const anna = await createTestUser();
      settings(anna.id, { quietStart: "22:00", quietEnd: "07:00" });
      await dueTask();
      await generateNotifications(ctx("2026-06-15", "06:00"));
      expect(fake.notifications).toEqual([]);
      expect(
        test.db.select().from(notificationDeliveries).all()[0],
      ).toMatchObject({ status: "deferred" });
      await retryDeliveries(ctx("2026-06-15", "06:45"));
      expect(fake.notifications).toEqual([]);
      await retryDeliveries(ctx("2026-06-15", "07:00"));
      expect(dueCalls()).toHaveLength(1);
      expect((dueCalls()[0].data as Payload).data.actions).toHaveLength(1);
      const rows = test.db.select().from(notificationDeliveries).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status: "sent",
        target: "mobile_app_example_phone",
      });
    });
  });

  it("a hint reaction notification carries no button and links to the asset", async () => {
    connect({ config: { appUrl: "https://app.example.org" } });
    const anna = await createTestUser();
    settings(anna.id);
    const call = createNotifyChannel();
    const outcomes = await call.deliver(
      {
        id: "n-1",
        userId: anna.id,
        kind: "hint",
        taskId: null,
        titleKey: "notification_hint",
        params: { asset: "Garage door", title: "Close it" },
        url: "/assets/a-1",
        createdAt: new Date(),
      },
      { id: anna.id, locale: "en" },
      { actions: [] },
    );
    expect(outcomes).toEqual([
      { status: "sent", target: "mobile_app_example_phone" },
    ]);
    const payload = fake.notifications[0].data as Payload;
    expect(payload).toMatchObject({
      title: "Hint",
      message: "Garage door: Close it",
    });
    expect(payload.data).toMatchObject({
      url: "https://app.example.org/assets/a-1",
      tag: "hw-n-n-1",
    });
    expect(payload.data.actions).toBeUndefined();
    void eq;
  });
});

describe("renderPush", () => {
  const notification = {
    id: "n1",
    userId: "u1",
    kind: "overdue",
    taskId: "t1",
    titleKey: "notification_overdue",
    params: { title: "Filter", date: "2026-06-10", days: 5 },
    url: "/tasks/t1",
    createdAt: new Date(0),
  };

  it("renders every message key in both languages", () => {
    const keys = [
      [
        "prep",
        "notification_prep",
        { title: "T", prep: "P", date: "2026-06-10" },
      ],
      ["due_soon", "notification_due_soon", { title: "T", date: "2026-06-10" }],
      ["due", "notification_due", { title: "T", date: "2026-06-10" }],
      [
        "due_soon",
        "notification_due_soon_notes",
        { title: "T", date: "2026-06-10", notes: 2 },
      ],
      [
        "due",
        "notification_due_notes",
        { title: "T", date: "2026-06-10", notes: 1 },
      ],
      [
        "overdue",
        "notification_overdue",
        { title: "T", date: "2026-06-10", days: 3 },
      ],
      ["digest", "notification_digest", { overdue: 1, due: 2, soon: 3 }],
      ["info", "notification_info", { message: "M" }],
      ["comment", "notification_comment", { author: "A", title: "T" }],
      ["hint", "notification_hint", { asset: "S", title: "T" }],
    ] as const;
    for (const locale of ["de", "en"] as const) {
      for (const [kind, titleKey, params] of keys) {
        const p = renderPush({
          notification: {
            ...notification,
            kind,
            titleKey,
            params,
            taskId: null,
          },
          locale,
          appUrl: null,
          actions: [],
        });
        expect(p.title, `${locale} ${kind}`).not.toMatch(
          /undefined|push_title/,
        );
        expect(p.message, `${locale} ${titleKey}`).not.toMatch(/undefined|\{/);
      }
    }
  });

  it("marks overdue as time-sensitive on iOS and trims the date to the reader's format", () => {
    const p = renderPush({
      notification,
      locale: "en",
      appUrl: null,
      actions: [],
    });
    expect(p.data.push).toEqual({ "interruption-level": "time-sensitive" });
    expect(p.message).toContain("10 Jun 2026");
  });

  it("never turns a path into anything but a path or an app link", () => {
    for (const url of [
      "//evil.example.org/x",
      "https://evil.example.org",
      "javascript:alert(1)",
      null,
    ]) {
      const p = renderPush({
        notification: { ...notification, url },
        locale: "en",
        appUrl: null,
        actions: [],
      });
      expect(p.data.url).toBe("/");
    }
    const p = renderPush({
      notification: { ...notification, url: "//evil.example.org/x" },
      locale: "en",
      appUrl: "https://app.example.org",
      actions: [],
    });
    expect(p.data.url).toBe("https://app.example.org/");
  });
});
