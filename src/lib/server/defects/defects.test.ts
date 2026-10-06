import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  DEFECT_TRANSITIONS,
  createDefectRequestSchema,
} from "$lib/api/schemas/defects";
import { createAsset } from "$lib/server/assets/assets";
import { createContact, deleteContact } from "$lib/server/contacts/contacts";
import { createContactRequestSchema } from "$lib/api/schemas/contacts";
import { createComment, deleteComment } from "$lib/server/comments/comments";
import { tasks, defectEvents } from "$lib/server/db";
import { updateHousehold } from "$lib/server/household/household";
import { createRoom, deleteRoom } from "$lib/server/rooms/rooms";
import { listPreparations } from "$lib/server/tasks/preparations";
import { getTask } from "$lib/server/tasks/tasks";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt } from "$lib/testing/domain";
import {
  addEvent,
  changeStatus,
  createDefect,
  deleteDefect,
  eventsOf,
  getDefect,
  getDefectDetail,
  getTimeline,
  handoverDeadline,
  listDefects,
  recomputeHandoverDeadlines,
  updateDefect,
} from "./defects";

describe("defects", () => {
  const test = useTestDB();
  const ctx = (now?: number) => ctxAt(test.db, now);
  const page = { limit: 50 };
  const make = (
    over: Record<string, unknown> = {},
    now?: number,
    user: string | null = null,
  ) =>
    createDefect(
      ctx(now),
      createDefectRequestSchema.parse({ title: "Riss in der Wand", ...over }),
      user,
    );
  const reminder = (defectId: string) =>
    test.db.select().from(tasks).where(eq(tasks.externalRef, defectId)).get();

  describe("creating", () => {
    it("starts open with the next number, today's discovery date and a created event", async () => {
      const user = await createTestUser({ displayName: "Anna" });
      const first = await make({}, undefined, user.id);
      const second = await make({ title: "Zweiter" });
      expect(first).toMatchObject({
        number: 1,
        title: "Riss in der Wand",
        status: "open",
        severity: "medium",
        discoveredOn: "2026-06-15",
        reportedOn: null,
        fixedOn: null,
        deadlineDate: null,
        deadlineSource: "manual",
        descriptionMd: "",
        resolutionMd: "",
        reminderTaskId: null,
        commentCount: 0,
        createdBy: user.id,
      });
      expect(second.number).toBe(2);
      const [event] = eventsOf(ctx(), first.id);
      expect(event).toMatchObject({
        type: "created",
        toStatus: "open",
        fromStatus: null,
        userId: user.id,
        userName: "Anna",
      });
    });

    it("keeps numbers unique after a defect is deleted", async () => {
      const a = await make();
      await make();
      deleteDefect(ctx(), a.id);
      expect((await make()).number).toBe(3);
    });

    it("names room, asset and responsible contact", async () => {
      const room = createRoom(ctx(), { name: "Bad" });
      const asset = createAsset(ctx(), {
        kind: "fixture",
        name: "Lavabo",
        showOnEmergency: false,
      });
      const contact = createContact(
        ctx(),
        createContactRequestSchema.parse({ name: "Verwaltung AG" }),
      );
      const d = await make({
        roomId: room.id,
        assetId: asset.id,
        responsibleContactId: contact.id,
        locationDetail: "links oben",
      });
      expect(d).toMatchObject({
        roomName: "Bad",
        assetName: "Lavabo",
        responsibleContactName: "Verwaltung AG",
        locationDetail: "links oben",
      });
    });

    it("rejects unknown room, asset and contact", async () => {
      await expect(make({ roomId: "nope" })).rejects.toThrow(/Invalid request/);
      await expect(make({ assetId: "nope" })).rejects.toThrow(
        /Invalid request/,
      );
      await expect(make({ responsibleContactId: "nope" })).rejects.toThrow(
        /Invalid request/,
      );
    });

    it("loses room and contact links when those are deleted", async () => {
      const room = createRoom(ctx(), { name: "Bad" });
      const contact = createContact(
        ctx(),
        createContactRequestSchema.parse({ name: "Verwaltung AG" }),
      );
      const d = await make({
        roomId: room.id,
        responsibleContactId: contact.id,
      });
      deleteRoom(ctx(), room.id);
      deleteContact(ctx(), contact.id);
      expect(getDefect(ctx(), d.id)).toMatchObject({
        roomId: null,
        roomName: null,
        responsibleContactId: null,
      });
    });
  });

  describe("deadline", () => {
    it("is empty without a handover date", async () => {
      expect(handoverDeadline(ctx())).toBeNull();
      expect(await make()).toMatchObject({
        deadlineDate: null,
        deadlineSource: "manual",
      });
    });

    it("defaults to the handover date plus the deadline months", async () => {
      updateHousehold(ctx(), { handoverDate: "2026-04-03" });
      expect(await make()).toMatchObject({
        deadlineDate: "2028-04-03",
        deadlineSource: "handover",
      });
      updateHousehold(ctx(), { settings: { defectDeadlineMonths: 12 } });
      expect(await make()).toMatchObject({
        deadlineDate: "2027-04-03",
        deadlineSource: "handover",
      });
    });

    it("clamps the day at the end of a short month", async () => {
      updateHousehold(ctx(), {
        handoverDate: "2026-02-28",
        settings: { defectDeadlineMonths: 24 },
      });
      expect((await make()).deadlineDate).toBe("2028-02-28");
      updateHousehold(ctx(), {
        handoverDate: "2025-08-31",
        settings: { defectDeadlineMonths: 6 },
      });
      expect((await make()).deadlineDate).toBe("2026-02-28");
    });

    it("a given date is manual, an explicit null means no deadline", async () => {
      updateHousehold(ctx(), { handoverDate: "2026-04-03" });
      expect(await make({ deadlineDate: "2026-12-31" })).toMatchObject({
        deadlineDate: "2026-12-31",
        deadlineSource: "manual",
      });
      expect(await make({ deadlineDate: null })).toMatchObject({
        deadlineDate: null,
        deadlineSource: "manual",
      });
    });

    it("can be overridden and reset to the handover date", async () => {
      updateHousehold(ctx(), { handoverDate: "2026-04-03" });
      const d = await make();
      expect(
        await updateDefect(ctx(), d.id, { deadlineDate: "2027-01-01" }),
      ).toMatchObject({ deadlineDate: "2027-01-01", deadlineSource: "manual" });
      expect(
        await updateDefect(ctx(), d.id, { deadlineDate: null }),
      ).toMatchObject({ deadlineDate: null, deadlineSource: "manual" });
      expect(
        await updateDefect(ctx(), d.id, { deadlineSource: "handover" }),
      ).toMatchObject({
        deadlineDate: "2028-04-03",
        deadlineSource: "handover",
      });
    });

    it("cannot be reset without a handover date", async () => {
      const d = await make();
      await expect(
        updateDefect(ctx(), d.id, { deadlineSource: "handover" }),
      ).rejects.toThrow(/Invalid request/);
    });

    it("follows the household when the handover date or the months change", async () => {
      updateHousehold(ctx(), { handoverDate: "2026-04-03" });
      const derived = await make();
      const manual = await make({ deadlineDate: "2027-01-01" });
      updateHousehold(ctx(), { handoverDate: "2026-05-01" });
      expect(await recomputeHandoverDeadlines(ctx())).toBe(1);
      expect(getDefect(ctx(), derived.id).deadlineDate).toBe("2028-05-01");
      expect(getDefect(ctx(), manual.id).deadlineDate).toBe("2027-01-01");
      expect(await recomputeHandoverDeadlines(ctx())).toBe(0);
      updateHousehold(ctx(), { handoverDate: null });
      await recomputeHandoverDeadlines(ctx());
      expect(getDefect(ctx(), derived.id).deadlineDate).toBeNull();
      expect(reminder(derived.id)?.archivedAt).not.toBeNull();
    });
  });

  describe("updating", () => {
    it("changes fields and clears optional ones", async () => {
      const d = await make({ locationDetail: "alt", severity: "low" });
      const u = await updateDefect(ctx(), d.id, {
        title: "Neu",
        locationDetail: null,
        severity: "high",
        reportedOn: "2026-06-10",
        resolutionMd: "Gespachtelt",
      });
      expect(u).toMatchObject({
        title: "Neu",
        locationDetail: null,
        severity: "high",
        reportedOn: "2026-06-10",
        resolutionMd: "Gespachtelt",
      });
    });

    it("answers 404 for unknown defects and rejects unknown references", async () => {
      await expect(updateDefect(ctx(), "nope", { title: "x" })).rejects.toThrow(
        /not found/i,
      );
      expect(() => getDefect(ctx(), "nope")).toThrow(/not found/i);
      expect(() => deleteDefect(ctx(), "nope")).toThrow(/not found/i);
      const d = await make();
      await expect(
        updateDefect(ctx(), d.id, { roomId: "nope" }),
      ).rejects.toThrow(/Invalid request/);
    });
  });

  describe("listing", () => {
    it("puts active defects first by deadline, then closed ones", async () => {
      const none = await make({ title: "ohne Frist" });
      const late = await make({ title: "spät", deadlineDate: "2027-01-01" });
      const soon = await make({ title: "bald", deadlineDate: "2026-09-01" });
      const fixed = await make({
        title: "behoben",
        deadlineDate: "2026-07-01",
      });
      await changeStatus(ctx(), fixed.id, { status: "fixed" }, null);
      const titles = (f = {}) =>
        listDefects(ctx(), f, page).items.map((d) => d.title);
      expect(titles()).toEqual(["bald", "spät", "ohne Frist", "behoben"]);
      expect(titles({ active: true })).toEqual(["bald", "spät", "ohne Frist"]);
      expect(titles({ status: "fixed" })).toEqual(["behoben"]);
      expect([none, late, soon].length).toBe(3);
    });

    it("filters by severity, room, asset and search text", async () => {
      const room = createRoom(ctx(), { name: "Bad" });
      const asset = createAsset(ctx(), {
        kind: "fixture",
        name: "Lavabo",
        showOnEmergency: false,
      });
      await make({ title: "A", severity: "high", roomId: room.id });
      await make({ title: "B", assetId: asset.id, descriptionMd: "tropft" });
      await make({ title: "C", locationDetail: "Decke" });
      const titles = (f = {}) =>
        listDefects(ctx(), f, page).items.map((d) => d.title);
      expect(titles({ severity: "high" })).toEqual(["A"]);
      expect(titles({ roomId: room.id })).toEqual(["A"]);
      expect(titles({ assetId: asset.id })).toEqual(["B"]);
      expect(titles({ q: "TROPFT" })).toEqual(["B"]);
      expect(titles({ q: "decke" })).toEqual(["C"]);
    });

    it("pages", async () => {
      for (const t of ["A", "B", "C"]) await make({ title: t });
      const first = listDefects(ctx(), {}, { limit: 2 });
      const second = listDefects(
        ctx(),
        {},
        { limit: 2, cursor: first.nextCursor! },
      );
      expect([
        first.items.length,
        second.items.length,
        second.nextCursor,
      ]).toEqual([2, 1, null]);
    });
  });

  describe("status", () => {
    const allStatuses = [
      "open",
      "reported",
      "in_progress",
      "fixed",
      "rejected",
    ] as const;

    it.each(
      allStatuses.flatMap((from) =>
        allStatuses.map(
          (to) => [from, to, DEFECT_TRANSITIONS[from].includes(to)] as const,
        ),
      ),
    )("%s -> %s is allowed: %s", async (from, to, allowed) => {
      const d = await make();
      // Walk to the starting status along allowed steps.
      if (from === "fixed" || from === "rejected")
        await changeStatus(ctx(), d.id, { status: from }, null);
      else if (from !== "open")
        await changeStatus(ctx(), d.id, { status: from }, null);
      const attempt = changeStatus(ctx(), d.id, { status: to }, null);
      if (allowed && from !== to)
        await expect(attempt).resolves.toMatchObject({ status: to });
      else await expect(attempt).rejects.toThrow(/status|reopen/);
    });

    it("writes an event for every change with who, from, to and the note", async () => {
      const user = await createTestUser({ displayName: "Anna" });
      const d = await make();
      await changeStatus(
        ctx(at("2026-06-16")),
        d.id,
        { status: "reported", note: "per Einschreiben" },
        user.id,
      );
      await changeStatus(
        ctx(at("2026-06-17")),
        d.id,
        { status: "in_progress" },
        user.id,
      );
      const detail = await changeStatus(
        ctx(at("2026-06-18")),
        d.id,
        { status: "fixed", note: "Maler war da" },
        user.id,
      );
      expect(
        detail.events.map((e) => [e.type, e.fromStatus, e.toStatus, e.bodyMd]),
      ).toEqual([
        ["created", null, "open", ""],
        ["status", "open", "reported", "per Einschreiben"],
        ["status", "reported", "in_progress", ""],
        ["status", "in_progress", "fixed", "Maler war da"],
      ]);
      expect(detail.events[3]).toMatchObject({
        userId: user.id,
        userName: "Anna",
        at: new Date(at("2026-06-18")),
      });
    });

    it("sets the reported and fixed dates, defaulting to today", async () => {
      const d = await make();
      const reported = await changeStatus(
        ctx(at("2026-06-16")),
        d.id,
        { status: "reported" },
        null,
      );
      expect(reported).toMatchObject({
        reportedOn: "2026-06-16",
        fixedOn: null,
      });
      const fixed = await changeStatus(
        ctx(at("2026-06-20")),
        d.id,
        { status: "fixed" },
        null,
      );
      expect(fixed).toMatchObject({
        reportedOn: "2026-06-16",
        fixedOn: "2026-06-20",
      });
      const reopened = await changeStatus(
        ctx(),
        d.id,
        { status: "open" },
        null,
      );
      expect(reopened).toMatchObject({
        fixedOn: null,
        reportedOn: "2026-06-16",
      });
    });

    it("takes explicit dates and keeps an earlier report date", async () => {
      const d = await make();
      const r = await changeStatus(
        ctx(),
        d.id,
        { status: "reported", reportedOn: "2026-06-01" },
        null,
      );
      expect(r.reportedOn).toBe("2026-06-01");
      await changeStatus(ctx(), d.id, { status: "in_progress" }, null);
      await changeStatus(ctx(), d.id, { status: "reported" }, null);
      expect(getDefect(ctx(), d.id).reportedOn).toBe("2026-06-01");
      const f = await changeStatus(
        ctx(),
        d.id,
        { status: "fixed", fixedOn: "2026-06-12" },
        null,
      );
      expect(f.fixedOn).toBe("2026-06-12");
    });

    it("rejected defects have no fixed date", async () => {
      const d = await make();
      expect(
        (await changeStatus(ctx(), d.id, { status: "rejected" }, null)).fixedOn,
      ).toBeNull();
    });

    it("answers 404 for an unknown defect", async () => {
      await expect(
        changeStatus(ctx(), "nope", { status: "fixed" }, null),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe("correspondence and timeline", () => {
    it("adds correspondence events with an optional reference", async () => {
      const user = await createTestUser({ displayName: "Anna" });
      const d = await make();
      const e = addEvent(
        ctx(),
        d.id,
        {
          type: "correspondence",
          bodyMd: "Mängelrüge verschickt",
          externalRef: "doc-1",
        },
        user.id,
      );
      expect(e).toMatchObject({
        type: "correspondence",
        bodyMd: "Mängelrüge verschickt",
        externalRef: "doc-1",
        userName: "Anna",
        fromStatus: null,
      });
      expect(() =>
        addEvent(ctx(), "nope", { type: "correspondence", bodyMd: "x" }, null),
      ).toThrow(/not found/i);
    });

    it("merges events and comments oldest first, deleted comments emptied", async () => {
      const user = await createTestUser({ displayName: "Anna" });
      const viewer = { id: user.id, role: "member" as const };
      const d = await make({}, at("2026-06-15", "08:00"), user.id);
      await createComment(ctx(at("2026-06-15", "09:00")), viewer, {
        entityType: "defect",
        entityId: d.id,
        bodyMd: "Foto folgt",
      });
      addEvent(
        ctx(at("2026-06-15", "10:00")),
        d.id,
        { type: "correspondence", bodyMd: "Brief" },
        user.id,
      );
      const gone = await createComment(ctx(at("2026-06-15", "11:00")), viewer, {
        entityType: "defect",
        entityId: d.id,
        bodyMd: "Schreibfehler",
      });
      deleteComment(ctx(), viewer, gone.id);
      await changeStatus(
        ctx(at("2026-06-15", "12:00")),
        d.id,
        { status: "reported" },
        user.id,
      );
      const items = getTimeline(ctx(), viewer, d.id);
      expect(
        items.map((i) => [
          i.kind,
          i.kind === "event" ? i.type : i.deleted ? "deleted" : i.bodyMd,
        ]),
      ).toEqual([
        ["event", "created"],
        ["comment", "Foto folgt"],
        ["event", "correspondence"],
        ["comment", "deleted"],
        ["event", "status"],
      ]);
      const deleted = items[3];
      expect(deleted.kind === "comment" && deleted.bodyMd).toBe("");
      expect(() => getTimeline(ctx(), viewer, "nope")).toThrow(/not found/i);
    });

    it("lists an event before a comment written at the same instant", async () => {
      const user = await createTestUser();
      const viewer = { id: user.id, role: "member" as const };
      const d = await make();
      await createComment(ctx(), viewer, {
        entityType: "defect",
        entityId: d.id,
        bodyMd: "x",
      });
      expect(getTimeline(ctx(), viewer, d.id).map((i) => i.kind)).toEqual([
        "event",
        "comment",
      ]);
    });
  });

  describe("deleting", () => {
    it("removes events, comments and the reminder task", async () => {
      const user = await createTestUser();
      const d = await make({ deadlineDate: "2026-12-31" });
      addEvent(ctx(), d.id, { type: "correspondence", bodyMd: "x" }, null);
      await createComment(
        ctx(),
        { id: user.id, role: "member" },
        { entityType: "defect", entityId: d.id, bodyMd: "x" },
      );
      expect(reminder(d.id)).toBeDefined();
      deleteDefect(ctx(), d.id);
      expect(reminder(d.id)).toBeUndefined();
      expect(test.db.select().from(defectEvents).all()).toEqual([]);
    });
  });

  describe("reminder task", () => {
    it("is a one-off task on the deadline with a preparation 30 days ahead", async () => {
      const room = createRoom(ctx(), { name: "Bad" });
      const asset = createAsset(ctx(), {
        kind: "fixture",
        name: "Lavabo",
        showOnEmergency: false,
      });
      const d = await make({
        deadlineDate: "2026-12-31",
        severity: "high",
        roomId: room.id,
        assetId: asset.id,
      });
      const task = getTask(ctx(), d.reminderTaskId!);
      expect(task).toMatchObject({
        title: "Mangelfrist 1: Riss in der Wand",
        category: "defect",
        source: "system",
        externalSource: "defect",
        externalRef: d.id,
        externalUrl: `/defects/${d.id}`,
        priority: "high",
        assetId: asset.id,
        roomId: room.id,
        archivedAt: null,
        trigger: { v: 1, type: "one_off", date: "2026-12-31" },
      });
      const preps = await listPreparations(ctx(), task.id);
      expect(preps).toHaveLength(1);
      expect(preps[0]).toMatchObject({
        title: "Mangel melden",
        kind: "generic",
        leadDays: 30,
        state: "not_yet",
      });
      expect(task.state).toMatchObject({ status: "ok", dueDate: "2026-12-31" });
    });

    it("is not created without a deadline", async () => {
      const d = await make();
      expect(d.reminderTaskId).toBeNull();
      expect(test.db.select().from(tasks).all()).toEqual([]);
    });

    it("follows the deadline, the title and the severity", async () => {
      const d = await make({ deadlineDate: "2026-12-31" });
      const updated = await updateDefect(ctx(), d.id, {
        deadlineDate: "2027-02-01",
        title: "Neuer Titel",
        severity: "low",
      });
      expect(updated.reminderTaskId).toBe(d.reminderTaskId);
      expect(getTask(ctx(), d.reminderTaskId!)).toMatchObject({
        title: "Mangelfrist 1: Neuer Titel",
        priority: "low",
        trigger: { type: "one_off", date: "2027-02-01" },
      });
      expect(test.db.select().from(tasks).all()).toHaveLength(1);
    });

    it("is archived when the deadline is removed and comes back with a new one", async () => {
      const d = await make({ deadlineDate: "2026-12-31" });
      expect(
        (await updateDefect(ctx(), d.id, { deadlineDate: null }))
          .reminderTaskId,
      ).toBeNull();
      expect(getTask(ctx(), d.reminderTaskId!).archivedAt).not.toBeNull();
      const back = await updateDefect(ctx(), d.id, {
        deadlineDate: "2027-03-01",
      });
      expect(back.reminderTaskId).toBe(d.reminderTaskId);
      expect(getTask(ctx(), d.reminderTaskId!)).toMatchObject({
        archivedAt: null,
        trigger: { date: "2027-03-01" },
      });
      expect(test.db.select().from(tasks).all()).toHaveLength(1);
    });

    it.each(["fixed", "rejected"] as const)(
      "is archived when the defect is %s and restored when it is reopened",
      async (status) => {
        const d = await make({ deadlineDate: "2026-12-31" });
        const closed = await changeStatus(ctx(), d.id, { status }, null);
        expect(closed.reminderTaskId).toBeNull();
        expect(getTask(ctx(), d.reminderTaskId!).archivedAt).not.toBeNull();
        const reopened = await changeStatus(
          ctx(),
          d.id,
          { status: "open" },
          null,
        );
        expect(reopened.reminderTaskId).toBe(d.reminderTaskId);
        expect(getTask(ctx(), d.reminderTaskId!).archivedAt).toBeNull();
        expect(test.db.select().from(tasks).all()).toHaveLength(1);
      },
    );

    it("stays while the defect is reported or in progress", async () => {
      const d = await make({ deadlineDate: "2026-12-31" });
      expect(
        (await changeStatus(ctx(), d.id, { status: "reported" }, null))
          .reminderTaskId,
      ).toBe(d.reminderTaskId);
      expect(
        (await changeStatus(ctx(), d.id, { status: "in_progress" }, null))
          .reminderTaskId,
      ).toBe(d.reminderTaskId);
    });

    it("is one task per defect", async () => {
      const a = await make({ deadlineDate: "2026-12-31" });
      const b = await make({ deadlineDate: "2026-12-31", title: "Zweiter" });
      expect(a.reminderTaskId).not.toBe(b.reminderTaskId);
      expect(test.db.select().from(tasks).all()).toHaveLength(2);
    });

    it("takes the handover-based deadline", async () => {
      updateHousehold(ctx(), { handoverDate: "2026-04-03" });
      const d = await make();
      expect(getTask(ctx(), d.reminderTaskId!).trigger).toMatchObject({
        date: "2028-04-03",
      });
    });
  });

  it("detail has the events", async () => {
    const d = await make();
    expect(getDefectDetail(ctx(), d.id).events).toHaveLength(1);
  });
});
