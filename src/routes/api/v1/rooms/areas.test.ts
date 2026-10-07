import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IntegrationError } from "$lib/server/connections/errors";
import { saveConnection } from "$lib/server/connections/connections";
import {
  registerIntegration,
  type IntegrationOperation,
} from "$lib/server/connections/registry";
import { getDB } from "$lib/server/db";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";

interface Area {
  id: string;
  name: string;
  floor: string | null;
}

interface RoomBody {
  id: string;
  name: string;
  slug: string;
  haAreaId: string | null;
  sortOrder: number;
}

interface ImportBody {
  items: {
    areaId: string;
    outcome: string;
    room: RoomBody | null;
  }[];
}

const AREAS: Area[] = [
  { id: "living_room", name: "Wohnzimmer", floor: "Erdgeschoss" },
  { id: "kitchen", name: "Küche", floor: "Erdgeschoss" },
  { id: "bedroom", name: "Schlafzimmer", floor: "Obergeschoss" },
  { id: "bath_up", name: "Bad", floor: "Obergeschoss" },
  { id: "bath_down", name: "Bad", floor: "Erdgeschoss" },
];

describe("areas of a connected system as rooms", () => {
  useTestDB();
  let areas: Area[];
  let operation: IntegrationOperation;
  const stops: (() => void)[] = [];

  beforeEach(() => {
    areas = AREAS.map((a) => ({ ...a }));
    operation = async () => ({ items: areas });
  });
  afterEach(() => stops.splice(0).forEach((stop) => stop()));

  function connect(operations: Record<string, IntegrationOperation> = {}) {
    stops.push(
      registerIntegration({
        kind: "homeassistant",
        test: async () => ({ ok: true }),
        describe: () => ({ capabilities: ["areas"] }),
        operations: { areas: (...args) => operation(...args), ...operations },
      }),
    );
    saveConnection({ db: getDB(), now: Date.now() }, "homeassistant", null, {
      baseUrl: "https://home.example.org",
      token: "token-for-tests",
      allowInsecureTls: false,
    });
  }

  async function member() {
    const user = await createTestUser();
    return createCaller({ session: loginTestUser(user).token });
  }

  const importAreas = (
    call: Awaited<ReturnType<typeof member>>,
    areaIds: string[],
  ) =>
    call("POST", "/api/v1/rooms/import-areas", {
      json: { kind: "homeassistant", areaIds },
    });

  const roomsOf = async (call: Awaited<ReturnType<typeof member>>) =>
    ((await call("GET", "/api/v1/rooms")).body as { items: RoomBody[] }).items;

  describe("the picker", () => {
    it("lists the areas with their floor and the room that stores each id", async () => {
      connect();
      const call = await member();
      const linked = (
        await call("POST", "/api/v1/rooms", {
          json: { name: "Stube", haAreaId: "Living_Room" },
        })
      ).body as RoomBody;
      await call("POST", "/api/v1/rooms", { json: { name: "Küche" } });

      const r = await call("GET", "/api/v1/integrations/homeassistant/areas");
      expect(r.res.status).toBe(200);
      const items = (r.body as { items: (Area & { roomId: string | null })[] })
        .items;
      expect(items.map((a) => a.id)).toEqual(AREAS.map((a) => a.id));
      expect(items[0]).toEqual({
        id: "living_room",
        name: "Wohnzimmer",
        floor: "Erdgeschoss",
        roomId: linked.id,
      });
      expect(items.slice(1).map((a) => a.roomId)).toEqual([
        null,
        null,
        null,
        null,
      ]);
    });

    it("answers 404 without a connection or for a kind without areas, 502 when the system fails", async () => {
      const call = await member();
      const none = await call(
        "GET",
        "/api/v1/integrations/homeassistant/areas",
      );
      expect([none.res.status, errorCode(none)]).toEqual([404, "not_found"]);

      connect();
      operation = async () => {
        throw new IntegrationError("timeout", "Home did not answer in time.");
      };
      const failed = await call(
        "GET",
        "/api/v1/integrations/homeassistant/areas",
      );
      expect([failed.res.status, errorCode(failed)]).toEqual([
        502,
        "upstream_error",
      ]);
      expect(failed.body).toMatchObject({
        error: { details: { code: "timeout" } },
      });

      const paperless = await call(
        "GET",
        "/api/v1/integrations/paperless/areas",
      );
      expect(paperless.res.status).toBe(404);
    });

    it("answers 502 invalid_response when the adapter returns something else", async () => {
      connect();
      operation = async () => ({ items: [{ id: 1 }] });
      const call = await member();
      const r = await call("GET", "/api/v1/integrations/homeassistant/areas");
      expect([r.res.status, errorCode(r)]).toEqual([502, "upstream_error"]);
      expect(r.body).toMatchObject({
        error: { details: { code: "invalid_response" } },
      });
    });
  });

  describe("the import", () => {
    it("creates rooms named like the areas, in the order given, with the area id", async () => {
      connect();
      const call = await member();
      await call("POST", "/api/v1/rooms", { json: { name: "Flur" } });

      const r = await importAreas(call, ["bedroom", "living_room"]);
      expect(r.res.status).toBe(200);
      const items = (r.body as ImportBody).items;
      expect(items.map((i) => [i.areaId, i.outcome])).toEqual([
        ["bedroom", "created"],
        ["living_room", "created"],
      ]);
      expect(items[0].room).toMatchObject({
        name: "Schlafzimmer",
        slug: "schlafzimmer",
        haAreaId: "bedroom",
        sortOrder: 1,
      });
      expect(items[1].room).toMatchObject({
        name: "Wohnzimmer",
        haAreaId: "living_room",
        sortOrder: 2,
      });
      expect((await roomsOf(call)).map((room) => room.name)).toEqual([
        "Flur",
        "Schlafzimmer",
        "Wohnzimmer",
      ]);
    });

    it("takes the names from the system, never from the caller", async () => {
      connect();
      const call = await member();
      const r = await call("POST", "/api/v1/rooms/import-areas", {
        json: { kind: "homeassistant", areaIds: ["kitchen"], name: "Evil" },
      });
      expect(r.res.status).toBe(400);
      await importAreas(call, ["kitchen"]);
      expect((await roomsOf(call)).map((room) => room.name)).toEqual(["Küche"]);
    });

    it("is repeatable: an area that has a room is left alone, and a rename in the system changes nothing", async () => {
      connect();
      const call = await member();
      await importAreas(call, ["kitchen", "living_room"]);
      const first = await roomsOf(call);

      const renamed = first.find((room) => room.haAreaId === "kitchen")!;
      await call("PATCH", `/api/v1/rooms/${renamed.id}`, {
        json: { name: "Kochnische" },
      });
      areas = areas.map((a) =>
        a.id === "kitchen" ? { ...a, name: "Grosse Küche" } : a,
      );

      const again = await importAreas(call, ["kitchen", "living_room"]);
      expect(
        (again.body as ImportBody).items.map((i) => [i.areaId, i.outcome]),
      ).toEqual([
        ["kitchen", "unchanged"],
        ["living_room", "unchanged"],
      ]);
      const rooms = await roomsOf(call);
      expect(rooms).toHaveLength(2);
      expect(rooms.map((room) => room.name).sort()).toEqual([
        "Kochnische",
        "Wohnzimmer",
      ]);
      const picked = (
        (await call("GET", "/api/v1/integrations/homeassistant/areas"))
          .body as {
          items: { id: string; roomId: string | null }[];
        }
      ).items.find((a) => a.id === "kitchen");
      expect(picked?.roomId).toBe(renamed.id);
    });

    it("links an unlinked room of the same name instead of duplicating it", async () => {
      connect();
      const call = await member();
      const existing = (
        await call("POST", "/api/v1/rooms", {
          json: { name: "kueche", notes: "Nordseite" },
        })
      ).body as RoomBody;
      const stale = (
        await call("POST", "/api/v1/rooms", {
          json: { name: "Wohnzimmer", haAreaId: "removed_area" },
        })
      ).body as RoomBody;
      const other = (
        await call("POST", "/api/v1/rooms", {
          json: { name: "Schlafzimmer", haAreaId: "kitchen" },
        })
      ).body as RoomBody;

      const r = await importAreas(call, ["kitchen", "living_room", "bedroom"]);
      const items = (r.body as ImportBody).items;
      expect(items.map((i) => [i.areaId, i.outcome, i.room?.id])).toEqual([
        ["kitchen", "unchanged", other.id],
        ["living_room", "linked", stale.id],
        ["bedroom", "created", expect.not.stringMatching(other.id)],
      ]);
      expect(items[1].room).toMatchObject({
        name: "Wohnzimmer",
        haAreaId: "living_room",
      });
      const rooms = await roomsOf(call);
      expect(rooms).toHaveLength(4);
      expect(
        rooms.find((room) => room.id === existing.id)?.haAreaId,
      ).toBeNull();

      const second = await importAreas(call, ["kitchen", "living_room"]);
      expect((second.body as ImportBody).items.map((i) => i.outcome)).toEqual([
        "unchanged",
        "unchanged",
      ]);
      expect(await roomsOf(call)).toHaveLength(4);
    });

    it("links a room by name when the area is picked and the room stores nothing yet", async () => {
      connect();
      const call = await member();
      const existing = (
        await call("POST", "/api/v1/rooms", { json: { name: "Küche" } })
      ).body as RoomBody;
      const r = await importAreas(call, ["kitchen"]);
      expect((r.body as ImportBody).items[0]).toMatchObject({
        outcome: "linked",
        room: { id: existing.id, name: "Küche", haAreaId: "kitchen" },
      });
      expect(await roomsOf(call)).toHaveLength(1);
    });

    it("keeps two areas with the same name apart", async () => {
      connect();
      const call = await member();
      const r = await importAreas(call, ["bath_up", "bath_down"]);
      expect((r.body as ImportBody).items.map((i) => i.outcome)).toEqual([
        "created",
        "created",
      ]);
      const rooms = await roomsOf(call);
      expect(
        rooms.map((room) => [room.name, room.slug, room.haAreaId]),
      ).toEqual([
        ["Bad", "bad", "bath_up"],
        ["Bad", "bad-2", "bath_down"],
      ]);
    });

    it("reports an area the system no longer lists and still imports the rest, once each", async () => {
      connect();
      const call = await member();
      const r = await importAreas(call, ["gone", "kitchen", "kitchen"]);
      expect(r.res.status).toBe(200);
      expect(
        (r.body as ImportBody).items.map((i) => [i.areaId, i.outcome]),
      ).toEqual([
        ["gone", "not_found"],
        ["kitchen", "created"],
      ]);
      expect((r.body as ImportBody).items[0].room).toBeNull();
      expect(await roomsOf(call)).toHaveLength(1);
    });

    it("cuts a long name to the room name limit", async () => {
      connect();
      areas = [{ id: "long", name: "x".repeat(150), floor: null }];
      const call = await member();
      const r = await importAreas(call, ["long"]);
      expect((r.body as ImportBody).items[0].room?.name).toHaveLength(100);
    });

    it("rolls back everything when a room cannot be created", async () => {
      connect();
      areas = [
        { id: "a", name: "Anbau", floor: null },
        { id: "b", name: "x".repeat(10), floor: null },
      ];
      const call = await member();
      getDB().run(
        sql`CREATE TRIGGER fail_second BEFORE INSERT ON rooms WHEN NEW.name = 'xxxxxxxxxx' BEGIN SELECT RAISE(ABORT, 'nope'); END`,
      );
      const r = await importAreas(call, ["a", "b"]);
      expect(r.res.status).toBe(500);
      expect(await roomsOf(call)).toEqual([]);
    });

    it("validates the body", async () => {
      connect();
      const call = await member();
      for (const json of [
        { kind: "homeassistant", areaIds: [] },
        { kind: "homeassistant" },
        { areaIds: ["kitchen"] },
        { kind: "nope", areaIds: ["kitchen"] },
        { kind: "homeassistant", areaIds: [""] },
        {
          kind: "homeassistant",
          areaIds: Array.from({ length: 201 }, (_, i) => `a${i}`),
        },
      ]) {
        const r = await call("POST", "/api/v1/rooms/import-areas", { json });
        expect([r.res.status, errorCode(r)]).toEqual([400, "invalid_request"]);
      }
    });

    it("answers 404 without a connection and 502 when the system fails", async () => {
      const call = await member();
      const none = await importAreas(call, ["kitchen"]);
      expect([none.res.status, errorCode(none)]).toEqual([404, "not_found"]);

      connect();
      operation = async () => {
        throw new IntegrationError("network", "Home is not reachable.");
      };
      const failed = await importAreas(call, ["kitchen"]);
      expect([failed.res.status, errorCode(failed)]).toEqual([
        502,
        "upstream_error",
      ]);
      expect(await roomsOf(call)).toEqual([]);
    });

    it("needs the write scope", async () => {
      connect();
      const user = await createTestUser();
      const reader = createCaller({
        bearer: createTestToken(user, { scopes: ["read"] }).token,
      });
      const denied = await reader("POST", "/api/v1/rooms/import-areas", {
        json: { kind: "homeassistant", areaIds: ["kitchen"] },
      });
      expect([denied.res.status, errorCode(denied)]).toEqual([
        403,
        "forbidden",
      ]);
      expect(
        (await reader("GET", "/api/v1/integrations/homeassistant/areas")).res
          .status,
      ).toBe(200);
    });
  });
});
