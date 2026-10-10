import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { today } from "$lib/testing/dates";
import { useTestDB } from "$lib/testing/db";

type TireSet = {
  id: string;
  assetId: string;
  season: string;
  dot: string | null;
  mounted: boolean;
  mountedOn: string | null;
  treadDepthMm: number | null;
  treadWarning: boolean;
  ageYears: number | null;
  distance: number | null;
  odometerUnit: string;
  retiredAt: string | null;
  events: {
    id: string;
    kind: string;
    date: string;
    odometer: number | null;
    treadDepthMm: number | null;
  }[];
};
type Page<T> = { items: T[]; nextCursor: string | null };

function fieldError(body: unknown, field: string): string[] {
  const details = (
    body as { error: { details?: { body?: { fieldErrors?: object } } } }
  ).error.details?.body?.fieldErrors as Record<string, string[]> | undefined;
  return details?.[field] ?? [];
}

describe("tire sets API", () => {
  useTestDB();
  async function setup() {
    const user = await createTestUser();
    const call = createCaller({ session: loginTestUser(user).token });
    const vehicle = async (name = "Familienauto", kind = "vehicle") =>
      (await call("POST", "/api/v1/assets", { json: { name, kind } })).body as {
        id: string;
      };
    const set = async (assetId: string, json: object = { season: "winter" }) =>
      (await call("POST", `/api/v1/assets/${assetId}/tire-sets`, { json }))
        .body as TireSet;
    return { user, call, vehicle, set };
  }

  it("adds a set, reads it back and lists it with the derived fields", async () => {
    const { call, vehicle } = await setup();
    const car = await vehicle();
    const created = await call("POST", `/api/v1/assets/${car.id}/tire-sets`, {
      json: {
        season: "winter",
        brand: "Musterreifen",
        size: "205/55 R16 91H",
        dot: "0120",
        treadDepthMm: 3.5,
      },
    });
    expect(created.res.status).toBe(201);
    const set = created.body as TireSet;
    expect(set).toMatchObject({
      assetId: car.id,
      season: "winter",
      dot: "0120",
      mounted: false,
      mountedOn: null,
      treadDepthMm: 3.5,
      treadWarning: true,
      odometerUnit: "km",
      retiredAt: null,
    });
    expect(set.ageYears).toBeGreaterThan(5);
    expect(set.events).toMatchObject([
      { kind: "tread_measured", date: today(), treadDepthMm: 3.5 },
    ]);

    expect((await call("GET", `/api/v1/tire-sets/${set.id}`)).body).toEqual(
      set,
    );
    const list = (await call("GET", `/api/v1/assets/${car.id}/tire-sets`))
      .body as Page<TireSet & { events?: unknown }>;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ id: set.id, treadWarning: true });
    // The list is light: the history is in the detail.
    expect(list.items[0].events).toBeUndefined();
  });

  it("warns below the limit of the season only", async () => {
    const { set, vehicle } = await setup();
    const car = await vehicle();
    const warn = async (season: string, depth: number) =>
      (await set(car.id, { season, treadDepthMm: depth })).treadWarning;
    expect(await warn("summer", 3.1)).toBe(false);
    expect(await warn("summer", 2.9)).toBe(true);
    expect(await warn("winter", 4)).toBe(false);
    expect(await warn("winter", 3.9)).toBe(true);
    expect(await warn("all_season", 3.9)).toBe(true);
  });

  it.each([
    ["a DOT code of three digits", { season: "winter", dot: "242" }, "dot"],
    [
      "a DOT code with an impossible week",
      { season: "winter", dot: "5423" },
      "dot",
    ],
    ["a season that does not exist", { season: "spring" }, "season"],
    [
      "a negative depth",
      { season: "winter", treadDepthMm: -1 },
      "treadDepthMm",
    ],
    [
      "a depth beyond any tire",
      { season: "winter", treadDepthMm: 30 },
      "treadDepthMm",
    ],
    ["no season", {}, "season"],
    ["an unknown field", { season: "winter", mounted: true }, ""],
  ])("refuses %s", async (_name, json, field) => {
    const { call, vehicle } = await setup();
    const car = await vehicle();
    const r = await call("POST", `/api/v1/assets/${car.id}/tire-sets`, {
      json,
    });
    expect(r.res.status).toBe(400);
    if (field) expect(fieldError(r.body, field)).not.toEqual([]);
  });

  it("mounts a set, takes the other off and records the odometer", async () => {
    const { call, vehicle, set } = await setup();
    const car = await vehicle();
    const summer = await set(car.id, { season: "summer" });
    const winter = await set(car.id, { season: "winter" });
    const first = await call(
      "POST",
      `/api/v1/assets/${car.id}/tire-sets/${summer.id}/mount`,
      { json: { date: today(-60), odometer: 80_000 } },
    );
    expect(first.res.status).toBe(200);
    expect(first.body).toMatchObject({ mounted: true, mountedOn: today(-60) });
    const second = await call(
      "POST",
      `/api/v1/assets/${car.id}/tire-sets/${winter.id}/mount`,
      { json: { date: today(-1), odometer: 86_000 } },
    );
    expect(second.body).toMatchObject({ mounted: true, mountedOn: today(-1) });

    const list = (await call("GET", `/api/v1/assets/${car.id}/tire-sets`))
      .body as Page<TireSet>;
    expect(list.items.map((s) => [s.season, s.mounted])).toEqual([
      ["winter", true],
      ["summer", false],
    ]);
    const old = (await call("GET", `/api/v1/tire-sets/${summer.id}`))
      .body as TireSet;
    expect(old.distance).toBe(6_000);
    expect(old.events.map((e) => [e.kind, e.odometer])).toEqual([
      ["mounted", 80_000],
      ["unmounted", 86_000],
    ]);

    const odometer = (await call("GET", `/api/v1/assets/${car.id}/odometer`))
      .body as Page<{ value: number; source: string; sourceId: string }>;
    expect(odometer.items.map((r) => [r.value, r.source])).toEqual([
      [86_000, "tire_change"],
      [80_000, "tire_change"],
    ]);
    expect(odometer.items[0].sourceId).toBe(
      (second.body as TireSet).events.find((e) => e.kind === "mounted")?.id,
    );
  });

  it("a mount that the odometer refuses changes nothing", async () => {
    const { call, vehicle, set } = await setup();
    const car = await vehicle();
    await call("POST", `/api/v1/assets/${car.id}/odometer`, {
      json: { value: 90_000, date: today(-10) },
    });
    const winter = await set(car.id);
    const r = await call(
      "POST",
      `/api/v1/assets/${car.id}/tire-sets/${winter.id}/mount`,
      { json: { odometer: 1_000 } },
    );
    expect(r.res.status).toBe(400);
    expect(fieldError(r.body, "odometer")).not.toEqual([]);
    expect(
      ((await call("GET", `/api/v1/tire-sets/${winter.id}`)).body as TireSet)
        .mounted,
    ).toBe(false);
  });

  it("answers 409 for a set that is mounted already or retired, and 404 for another vehicle's", async () => {
    const { call, vehicle, set } = await setup();
    const car = await vehicle("Auto A");
    const other = await vehicle("Auto B");
    const winter = await set(car.id);
    const path = (assetId: string, id: string) =>
      `/api/v1/assets/${assetId}/tire-sets/${id}/mount`;
    expect(
      (await call("POST", path(car.id, winter.id), { json: {} })).res.status,
    ).toBe(200);
    expect(
      errorCode(await call("POST", path(car.id, winter.id), { json: {} })),
    ).toBe("conflict");
    const retired = await set(car.id, { season: "summer" });
    await call("PATCH", `/api/v1/tire-sets/${retired.id}`, {
      json: { retired: true },
    });
    expect(
      errorCode(await call("POST", path(car.id, retired.id), { json: {} })),
    ).toBe("conflict");
    expect(
      errorCode(await call("POST", path(other.id, winter.id), { json: {} })),
    ).toBe("not_found");
  });

  it("records tread measurements; the newest is the current depth", async () => {
    const { call, vehicle, set } = await setup();
    const car = await vehicle();
    const winter = await set(car.id, {
      treadDepthMm: 8,
      treadMeasuredOn: today(-30),
      season: "winter",
    });
    const r = await call("POST", `/api/v1/tire-sets/${winter.id}/tread`, {
      json: { treadDepthMm: 3.2, date: today(-1) },
    });
    expect(r.res.status).toBe(201);
    expect(r.body).toMatchObject({
      treadDepthMm: 3.2,
      treadMeasuredOn: today(-1),
      treadWarning: true,
    });
    expect((r.body as TireSet).events).toHaveLength(2);
    expect(
      errorCode(
        await call("POST", `/api/v1/tire-sets/${winter.id}/tread`, {
          json: { treadDepthMm: 99 },
        }),
      ),
    ).toBe("invalid_request");
  });

  it("changes, retires and deletes a set", async () => {
    const { call, vehicle, set } = await setup();
    const car = await vehicle();
    const winter = await set(car.id, { season: "winter", brand: "A" });
    const patched = await call("PATCH", `/api/v1/tire-sets/${winter.id}`, {
      json: { brand: "B", storageLocation: "Keller" },
    });
    expect(patched.body).toMatchObject({
      brand: "B",
      storageLocation: "Keller",
    });
    expect(
      errorCode(
        await call("PATCH", `/api/v1/tire-sets/${winter.id}`, {
          json: { mounted: true },
        }),
      ),
    ).toBe("invalid_request");

    await call("PATCH", `/api/v1/tire-sets/${winter.id}`, {
      json: { retired: true },
    });
    expect(
      (
        (await call("GET", `/api/v1/assets/${car.id}/tire-sets`))
          .body as Page<TireSet>
      ).items,
    ).toEqual([]);
    expect(
      (
        (
          await call(
            "GET",
            `/api/v1/assets/${car.id}/tire-sets?includeRetired=true`,
          )
        ).body as Page<TireSet>
      ).items,
    ).toHaveLength(1);

    expect(
      (await call("DELETE", `/api/v1/tire-sets/${winter.id}`)).res.status,
    ).toBe(204);
    expect(errorCode(await call("GET", `/api/v1/tire-sets/${winter.id}`))).toBe(
      "not_found",
    );
    expect(
      errorCode(await call("DELETE", `/api/v1/tire-sets/${winter.id}`)),
    ).toBe("not_found");
  });

  it("only vehicles have tire sets; a missing asset is a 404", async () => {
    const { call, vehicle } = await setup();
    const device = await vehicle("Backofen", "device");
    const r = await call("POST", `/api/v1/assets/${device.id}/tire-sets`, {
      json: { season: "winter" },
    });
    expect(r.res.status).toBe(400);
    expect(errorCode(await call("GET", "/api/v1/assets/nope/tire-sets"))).toBe(
      "not_found",
    );
  });

  it("tokens need read to look and write to change", async () => {
    const { user, vehicle, set } = await setup();
    const car = await vehicle();
    const winter = await set(car.id);
    const reader = createCaller({
      bearer: createTestToken(user, { scopes: ["read"] }).token,
    });
    expect(
      (await reader("GET", `/api/v1/tire-sets/${winter.id}`)).res.status,
    ).toBe(200);
    for (const [method, path, json] of [
      ["POST", `/api/v1/assets/${car.id}/tire-sets`, { season: "winter" }],
      ["PATCH", `/api/v1/tire-sets/${winter.id}`, { brand: "x" }],
      ["DELETE", `/api/v1/tire-sets/${winter.id}`, undefined],
      ["POST", `/api/v1/assets/${car.id}/tire-sets/${winter.id}/mount`, {}],
      ["POST", `/api/v1/tire-sets/${winter.id}/tread`, { treadDepthMm: 5 }],
    ] as const) {
      expect(
        (await reader(method, path, { json })).res.status,
        `${method} ${path}`,
      ).toBe(403);
    }
  });
});
