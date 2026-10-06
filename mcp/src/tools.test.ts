import { describe, expect, it } from "vitest";
import { revokeToken } from "../../src/lib/server/auth/tokens";
import { generateNotifications } from "../../src/lib/server/notifications/generate";
import { everyDays, oneOff, useMcp } from "./test-harness";

describe("whoami", () => {
  const mcp = useMcp();

  it("tells who the token acts as, its scopes and today's date", async () => {
    const { call, today } = await mcp.connect({ scopes: ["read"] });
    const r = await call("whoami");
    expect(r.summary).toContain("Anna (admin)");
    expect(r.summary).toContain("Read-only");
    expect(r.json).toMatchObject({
      user: { displayName: "Anna", role: "admin" },
      scopes: ["read"],
      household: { timezone: expect.any(String) },
      today,
    });
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("tasks", () => {
  const mcp = useMcp();

  it("creates a task with an asset, room and assignee given by name", async () => {
    const { ok, day } = await mcp.connect();
    const room = (await ok("list_rooms")).rooms;
    expect(room).toEqual([]);
    await ok("create_asset", { name: "Dishwasher", room: undefined });
    await ok("create_asset", { name: "Fern", kind: "plant" });
    const created = await ok("create_task", {
      title: "Clean the filter",
      category: "filter",
      trigger: everyDays(30, day(5)),
      asset: "dishwasher",
      assignee: "Ben",
      effortMinutes: 10,
    });
    expect(created).toMatchObject({
      title: "Clean the filter",
      category: "filter",
      asset: "Dishwasher",
      assignee: "Ben",
      status: "open",
      due: day(5),
      effortMinutes: 10,
    });
    const detail = await ok("get_task", { id: created.id });
    expect(detail).toMatchObject({
      assignMode: "fixed",
      title: "Clean the filter",
    });
    expect(detail.trigger).toMatchObject({ v: 1, type: "interval", every: 30 });
  });

  it("names the known rooms when a room does not exist", async () => {
    const { call, day } = await mcp.connect();
    const created = await call("create_task", {
      title: "x",
      trigger: oneOff(day(1)),
      room: "Kitchen",
    });
    expect(created.isError).toBe(true);
    expect(created.text).toContain("[not_found]");
    expect(created.text).toContain("Known rooms");
  });

  it("lists upcoming tasks by bucket and filters to mine", async () => {
    const { ok, call, day } = await mcp.connect();
    await ok("create_task", { title: "Late", trigger: oneOff(day(-3)) });
    await ok("create_task", {
      title: "Now",
      trigger: oneOff(day(0)),
      assignee: "me",
    });
    await ok("create_task", {
      title: "Ben's",
      trigger: oneOff(day(0)),
      assignee: "Ben",
    });
    await ok("create_task", { title: "Far", trigger: oneOff(day(30)) });

    const week = await ok("list_upcoming");
    expect(week.asOf).toBe(day(0));
    expect(week.overdue.map((t: { title: string }) => t.title)).toEqual([
      "Late",
    ]);
    expect(week.today.map((t: { title: string }) => t.title).sort()).toEqual([
      "Ben's",
      "Now",
    ]);
    expect(week.later).toBeUndefined();

    const all = await ok("list_upcoming", { horizon: "all" });
    expect(all.later.map((t: { title: string }) => t.title)).toEqual(["Far"]);

    const mine = await ok("list_upcoming", { mine: true });
    expect(mine.today.map((t: { title: string }) => t.title)).toEqual(["Now"]);
    expect(mine.overdue).toEqual([]);

    const todayOnly = await call("list_upcoming", { horizon: "today" });
    expect(todayOnly.json.thisWeek).toBeUndefined();
    expect(todayOnly.summary).toMatch(/3 tasks \(1 overdue, 2 today\)/);
  });

  it("filters list_tasks and pages through results", async () => {
    const { ok, call, day } = await mcp.connect();
    await ok("create_task", {
      title: "Water ferns",
      category: "plant",
      trigger: oneOff(day(-1)),
    });
    await ok("create_task", {
      title: "Clean oven",
      category: "cleaning",
      trigger: oneOff(day(10)),
    });
    await ok("create_task", {
      title: "Empty bins",
      category: "waste",
      trigger: oneOff(day(2)),
      assignee: "Ben",
    });

    const all = await ok("list_tasks");
    expect(all.tasks.map((t: { title: string }) => t.title)).toEqual([
      "Water ferns",
      "Empty bins",
      "Clean oven",
    ]);
    expect(all.tasks[0]).toMatchObject({ status: "overdue", due: day(-1) });

    expect((await ok("list_tasks", { status: "overdue" })).tasks).toHaveLength(
      1,
    );
    expect((await ok("list_tasks", { category: "waste" })).tasks[0].title).toBe(
      "Empty bins",
    );
    expect((await ok("list_tasks", { q: "oven" })).tasks).toHaveLength(1);
    expect((await ok("list_tasks", { assignee: "Ben" })).tasks[0].title).toBe(
      "Empty bins",
    );
    expect((await ok("list_tasks", { assignee: "me" })).tasks).toHaveLength(0);

    const first = await ok("list_tasks", { limit: 2 });
    expect(first.tasks).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = await ok("list_tasks", {
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.tasks).toHaveLength(1);

    const unknownRoom = await call("list_tasks", { room: "Attic" });
    expect(unknownRoom.isError).toBe(true);
    expect(unknownRoom.text).toMatch(/^Error \[not_found\]: No room "Attic"/);
  });

  it("updates, archives and restores a task", async () => {
    const { ok, call, day } = await mcp.connect();
    await ok("create_asset", { name: "Boiler" });
    const t = await ok("create_task", {
      title: "Service",
      trigger: oneOff(day(20)),
      asset: "Boiler",
      assignee: "Ben",
    });
    const changed = await ok("update_task", {
      id: t.id,
      title: "Boiler service",
      priority: "high",
      asset: null,
      assignee: null,
      trigger: everyDays(90, day(40)),
    });
    expect(changed).toMatchObject({
      title: "Boiler service",
      priority: "high",
      due: day(40),
    });
    expect(changed.asset).toBeUndefined();
    expect(changed.assignee).toBeUndefined();

    await ok("update_task", { id: t.id, archived: true });
    expect((await ok("list_tasks")).tasks).toHaveLength(0);
    expect(
      (await ok("list_tasks", { includeArchived: true })).tasks,
    ).toHaveLength(1);
    await ok("update_task", { id: t.id, archived: false });
    expect((await ok("list_tasks")).tasks).toHaveLength(1);

    const empty = await call("update_task", { id: t.id });
    expect(empty).toMatchObject({ isError: true });
    expect(empty.text).toContain("[invalid_request]");
  });
});

describe("completing tasks", () => {
  const mcp = useMcp();

  it("completes a task, attributes it to mcp and shows when it is due next", async () => {
    const { ok, today, day } = await mcp.connect();
    const t = await ok("create_task", {
      title: "Descale kettle",
      trigger: everyDays(30, day(-2)),
    });
    expect(t.status).toBe("overdue");

    const done = await ok("complete_task", { id: t.id, note: "used vinegar" });
    expect(done.completion).toMatchObject({
      kind: "done",
      date: today,
      note: "used vinegar",
      source: "mcp",
      by: "Anna",
    });
    expect(done.task).toMatchObject({ status: "ok", due: day(30) });

    const detail = await ok("get_task", { id: t.id });
    expect(detail.recentCompletions).toHaveLength(1);
    expect(detail.recentCompletions[0].id).toBe(done.completion.id);
    expect((await ok("list_upcoming", { horizon: "all" })).overdue).toEqual([]);
  });

  it("summarises the result in one line", async () => {
    const { ok, call, day } = await mcp.connect();
    const t = await ok("create_task", {
      title: "Bins",
      trigger: everyDays(7, day(0)),
    });
    const r = await call("complete_task", { id: t.id });
    expect(r.summary).toBe(
      `Marked "Bins" done on ${day(0)}. Now: open, due ${day(7)}.`,
    );
  });

  it("backdates a completion and refuses the future", async () => {
    const { ok, call, day } = await mcp.connect();
    const t = await ok("create_task", {
      title: "Mop",
      trigger: everyDays(7, day(-20)),
    });
    const past = await ok("complete_task", {
      id: t.id,
      completedDate: day(-3),
    });
    expect(past.completion.date).toBe(day(-3));
    expect(past.task.due).toBe(day(4));

    const future = await call("complete_task", {
      id: t.id,
      completedDate: day(2),
    });
    expect(future.isError).toBe(true);
    expect(future.text).toMatch(/\[invalid_request\].*in the future/);
  });

  it("sends a fresh idempotency key with each completion", async () => {
    const keys: string[] = [];
    let n = 0;
    const { ok, day } = await mcp.connect({
      newKey: () => `key-number-${++n}`,
      fetch: (inner) => async (input, init) => {
        if (typeof init?.body === "string" && input.endsWith("/complete")) {
          keys.push(JSON.parse(init.body).idempotencyKey);
        }
        return inner(input, init);
      },
    });
    const t = await ok("create_task", {
      title: "Daily",
      trigger: everyDays(1, day(0)),
    });
    await ok("complete_task", { id: t.id });
    await ok("complete_task", { id: t.id });
    expect(keys).toEqual(["key-number-1", "key-number-2"]);
  });

  it("undoes a completion", async () => {
    const { ok, call, day } = await mcp.connect();
    const t = await ok("create_task", {
      title: "Vacuum",
      trigger: everyDays(7, day(-1)),
    });
    const done = await ok("complete_task", { id: t.id });
    expect(done.task.status).toBe("open");

    const undone = await call("undo_completion", {
      completionId: done.completion.id,
    });
    expect(undone.isError).toBe(false);
    expect(undone.json).toEqual({
      completionId: done.completion.id,
      undone: true,
    });
    const after = await ok("get_task", { id: t.id });
    expect(after).toMatchObject({ status: "overdue", due: day(-1) });
    expect(after.recentCompletions).toEqual([]);

    expect(
      (await call("undo_completion", { completionId: done.completion.id }))
        .isError,
    ).toBe(false);
    const missing = await call("undo_completion", { completionId: "nope" });
    expect(missing.text).toMatch(/^Error \[not_found\]/);
  });

  it("skips an occurrence", async () => {
    const { ok, day } = await mcp.connect();
    const t = await ok("create_task", {
      title: "Windows",
      trigger: everyDays(14, day(-1)),
    });
    const r = await ok("skip_task", { id: t.id, note: "on holiday" });
    expect(r.completion).toMatchObject({
      kind: "skipped",
      note: "on holiday",
      source: "mcp",
    });
    expect(r.task.status).toBe("ok");
    const stats = await ok("get_stats");
    expect(stats.total).toMatchObject({ done: 0, skipped: 1 });
  });

  it("snoozes and ends a snooze", async () => {
    const { ok, call, day } = await mcp.connect();
    const t = await ok("create_task", {
      title: "Gutters",
      trigger: oneOff(day(-1)),
    });
    const snoozed = await call("snooze_task", { id: t.id, until: day(5) });
    expect(snoozed.summary).toBe(`Snoozed "Gutters" until ${day(5)}.`);
    expect(snoozed.json).toMatchObject({
      status: "snoozed",
      snoozedUntil: day(5),
    });
    const ended = await ok("snooze_task", { id: t.id, until: null });
    expect(ended.status).toBe("overdue");

    const past = await call("snooze_task", { id: t.id, until: day(-1) });
    expect(past.isError).toBe(true);
    expect(past.text).toContain("[invalid_request]");
  });
});

describe("trigger validation", () => {
  const mcp = useMcp();

  it("accepts a trigger without the version", async () => {
    const { call, day } = await mcp.connect();
    const r = await call("preview_trigger", { trigger: oneOff(day(3)) });
    expect(r.isError).toBe(false);
    expect(r.summary).toContain(`once on ${day(3)}`);
    expect(r.json).toMatchObject({ dueDate: day(3), status: "open" });
  });

  it("names the unknown type and the valid ones", async () => {
    const { call } = await mcp.connect();
    const r = await call("create_task", {
      title: "x",
      trigger: { type: "monthly" },
    });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("[invalid_request]");
    expect(r.text).toContain('trigger.type "monthly" is unknown');
    expect(r.text).toContain("interval, calendar, min_per_period, one_off");
  });

  it("points at the field and shows an example", async () => {
    const { call } = await mcp.connect();
    const r = await call("create_task", {
      title: "x",
      trigger: {
        type: "interval",
        every: 0,
        unit: "month",
        anchor: "completion",
      },
    });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Invalid interval trigger");
    expect(r.text).toContain("trigger.every");
    expect(r.text).toContain("trigger.startDate");
    expect(r.text).toContain('Example: {"type":"interval"');
  });

  it("reports cross-field rules of the engine", async () => {
    const { call, day } = await mcp.connect();
    const r = await call("preview_trigger", {
      trigger: {
        type: "calendar",
        freq: "weekly",
        interval: 1,
        byWeekday: [1],
        nth: 1,
        startDate: day(0),
      },
    });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("nth is not valid for weekly rules");
  });

  it("rejects a trigger without a type before calling the server", async () => {
    const { client } = await mcp.connect();
    const r = (await client.callTool({
      name: "preview_trigger",
      arguments: { trigger: { every: 3 } },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/trigger|type/);
  });

  it("previews every example without creating anything", async () => {
    const { ok } = await mcp.connect();
    await ok("preview_trigger", {
      trigger: { type: "min_per_period", period: "week", count: 2 },
    });
    expect((await ok("list_tasks")).tasks).toEqual([]);
  });
});

describe("assets", () => {
  const mcp = useMcp();

  it("creates, lists, reads and updates assets", async () => {
    const { ok, call, day } = await mcp.connect();
    const created = await ok("create_asset", {
      name: "Washing machine",
      manufacturer: "Examplewerk",
      model: "WM-1",
      purchaseDate: "2025-11-20",
      warrantyUntil: "2027-11-20",
      notes: "Lint filter at the front.",
    });
    expect(created).toMatchObject({
      kind: "device",
      name: "Washing machine",
      model: "WM-1",
    });
    await ok("create_asset", {
      name: "Monstera",
      kind: "plant",
      species: "Monstera deliciosa",
    });

    const devices = await ok("list_assets", { kind: "device" });
    expect(devices.assets.map((a: { name: string }) => a.name)).toEqual([
      "Washing machine",
    ]);
    expect((await ok("list_assets", { q: "monst" })).assets).toHaveLength(1);

    await ok("create_task", {
      title: "Clean lint filter",
      trigger: everyDays(30, day(3)),
      asset: "Washing machine",
    });
    const detail = await ok("get_asset", { asset: "washing" });
    expect(detail).toMatchObject({
      name: "Washing machine",
      notes: "Lint filter at the front.",
      warrantyUntil: "2027-11-20",
    });
    expect(detail.tasks).toHaveLength(1);
    expect(detail.tasks[0]).toMatchObject({
      title: "Clean lint filter",
      due: day(3),
    });
    expect((await ok("get_asset", { asset: created.id })).name).toBe(
      "Washing machine",
    );

    const updated = await ok("update_asset", {
      asset: "Washing machine",
      model: "WM-2",
      notes: null,
      warrantyExtendedUntil: "2028-11-20",
    });
    expect(updated).toMatchObject({
      model: "WM-2",
      warrantyUntil: "2027-11-20",
      warrantyExtendedUntil: "2028-11-20",
    });
    expect(updated.notes).toBeUndefined();

    await ok("update_asset", { asset: created.id, archived: true });
    expect((await ok("list_assets")).assets).toHaveLength(1);
    expect(
      (await ok("list_assets", { includeArchived: true })).assets,
    ).toHaveLength(2);

    const none = await call("get_asset", { asset: "Freezer" });
    expect(none.text).toMatch(
      /^Error \[not_found\]: No asset matches "Freezer"/,
    );
    const empty = await call("update_asset", { asset: "Monstera" });
    expect(empty.text).toContain("[invalid_request]");
  });

  it("puts assets in rooms and filters by room name", async () => {
    const { ok, call, db } = await mcp.connect();
    const { rooms } = await import("../../src/lib/server/db");
    db.db
      .insert(rooms)
      .values({ name: "Bathroom", slug: "bathroom", sortOrder: 0 })
      .run();
    db.db
      .insert(rooms)
      .values({ name: "Kitchen", slug: "kitchen", sortOrder: 1 })
      .run();
    const bath = await ok("create_asset", { name: "Shower", room: "bathroom" });
    expect(bath.room).toBe("Bathroom");
    const task = await ok("create_task", {
      title: "Squeegee",
      trigger: oneOff("2099-01-01"),
      asset: "Shower",
    });
    expect(task.room).toBe("Bathroom");
    await ok("create_asset", { name: "Oven", room: "Kitchen" });

    expect(
      (await ok("list_rooms")).rooms.map((r: { name: string }) => r.name),
    ).toEqual(["Bathroom", "Kitchen"]);
    expect(
      (await ok("list_assets", { room: "KITCHEN" })).assets.map(
        (a: { name: string }) => a.name,
      ),
    ).toEqual(["Oven"]);
    const moved = await ok("update_asset", { asset: "Oven", room: "Bathroom" });
    expect(moved.room).toBe("Bathroom");
    const cleared = await ok("update_asset", { asset: "Oven", room: null });
    expect(cleared.room).toBeUndefined();
    const bad = await call("create_asset", { name: "Lamp", room: "Attic" });
    expect(bad.text).toContain("[not_found]");
  });

  it("asks for the id when a name matches several assets", async () => {
    const { ok, call } = await mcp.connect();
    const desk = await ok("create_asset", { name: "Desk lamp" });
    await ok("create_asset", { name: "Floor lamp" });
    const ambiguous = await call("get_asset", { asset: "lamp" });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toMatch(
      /\[invalid_request\].*ambiguous.*Desk lamp.*Floor lamp/,
    );
    expect((await ok("get_asset", { asset: desk.id })).name).toBe("Desk lamp");
    expect((await ok("get_asset", { asset: "desk lamp" })).id).toBe(desk.id);
    const task = await call("create_task", {
      title: "t",
      trigger: oneOff("2099-01-01"),
      asset: "lamp",
    });
    expect(task.text).toContain("ambiguous");
  });
});

describe("statistics and notifications", () => {
  const mcp = useMcp();

  it("reports completions per person and category with names", async () => {
    const { ok, day } = await mcp.connect();
    const a = await ok("create_task", {
      title: "A",
      category: "cleaning",
      trigger: everyDays(7, day(0)),
    });
    await ok("complete_task", { id: a.id });
    await ok("complete_task", { id: a.id, completedDate: day(-1) });
    const stats = await ok("get_stats");
    expect(stats.total).toMatchObject({ done: 2 });
    expect(stats.byUser.Anna).toMatchObject({ done: 2 });
    expect(stats.byCategory.cleaning).toMatchObject({ done: 2 });
    const bad = await ok("get_stats", { from: day(-10), to: day(0) });
    expect(bad.from).toBe(day(-10));
  });

  it("lists notifications as readable text", async () => {
    const { ok, call, db, day } = await mcp.connect();
    const empty = await call("list_notifications");
    expect(empty.summary).toBe("0 unread notifications.");

    await ok("create_task", {
      title: "Pay rent",
      trigger: oneOff(day(-2)),
      assignee: "me",
    });
    await generateNotifications({ db: db.db, now: Date.now() });
    const r = await ok("list_notifications");
    const texts = r.notifications.map((n: { text: string }) => n.text);
    expect(texts).toContain(
      `"Pay rent" has been overdue for 2 days (was due ${day(-2)})`,
    );
    expect(r.notifications[0]).toMatchObject({
      kind: expect.any(String),
      read: false,
    });
  });
});

describe("errors", () => {
  const mcp = useMcp();

  it("maps API errors to tool errors with the error code", async () => {
    const { call } = await mcp.connect();
    const r = await call("get_task", { id: "does-not-exist" });
    expect(r).toMatchObject({ isError: true });
    expect(r.text).toMatch(/^Error \[not_found\]: /);
    expect(r.json).toEqual({});
  });

  it("reports a token that was revoked while the server runs", async () => {
    const { call, tokenId, anna } = await mcp.connect();
    revokeToken(anna.id, tokenId);
    const r = await call("list_tasks");
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/^Error \[unauthenticated\]/);
  });

  it("reports an unreachable server", async () => {
    let down = false;
    const { call } = await mcp.connect({
      fetch: (inner) => async (input, init) => {
        if (down) throw new TypeError("connection refused");
        return inner(input, init);
      },
    });
    down = true;
    const r = await call("list_tasks");
    expect(r.isError).toBe(true);
    expect(r.text).toBe(
      "Error [unreachable]: Could not reach the hauswart server: connection refused",
    );
  });

  it("surfaces API validation details", async () => {
    const { call } = await mcp.connect();
    const r = await call("create_task", {
      title: "x",
      trigger: oneOff("2026-02-30"),
    });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("[invalid_request]");
  });

  it("rejects input that does not fit the schema", async () => {
    const { client } = await mcp.connect();
    const r = (await client.callTool({
      name: "complete_task",
      arguments: { id: "x", completedDate: "yesterday" },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/completedDate/);
  });
});
