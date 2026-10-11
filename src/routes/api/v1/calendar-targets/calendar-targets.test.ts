import { describe, expect, it } from "vitest";
import type { CalendarTarget } from "$lib/api/schemas/calendar-sync";
import {
  addTarget,
  CALENDAR_ID,
  connectCalendarSystem,
  FULL_CAPABILITIES,
  PROVIDER,
  useFakeCalendars,
} from "$lib/server/calendar-sync/testing";
import { createAppointment } from "$lib/server/appointments/appointments";
import { lockTarget } from "$lib/server/calendar-sync/sync";
import { calendarTargets, connections } from "$lib/server/db";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, NOW } from "$lib/testing/domain";

const BODY = {
  provider: PROVIDER,
  remoteCalendarId: CALENDAR_ID,
  config: { kinds: ["appointments", "task_due"] },
};

describe("calendar targets API", () => {
  const test = useTestDB();
  const fake = useFakeCalendars();
  const ctx = () => ctxAt(test.db, NOW);

  async function people() {
    const admin = await createTestUser({ role: "admin" });
    const member = await createTestUser();
    return {
      admin,
      member,
      asAdmin: createCaller({ session: loginTestUser(admin).token }),
      asMember: createCaller({ session: loginTestUser(member).token }),
    };
  }
  const connect = () => {
    connectCalendarSystem(ctx());
    fake.add(CALENDAR_ID, { name: "Haushalt" });
  };
  // Handlers work with the real clock, so appointments are booked relative to it.
  const book = (title = "Kaminfeger") => {
    const starts = Date.now() + 2 * 86_400_000;
    return createAppointment(
      ctx(),
      { title, startsAt: starts, endsAt: starts + 3_600_000 },
      null,
    );
  };

  describe("POST /calendar-targets", () => {
    it("adds a calendar for the household with the defaults filled in", async () => {
      const { asAdmin } = await people();
      connect();
      const r = await asAdmin("POST", "/api/v1/calendar-targets", {
        json: BODY,
      });
      expect(r.res.status).toBe(201);
      expect(r.body).toMatchObject({
        provider: PROVIDER,
        level: "household",
        ownerId: null,
        remoteCalendarId: CALENDAR_ID,
        name: "Haushalt",
        enabled: true,
        capabilities: FULL_CAPABILITIES,
        status: "unknown",
        lastError: null,
        lastOkAt: null,
        lastCheckedAt: null,
        consecutiveFailures: 0,
        lastStats: null,
        eventCount: 0,
        canManage: true,
        config: {
          kinds: ["appointments", "task_due"],
          direction: "push",
          scope: "all",
          timedMode: "all_day",
          dueTime: "08:00",
          dueDurationMinutes: 30,
          alarmMinutes: null,
          titlePrefix: "",
          onRemoteDelete: "recreate",
          conflictPolicy: "hauswart_wins",
          locale: "de",
        },
      });
    });

    it("puts the kinds in their order and is refused for anybody but an administrator", async () => {
      const { asAdmin, asMember } = await people();
      connect();
      expect(
        errorCode(
          await asMember("POST", "/api/v1/calendar-targets", { json: BODY }),
        ),
      ).toBe("forbidden");
      const r = await asAdmin("POST", "/api/v1/calendar-targets", {
        json: {
          ...BODY,
          config: { kinds: ["warranty_ends", "task_due", "appointments"] },
        },
      });
      expect((r.body as CalendarTarget).config.kinds).toEqual([
        "appointments",
        "task_due",
        "warranty_ends",
      ]);
    });

    it("validates the body, and offers only what works today", async () => {
      const { asAdmin } = await people();
      connect();
      const bad = (json: unknown) =>
        asAdmin("POST", "/api/v1/calendar-targets", { json });
      const config = (over: object) => ({
        ...BODY,
        config: { kinds: ["task_due"], ...over },
      });
      for (const json of [
        {},
        { ...BODY, config: {} },
        { ...BODY, config: { kinds: [] } },
        { ...BODY, config: { kinds: ["task_due", "task_due"] } },
        { ...BODY, config: { kinds: ["emails"] } },
        { ...BODY, provider: "paperless" },
        { ...BODY, remoteCalendarId: " " },
        { ...BODY, extra: true },
        config({ direction: "pull" }),
        config({ direction: "both" }),
        config({ conflictPolicy: "remote_wins" }),
        config({ scope: "everyone" }),
        config({ timedMode: "sometimes" }),
        config({ dueTime: "25:00" }),
        config({ dueDurationMinutes: 1 }),
        config({ alarmMinutes: -1 }),
        config({ titlePrefix: "x".repeat(31) }),
        config({ onRemoteDelete: "ask" }),
        config({ locale: "fr" }),
        config({ unknown: 1 }),
      ]) {
        expect(errorCode(await bad(json)), JSON.stringify(json)).toBe(
          "invalid_request",
        );
      }
    });

    it("answers 404 without a connection and 400 for a calendar that cannot be used", async () => {
      const { asAdmin } = await people();
      fake.add(CALENDAR_ID);
      const post = () =>
        asAdmin("POST", "/api/v1/calendar-targets", { json: BODY });
      expect(errorCode(await post())).toBe("not_found");
      connectCalendarSystem(ctx());
      fake.calendars.delete(CALENDAR_ID);
      const missing = await post();
      expect(missing.res.status).toBe(400);
      expect(missing.body).toMatchObject({
        error: {
          code: "invalid_request",
          details: {
            body: { fieldErrors: { remoteCalendarId: [expect.any(String)] } },
          },
        },
      });
      fake.add(CALENDAR_ID, {
        capabilities: { ...FULL_CAPABILITIES, create: false },
      });
      expect((await post()).res.status).toBe(400);
    });

    it("answers 409 for a calendar that has a target, and 502 when the system fails", async () => {
      const { asAdmin } = await people();
      connect();
      fake.failNext("open", "timeout");
      const failed = await asAdmin("POST", "/api/v1/calendar-targets", {
        json: BODY,
      });
      expect(failed.res.status).toBe(502);
      expect(failed.body).toMatchObject({
        error: { code: "upstream_error", details: { code: "timeout" } },
      });
      expect(
        (await asAdmin("POST", "/api/v1/calendar-targets", { json: BODY })).res
          .status,
      ).toBe(201);
      expect(
        errorCode(
          await asAdmin("POST", "/api/v1/calendar-targets", { json: BODY }),
        ),
      ).toBe("conflict");
    });

    it("needs the write scope with a token", async () => {
      const { admin } = await people();
      connect();
      const call = (scopes: ("read" | "write" | "admin")[]) =>
        createCaller({ bearer: createTestToken(admin, { scopes }).token });
      expect(
        errorCode(
          await call(["read"])("POST", "/api/v1/calendar-targets", {
            json: BODY,
          }),
        ),
      ).toBe("forbidden");
      expect(
        (
          await call(["write", "admin"])("POST", "/api/v1/calendar-targets", {
            json: BODY,
          })
        ).res.status,
      ).toBe(201);
    });
  });

  describe("GET /calendar-targets", () => {
    it("lists the household's targets for everybody, as something only an administrator changes", async () => {
      const { asAdmin, asMember } = await people();
      connect();
      const target = await addTarget(ctx(), fake);
      for (const [call, canManage] of [
        [asAdmin, true],
        [asMember, false],
      ] as const) {
        const r = await call("GET", "/api/v1/calendar-targets");
        expect(r.res.status).toBe(200);
        expect(r.body).toMatchObject({
          items: [{ id: target.id, canManage }],
          nextCursor: null,
        });
      }
    });

    it("does not show another person's targets", async () => {
      const { member, asAdmin, asMember } = await people();
      connect();
      const [connection] = test.db.select().from(connections).all();
      const personal = test.db
        .insert(calendarTargets)
        .values({
          connectionId: connection!.id,
          provider: PROVIDER,
          remoteCalendarId: "calendar.personal",
          name: "Meins",
          level: "user",
          userId: member.id,
          configJson: { kinds: ["appointments"] },
        })
        .returning()
        .get();
      expect(
        (
          (await asMember("GET", "/api/v1/calendar-targets")).body as {
            items: { id: string }[];
          }
        ).items.map((t) => t.id),
      ).toEqual([personal.id]);
      expect(
        (
          (await asAdmin("GET", "/api/v1/calendar-targets")).body as {
            items: unknown[];
          }
        ).items,
      ).toEqual([]);
      for (const [method, path] of [
        ["PATCH", `/api/v1/calendar-targets/${personal.id}`],
        ["DELETE", `/api/v1/calendar-targets/${personal.id}`],
        ["POST", `/api/v1/calendar-targets/${personal.id}/sync`],
      ] as const) {
        const r = await asAdmin(method, path, {
          json: method === "PATCH" ? { name: "x" } : undefined,
        });
        expect([method, errorCode(r)]).toEqual([method, "not_found"]);
      }
    });
  });

  describe("PATCH /calendar-targets/{id}", () => {
    it("changes name, switch and settings, merging the settings", async () => {
      const { asAdmin, asMember } = await people();
      connect();
      const target = await addTarget(ctx(), fake, {
        config: { titlePrefix: "[H] " },
      });
      const path = `/api/v1/calendar-targets/${target.id}`;
      const r = await asAdmin("PATCH", path, {
        json: {
          name: "Familie",
          enabled: false,
          config: { alarmMinutes: 15, timedMode: "timed" },
        },
      });
      expect(r.res.status).toBe(200);
      expect(r.body).toMatchObject({
        name: "Familie",
        enabled: false,
        config: { titlePrefix: "[H] ", alarmMinutes: 15, timedMode: "timed" },
      });
      expect(
        errorCode(await asMember("PATCH", path, { json: { name: "x" } })),
      ).toBe("forbidden");
      for (const json of [
        {},
        { config: {} },
        { config: { direction: "pull" } },
        { config: { scope: "mine" } },
        { name: "" },
        { provider: "paperless" },
      ]) {
        const bad = await asAdmin("PATCH", path, { json });
        // `{ config: {} }` changes nothing but is a valid request.
        if (JSON.stringify(json) === '{"config":{}}') {
          expect(bad.res.status).toBe(200);
        } else {
          expect([JSON.stringify(json), errorCode(bad)]).toEqual([
            JSON.stringify(json),
            "invalid_request",
          ]);
        }
      }
    });
  });

  describe("POST /calendar-targets/{id}/sync", () => {
    it("syncs now and answers with the counts and the fresh target", async () => {
      const { asAdmin, asMember } = await people();
      connect();
      const target = await addTarget(ctx(), fake);
      book();
      const path = `/api/v1/calendar-targets/${target.id}/sync`;
      expect(errorCode(await asMember("POST", path))).toBe("forbidden");
      const r = await asAdmin("POST", path);
      expect(r.res.status).toBe(200);
      expect(r.body).toMatchObject({
        ok: true,
        error: null,
        counts: { created: 1, failed: 0, remaining: 0 },
        target: {
          id: target.id,
          status: "ok",
          eventCount: 1,
          lastStats: { created: 1 },
        },
      });
      expect(fake.ours(CALENDAR_ID).size).toBe(1);
    });

    it("answers a failed run as 200 with the code, also on the target", async () => {
      const { asAdmin } = await people();
      connect();
      const target = await addTarget(ctx(), fake);
      fake.failNext("open", "unauthorized");
      const r = await asAdmin(
        "POST",
        `/api/v1/calendar-targets/${target.id}/sync`,
      );
      expect(r.res.status).toBe(200);
      expect(r.body).toMatchObject({
        ok: false,
        error: { code: "unauthorized", message: expect.any(String) },
        target: {
          status: "error",
          lastError: "unauthorized",
          consecutiveFailures: 1,
        },
      });
    });

    it("answers 404 for a target that does not exist", async () => {
      const { asAdmin } = await people();
      expect(
        errorCode(
          await asAdmin("POST", "/api/v1/calendar-targets/missing/sync"),
        ),
      ).toBe("not_found");
    });
  });

  describe("DELETE /calendar-targets/{id}", () => {
    it("removes the target and leaves the events", async () => {
      const { asAdmin, asMember } = await people();
      connect();
      const target = await addTarget(ctx(), fake);
      book();
      await asAdmin("POST", `/api/v1/calendar-targets/${target.id}/sync`);
      const path = `/api/v1/calendar-targets/${target.id}`;
      expect(errorCode(await asMember("DELETE", path))).toBe("forbidden");
      const r = await asAdmin("DELETE", path);
      expect(r.res.status).toBe(204);
      expect(fake.ours(CALENDAR_ID).size).toBe(1);
      expect(
        (
          (await asAdmin("GET", "/api/v1/calendar-targets")).body as {
            items: unknown[];
          }
        ).items,
      ).toEqual([]);
      expect(errorCode(await asAdmin("DELETE", path))).toBe("not_found");
    });

    it("removes the events too with removeRemote=true", async () => {
      const { asAdmin } = await people();
      connect();
      const target = await addTarget(ctx(), fake);
      const foreign = fake.addForeign(CALENDAR_ID, "Zahnarzt");
      book();
      await asAdmin("POST", `/api/v1/calendar-targets/${target.id}/sync`);
      const r = await asAdmin(
        "DELETE",
        `/api/v1/calendar-targets/${target.id}?removeRemote=true`,
      );
      expect(r.res.status).toBe(204);
      expect(fake.get(CALENDAR_ID).events.map((e) => e.uid)).toEqual([
        foreign.uid,
      ]);
    });

    it("refuses removeRemote for a calendar that cannot delete, and a flag that is no boolean", async () => {
      const { asAdmin } = await people();
      connectCalendarSystem(ctx());
      const target = await addTarget(ctx(), fake, {
        capabilities: { ...FULL_CAPABILITIES, delete: false },
      });
      const path = `/api/v1/calendar-targets/${target.id}`;
      const refused = await asAdmin("DELETE", `${path}?removeRemote=true`);
      expect(refused.res.status).toBe(400);
      expect(refused.body).toMatchObject({
        error: {
          details: {
            query: { fieldErrors: { removeRemote: [expect.any(String)] } },
          },
        },
      });
      expect(
        errorCode(await asAdmin("DELETE", `${path}?removeRemote=maybe`)),
      ).toBe("invalid_request");
      expect(
        (await asAdmin("DELETE", `${path}?removeRemote=false`)).res.status,
      ).toBe(204);
    });

    it("answers 502 and keeps the target when the system fails", async () => {
      const { asAdmin } = await people();
      connect();
      const target = await addTarget(ctx(), fake);
      fake.failNext("open", "network");
      const r = await asAdmin(
        "DELETE",
        `/api/v1/calendar-targets/${target.id}?removeRemote=true`,
      );
      expect(r.res.status).toBe(502);
      expect(r.body).toMatchObject({
        error: { code: "upstream_error", details: { code: "network" } },
      });
      expect(
        (
          (await asAdmin("GET", "/api/v1/calendar-targets")).body as {
            items: unknown[];
          }
        ).items,
      ).toHaveLength(1);
    });

    it("answers 409 busy while a sync of the target is running", async () => {
      const { asAdmin } = await people();
      connect();
      const target = await addTarget(ctx(), fake);
      book();
      await asAdmin("POST", `/api/v1/calendar-targets/${target.id}/sync`);
      const release = lockTarget(target.id)!;
      const r = await asAdmin(
        "DELETE",
        `/api/v1/calendar-targets/${target.id}?removeRemote=true`,
      );
      release();
      expect(r.res.status).toBe(409);
      expect(r.body).toMatchObject({
        error: { code: "conflict", details: { code: "busy" } },
      });
      expect(fake.ours(CALENDAR_ID).size).toBe(1);
    });

    it("answers 502, says the target was switched off, and keeps it when the removal stops half way", async () => {
      const { asAdmin } = await people();
      connect();
      const target = await addTarget(ctx(), fake);
      book();
      book("Maler");
      await asAdmin("POST", `/api/v1/calendar-targets/${target.id}/sync`);
      fake.failNext("delete", "network", 1, 1);
      const r = await asAdmin(
        "DELETE",
        `/api/v1/calendar-targets/${target.id}?removeRemote=true`,
      );
      expect(r.res.status).toBe(502);
      expect(r.body).toMatchObject({
        error: {
          code: "upstream_error",
          details: {
            code: "network",
            deleted: 1,
            remaining: 1,
            disabled: true,
          },
        },
      });
      const listed = (await asAdmin("GET", "/api/v1/calendar-targets"))
        .body as {
        items: CalendarTarget[];
      };
      expect(listed.items).toMatchObject([{ id: target.id, enabled: false }]);
    });
  });
});
