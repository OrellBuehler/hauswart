import { afterEach, describe, expect, it, vi } from "vitest";
import { INTEGRATION_LEVELS } from "$lib/api/enums";
import { calendarTargetConfigSchema } from "$lib/api/schemas/calendar-sync";
import { createAppointment } from "$lib/server/appointments/appointments";
import { saveConnection } from "$lib/server/connections/connections";
import { calendarLinks, calendarTargets, connections } from "$lib/server/db";
import { onEvent } from "$lib/server/events";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, NOW } from "$lib/testing/domain";
import { listLinks } from "./links";
import { syncTarget } from "./sync";
import {
  ADMIN,
  addTarget,
  CALENDAR_ID,
  connectCalendarSystem,
  FULL_CAPABILITIES,
  PROVIDER,
  useFakeCalendars,
} from "./testing";
import {
  createTarget,
  deleteTarget,
  listTargets,
  syncNow,
  updateTarget,
  type Caller,
} from "./targets";

const config = (over: Record<string, unknown> = {}) =>
  calendarTargetConfigSchema.parse({ kinds: ["appointments"], ...over });
const MEMBER: Caller = { id: "member-user", admin: false, locale: "en" };

describe("calendar targets", () => {
  const test = useTestDB();
  const fake = useFakeCalendars();
  const ctx = (now = NOW) => ctxAt(test.db, now);
  afterEach(() => vi.restoreAllMocks());

  const create = (
    over: Partial<Parameters<typeof createTarget>[2]> = {},
    caller = ADMIN,
  ) =>
    createTarget(ctx(), caller, {
      provider: PROVIDER,
      remoteCalendarId: CALENDAR_ID,
      enabled: true,
      config: config(),
      ...over,
    });
  const book = (title = "Kaminfeger") =>
    createAppointment(
      ctx(),
      {
        title,
        startsAt: at("2026-06-20", "09:00"),
        endsAt: at("2026-06-20", "10:30"),
      },
      null,
    );
  const codeOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (err) {
      return (err as { code?: string }).code;
    }
    return "none";
  };

  describe("adding one", () => {
    it("stores the calendar, its name, what it allows and the settings, and asks for a first sync", async () => {
      connectCalendarSystem(ctx());
      fake.add(CALENDAR_ID, { name: "Haushalt" });
      const seen: string[] = [];
      const off = onEvent("calendarTargetChanged", ({ targetId }) =>
        seen.push(targetId),
      );
      const target = await create({
        config: config({
          titlePrefix: "[H] ",
          kinds: ["appointments", "task_due"],
        }),
      });
      off();
      expect(target).toMatchObject({
        provider: PROVIDER,
        level: "household",
        ownerId: null,
        remoteCalendarId: CALENDAR_ID,
        remoteName: "Haushalt",
        name: "Haushalt",
        enabled: true,
        capabilities: FULL_CAPABILITIES,
        status: "unknown",
        lastError: null,
        eventCount: 0,
        canManage: true,
        config: {
          kinds: ["appointments", "task_due"],
          direction: "push",
          scope: "all",
          timedMode: "all_day",
          titlePrefix: "[H] ",
          onRemoteDelete: "recreate",
          conflictPolicy: "hauswart_wins",
        },
      });
      expect(seen).toEqual([target.id]);
    });

    it("takes a name of its own, and still remembers the calendar's", async () => {
      connectCalendarSystem(ctx());
      fake.add(CALENDAR_ID, { name: "Haushalt" });
      expect(await create({ name: "Familie" })).toMatchObject({
        name: "Familie",
        remoteName: "Haushalt",
      });
    });

    it("is for administrators when the connection is the household's", async () => {
      connectCalendarSystem(ctx());
      fake.add(CALENDAR_ID);
      expect(await codeOf(create({}, MEMBER))).toBe("forbidden");
      expect(listTargets(ctx(), ADMIN)).toEqual([]);
    });

    it("needs a connection that is on, an adapter that runs and a calendar that exists and takes events", async () => {
      fake.add(CALENDAR_ID);
      expect(await codeOf(create())).toBe("not_found");
      connectCalendarSystem(ctx(), false);
      expect(await codeOf(create())).toBe("not_found");
      connectCalendarSystem(ctx());
      fake.calendars.delete(CALENDAR_ID);
      await expect(create()).rejects.toMatchObject({
        code: "invalid_request",
        details: {
          code: "calendar_not_found",
          body: {
            fieldErrors: { remoteCalendarId: ["This calendar was not found."] },
          },
        },
      });
      fake.add(CALENDAR_ID, {
        capabilities: { ...FULL_CAPABILITIES, create: false },
      });
      await expect(create()).rejects.toMatchObject({
        code: "invalid_request",
        details: {
          code: "calendar_unsupported",
          body: {
            fieldErrors: {
              remoteCalendarId: ["This calendar does not allow adding events."],
            },
          },
        },
      });
      fake.detach();
      fake.add("calendar.other");
      expect(await codeOf(create({ remoteCalendarId: "calendar.other" }))).toBe(
        "not_found",
      );
      expect(listTargets(ctx(), ADMIN)).toEqual([]);
    });

    it("shows a failure of the calendar system as an upstream error with its code", async () => {
      connectCalendarSystem(ctx());
      fake.add(CALENDAR_ID);
      fake.failNext("open", "unauthorized");
      await expect(create()).rejects.toMatchObject({
        code: "upstream_error",
        details: { code: "unauthorized" },
      });
    });

    it("is refused for a calendar that already has a target", async () => {
      connectCalendarSystem(ctx());
      fake.add(CALENDAR_ID);
      await create();
      expect(await codeOf(create())).toBe("conflict");
    });

    it("cannot be for the person alone: a household has no owner whose tasks `mine` could mean", async () => {
      connectCalendarSystem(ctx());
      fake.add(CALENDAR_ID);
      await expect(
        create({ config: config({ scope: "mine" }) }),
      ).rejects.toMatchObject({
        code: "invalid_request",
        details: { body: { fieldErrors: { config: [expect.any(String)] } } },
      });
    });
  });

  describe("targets of one person", () => {
    // The only calendar system there is connects for the household; the level of a kind decides, so these
    // tests change it the way a system that every person connects would be.
    const asPersonal = () => {
      const original = INTEGRATION_LEVELS[PROVIDER];
      INTEGRATION_LEVELS[PROVIDER] = "user";
      return () => {
        INTEGRATION_LEVELS[PROVIDER] = original;
      };
    };

    it("belong to the person whose connection they use, who alone sees and manages them", async () => {
      const restore = asPersonal();
      try {
        const [anna, ben] = [await createTestUser(), await createTestUser()];
        const annaCaller: Caller = { id: anna.id, admin: false, locale: "de" };
        const benCaller: Caller = { id: ben.id, admin: false, locale: "de" };
        for (const user of [anna, ben]) {
          saveConnection(ctx(), PROVIDER, user.id, {
            baseUrl: "https://calendars.example.org",
            token: "test-token",
            allowInsecureTls: false,
          });
        }
        fake.add("calendar.anna");
        fake.add("calendar.ben");
        const own = await create(
          { remoteCalendarId: "calendar.anna" },
          annaCaller,
        );
        await create({ remoteCalendarId: "calendar.ben" }, benCaller);
        expect(own).toMatchObject({
          level: "user",
          ownerId: anna.id,
          canManage: true,
        });
        expect(listTargets(ctx(), annaCaller).map((t) => t.id)).toEqual([
          own.id,
        ]);
        // Another person's target is a 404, exactly like a missing one.
        const attempts: Array<() => unknown> = [
          () => updateTarget(ctx(), benCaller, own.id, { name: "x" }),
          () => deleteTarget(ctx(), benCaller, own.id),
          () => syncNow(ctx(), benCaller, own.id),
        ];
        for (const attempt of attempts) {
          expect(await codeOf(Promise.resolve().then(attempt))).toBe(
            "not_found",
          );
        }
        // Not even an administrator manages another person's.
        expect(
          await codeOf(
            Promise.resolve().then(() =>
              updateTarget(ctx(), { ...ADMIN, id: "admin" }, own.id, {
                name: "x",
              }),
            ),
          ),
        ).toBe("not_found");
        // The person's tasks are what `mine` means for them.
        fake.add("calendar.anna_tasks");
        expect(
          (
            await create(
              {
                remoteCalendarId: "calendar.anna_tasks",
                config: config({ scope: "mine" }),
              },
              annaCaller,
            )
          ).config.scope,
        ).toBe("mine");
      } finally {
        restore();
      }
    });

    it("need the person's own connection", async () => {
      const restore = asPersonal();
      try {
        const anna = await createTestUser();
        const ben = await createTestUser();
        saveConnection(ctx(), PROVIDER, ben.id, {
          baseUrl: "https://calendars.example.org",
          token: "test-token",
          allowInsecureTls: false,
        });
        fake.add(CALENDAR_ID);
        expect(
          await codeOf(create({}, { id: anna.id, admin: true, locale: "de" })),
        ).toBe("not_found");
      } finally {
        restore();
      }
    });
  });

  describe("listing", () => {
    it("shows the household's targets to everybody, as something a member cannot change", async () => {
      connectCalendarSystem(ctx());
      const target = await addTarget(ctx(), fake);
      book();
      await syncTarget(ctx(), target.id);
      const asMember = listTargets(ctx(), MEMBER);
      expect(asMember).toHaveLength(1);
      expect(asMember[0]).toMatchObject({
        id: target.id,
        canManage: false,
        eventCount: 1,
        status: "ok",
        lastStats: expect.objectContaining({ created: 1 }),
      });
      expect(listTargets(ctx(), ADMIN)[0]!.canManage).toBe(true);
    });

    it("follows the name the calendar has in its system, and leaves the target's own", async () => {
      connectCalendarSystem(ctx());
      fake.add(CALENDAR_ID, { name: "Haushalt" });
      const target = await create({ name: "Familie" });
      fake.get(CALENDAR_ID).name = "Familienkalender";
      await syncTarget(ctx(), target.id);
      expect(listTargets(ctx(), ADMIN)[0]).toMatchObject({
        name: "Familie",
        remoteName: "Familienkalender",
      });
    });

    it("does not count notes about events somebody deleted", async () => {
      connectCalendarSystem(ctx());
      const target = await addTarget(ctx(), fake, {
        config: { onRemoteDelete: "forget" },
      });
      book();
      await syncTarget(ctx(), target.id);
      fake.get(CALENDAR_ID).events = [];
      await syncTarget(ctx(), target.id);
      expect(listTargets(ctx(), ADMIN)[0]!.eventCount).toBe(0);
      expect(listLinks(ctx(), target.id)).toHaveLength(1);
    });
  });

  describe("changing one", () => {
    it("merges settings over the stored ones and asks for a sync", async () => {
      connectCalendarSystem(ctx());
      const target = await addTarget(ctx(), fake, {
        kinds: ["appointments"],
        config: { titlePrefix: "[H] " },
      });
      const seen: string[] = [];
      const off = onEvent("calendarTargetChanged", ({ targetId }) =>
        seen.push(targetId),
      );
      const changed = updateTarget(ctx(), ADMIN, target.id, {
        name: "Neu",
        enabled: false,
        config: { kinds: ["task_due", "appointments"], alarmMinutes: 30 },
      });
      off();
      expect(changed).toMatchObject({
        name: "Neu",
        enabled: false,
        config: {
          kinds: ["appointments", "task_due"],
          titlePrefix: "[H] ",
          alarmMinutes: 30,
        },
      });
      expect(seen).toEqual([target.id]);
      expect(
        updateTarget(ctx(), ADMIN, target.id, {
          config: { alarmMinutes: null },
        }).config.alarmMinutes,
      ).toBeNull();
    });

    it("is for administrators when the target is the household's, and never turns it into a personal one", async () => {
      connectCalendarSystem(ctx());
      const target = await addTarget(ctx(), fake);
      expect(
        await codeOf(
          Promise.resolve().then(() =>
            updateTarget(ctx(), MEMBER, target.id, { name: "x" }),
          ),
        ),
      ).toBe("forbidden");
      expect(
        await codeOf(
          Promise.resolve().then(() =>
            updateTarget(ctx(), ADMIN, target.id, {
              config: { scope: "mine" },
            }),
          ),
        ),
      ).toBe("invalid_request");
      expect(
        await codeOf(
          Promise.resolve().then(() =>
            updateTarget(ctx(), ADMIN, "missing", { name: "x" }),
          ),
        ),
      ).toBe("not_found");
    });
  });

  describe("syncing now", () => {
    it("runs the sync and answers with its result and the fresh target", async () => {
      connectCalendarSystem(ctx());
      const target = await addTarget(ctx(), fake);
      book();
      const { result, target: view } = await syncNow(ctx(), ADMIN, target.id);
      expect(result).toMatchObject({ ok: true, counts: { created: 1 } });
      expect(view).toMatchObject({ status: "ok", eventCount: 1 });
      expect(await codeOf(syncNow(ctx(), MEMBER, target.id))).toBe("forbidden");
    });

    it("answers a failed run as a result", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      connectCalendarSystem(ctx());
      const target = await addTarget(ctx(), fake);
      fake.failNext("open", "tls");
      const { result, target: view } = await syncNow(ctx(), ADMIN, target.id);
      expect(result).toMatchObject({ ok: false, error: { code: "tls" } });
      expect(view).toMatchObject({ status: "error", lastError: "tls" });
    });
  });

  describe("removing one", () => {
    it("forgets the events and leaves them in the calendar by default", async () => {
      connectCalendarSystem(ctx());
      const target = await addTarget(ctx(), fake);
      book();
      await syncTarget(ctx(), target.id);
      await deleteTarget(ctx(), ADMIN, target.id);
      expect(listTargets(ctx(), ADMIN)).toEqual([]);
      expect(test.db.select().from(calendarLinks).all()).toEqual([]);
      expect(fake.ours(CALENDAR_ID).size).toBe(1);
      // A new target for the calendar takes the events over instead of writing them twice.
      const again = await addTarget(ctx(), fake);
      const result = await syncTarget(ctx(), again.id);
      expect(result.counts).toMatchObject({ created: 0, updated: 1 });
      expect(fake.get(CALENDAR_ID).events).toHaveLength(1);
    });

    it("removes the events hauswart wrote with removeRemote, and only those", async () => {
      connectCalendarSystem(ctx());
      const target = await addTarget(ctx(), fake);
      book();
      book("Maler");
      const foreign = fake.addForeign(CALENDAR_ID, "Zahnarzt");
      await syncTarget(ctx(), target.id);
      await deleteTarget(ctx(), ADMIN, target.id, { removeRemote: true });
      expect(fake.get(CALENDAR_ID).events.map((e) => e.uid)).toEqual([
        foreign.uid,
      ]);
      expect(test.db.select().from(calendarTargets).all()).toEqual([]);
    });

    it("removes events nothing remembers any more as well, if they carry the marker", async () => {
      connectCalendarSystem(ctx());
      const target = await addTarget(ctx(), fake);
      book();
      await syncTarget(ctx(), target.id);
      test.db.delete(calendarLinks).run();
      await deleteTarget(ctx(), ADMIN, target.id, { removeRemote: true });
      expect(fake.get(CALENDAR_ID).events).toEqual([]);
    });

    it("refuses removeRemote for a calendar that cannot delete, and keeps the target", async () => {
      connectCalendarSystem(ctx());
      const target = await addTarget(ctx(), fake, {
        capabilities: { ...FULL_CAPABILITIES, delete: false },
      });
      await expect(
        deleteTarget(ctx(), ADMIN, target.id, { removeRemote: true }),
      ).rejects.toMatchObject({
        code: "invalid_request",
        details: {
          query: { fieldErrors: { removeRemote: [expect.any(String)] } },
        },
      });
      expect(listTargets(ctx(), ADMIN)).toHaveLength(1);
    });

    it("keeps the target when the calendar cannot be reached, and finishes the job on a second try", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      connectCalendarSystem(ctx());
      const target = await addTarget(ctx(), fake);
      for (const title of ["A", "B", "C"]) book(title);
      await syncTarget(ctx(), target.id);
      fake.failNext("list", "timeout");
      await expect(
        deleteTarget(ctx(), ADMIN, target.id, { removeRemote: true }),
      ).rejects.toMatchObject({
        code: "upstream_error",
        details: { code: "timeout" },
      });
      fake.failNext("delete", "network");
      await expect(
        deleteTarget(ctx(), ADMIN, target.id, { removeRemote: true }),
      ).rejects.toMatchObject({
        code: "upstream_error",
        details: { code: "network", remaining: 3, disabled: true },
      });
      expect(listTargets(ctx(), ADMIN)).toHaveLength(1);
      expect(fake.ours(CALENDAR_ID).size).toBe(3);
      await deleteTarget(ctx(), ADMIN, target.id, { removeRemote: true });
      expect(fake.get(CALENDAR_ID).events).toEqual([]);
      expect(listTargets(ctx(), ADMIN)).toEqual([]);
    });

    it("refuses removeRemote while a sync of the target is running, and works afterwards", async () => {
      connectCalendarSystem(ctx());
      const target = await addTarget(ctx(), fake);
      book();
      let attempt: Promise<unknown> | undefined;
      fake.onCall = (call) => {
        if (call.step === "create" && !attempt) {
          attempt = deleteTarget(ctx(), ADMIN, target.id, {
            removeRemote: true,
          }).then(
            () => null,
            (err: unknown) => err,
          );
        }
      };
      expect((await syncTarget(ctx(), target.id)).ok).toBe(true);
      expect(await attempt).toMatchObject({
        code: "conflict",
        details: { code: "busy" },
      });
      expect(listTargets(ctx(), ADMIN)).toHaveLength(1);
      expect(fake.ours(CALENDAR_ID).size).toBe(1);
      fake.onCall = null;
      await deleteTarget(ctx(), ADMIN, target.id, { removeRemote: true });
      expect(fake.get(CALENDAR_ID).events).toEqual([]);
      expect(listTargets(ctx(), ADMIN)).toEqual([]);
    });

    it("lets no sync run while the events are removed, so none is written again", async () => {
      connectCalendarSystem(ctx());
      const target = await addTarget(ctx(), fake);
      for (const title of ["A", "B"]) book(title);
      await syncTarget(ctx(), target.id);
      let meanwhile: ReturnType<typeof syncTarget> | undefined;
      fake.onCall = (call) => {
        if (call.step === "delete" && !meanwhile) {
          meanwhile = syncTarget(ctx(), target.id);
        }
      };
      await deleteTarget(ctx(), ADMIN, target.id, { removeRemote: true });
      expect((await meanwhile)?.error?.code).toBe("busy");
      expect(fake.get(CALENDAR_ID).events).toEqual([]);
      expect(fake.callsOf("create")).toHaveLength(2);
    });

    it("switches the target off when the removal stops half way, says so, and a later try finishes", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      connectCalendarSystem(ctx());
      const target = await addTarget(ctx(), fake);
      for (const title of ["A", "B", "C"]) book(title);
      await syncTarget(ctx(), target.id);
      fake.failNext("delete", "network", 1, 1);
      await expect(
        deleteTarget(ctx(), ADMIN, target.id, { removeRemote: true }),
      ).rejects.toMatchObject({
        code: "upstream_error",
        message: expect.stringContaining("switched off"),
        details: { code: "network", deleted: 1, remaining: 2, disabled: true },
      });
      expect(listTargets(ctx(), ADMIN)[0]).toMatchObject({ enabled: false });
      expect(fake.ours(CALENDAR_ID).size).toBe(2);

      // Nothing writes the removed event again, however the sync is asked for.
      const creates = fake.callsOf("create").length;
      expect((await syncTarget(ctx(), target.id)).error?.code).toBe("disabled");
      expect(fake.callsOf("create")).toHaveLength(creates);

      await deleteTarget(ctx(), ADMIN, target.id, { removeRemote: true });
      expect(fake.get(CALENDAR_ID).events).toEqual([]);
      expect(listTargets(ctx(), ADMIN)).toEqual([]);
    });

    it("leaves a target as it was when the removal fails before an event was touched", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      connectCalendarSystem(ctx());
      const target = await addTarget(ctx(), fake);
      book();
      await syncTarget(ctx(), target.id);
      fake.failNext("list", "timeout");
      await expect(
        deleteTarget(ctx(), ADMIN, target.id, { removeRemote: true }),
      ).rejects.toMatchObject({ details: { code: "timeout" } });
      expect(listTargets(ctx(), ADMIN)[0]).toMatchObject({ enabled: true });
      test.db.update(connections).set({ enabled: false }).run();
      await expect(
        deleteTarget(ctx(), ADMIN, target.id, { removeRemote: true }),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(listTargets(ctx(), ADMIN)[0]).toMatchObject({ enabled: true });
    });

    it("stops a run that is going on when the target is deleted, without writing more or failing", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      connectCalendarSystem(ctx());
      const target = await addTarget(ctx(), fake);
      for (const title of ["A", "B", "C"]) book(title);
      fake.onCall = (call) => {
        if (call.step === "create" && fake.callsOf("create").length === 1) {
          void deleteTarget(ctx(), ADMIN, target.id);
        }
      };
      await expect(syncTarget(ctx(), target.id)).rejects.toMatchObject({
        code: "not_found",
      });
      expect(fake.callsOf("create")).toHaveLength(1);
      expect(test.db.select().from(calendarLinks).all()).toEqual([]);
      expect(test.db.select().from(calendarTargets).all()).toEqual([]);
      expect(error).not.toHaveBeenCalled();
    });

    it("needs a connection that is on for removeRemote, but not otherwise", async () => {
      connectCalendarSystem(ctx());
      const target = await addTarget(ctx(), fake);
      test.db.update(connections).set({ enabled: false }).run();
      expect(
        await codeOf(
          deleteTarget(ctx(), ADMIN, target.id, { removeRemote: true }),
        ),
      ).toBe("conflict");
      await deleteTarget(ctx(), ADMIN, target.id);
      expect(listTargets(ctx(), ADMIN)).toEqual([]);
    });

    it("has nothing to remove when the calendar is gone", async () => {
      connectCalendarSystem(ctx());
      const target = await addTarget(ctx(), fake);
      fake.calendars.delete(CALENDAR_ID);
      await deleteTarget(ctx(), ADMIN, target.id, { removeRemote: true });
      expect(listTargets(ctx(), ADMIN)).toEqual([]);
    });

    it("is for administrators when the target is the household's", async () => {
      connectCalendarSystem(ctx());
      const target = await addTarget(ctx(), fake);
      expect(await codeOf(deleteTarget(ctx(), MEMBER, target.id))).toBe(
        "forbidden",
      );
      expect(await codeOf(deleteTarget(ctx(), ADMIN, "missing"))).toBe(
        "not_found",
      );
    });

    it("goes away with its connection, links included", async () => {
      connectCalendarSystem(ctx());
      const target = await addTarget(ctx(), fake);
      book();
      await syncTarget(ctx(), target.id);
      test.db.delete(connections).run();
      expect(test.db.select().from(calendarTargets).all()).toEqual([]);
      expect(test.db.select().from(calendarLinks).all()).toEqual([]);
    });
  });
});
