import { describe, expect, it } from "vitest";
import { endpoints } from "../../src/lib/api/registry";
import type { TireSet } from "../../src/lib/api/schemas/tire-sets";
import { createVehicle, useMcp } from "./test-harness";
import { findTireSets } from "./tools/tires";

describe("finding a tire set by words", () => {
  const set = (id: string, over: Partial<TireSet>): TireSet =>
    ({
      id,
      season: "winter",
      brand: null,
      model: null,
      size: null,
      dot: null,
      retiredAt: null,
      ...over,
    }) as TireSet;
  const sets = [
    set("a1", {
      season: "winter",
      brand: "Musterreifen",
      model: "Frost",
      size: "205/55 R16",
      dot: "2423",
    }),
    set("a2", {
      season: "summer",
      brand: "Musterreifen",
      model: "Sommer",
      size: "205/55 R16",
    }),
    set("a3", { season: "all_season", brand: "Beispielgummi" }),
    set("a4", { season: "winter", brand: "Alt", retiredAt: "2025-01-01" }),
  ];

  it.each([
    ["an id", "a2", ["a2"]],
    ["the season", "winter", ["a1"]],
    ["the season in capitals", "SUMMER", ["a2"]],
    ["all-season written three ways", "all-season", ["a3"]],
    ["all_season", "all_season", ["a3"]],
    ["all season", "all season", ["a3"]],
    ["season and brand", "winter musterreifen", ["a1"]],
    ["the size", "205/55 r16", ["a1", "a2"]],
    ["the DOT code", "2423", ["a1"]],
    ["words that say what it is, not which", "winter tires", ["a1"]],
    ["only such words", "tires", []],
    ["nothing", "   ", []],
    ["a word none of them has", "winter pirelli", []],
    ["a retired set by words", "alt", []],
  ])("%s", (_name, ref, ids) => {
    expect(findTireSets(sets, ref).map((s) => s.id)).toEqual(ids);
  });

  it("finds a retired set by its id", () => {
    expect(findTireSets(sets, "a4").map((s) => s.id)).toEqual(["a4"]);
  });
});

describe("tire set tools", () => {
  const mcp = useMcp();

  async function connect(scopes: ("read" | "write")[] = ["read", "write"]) {
    const session = await mcp.connect({ scopes });
    const vehicle = (
      name = "Familienauto",
      plate: string | null = "ZH 000000",
      details: Record<string, unknown> = {},
    ) => createVehicle(session, name, plate, details);
    const addSet = (over: Record<string, unknown> = {}) =>
      session.ok("add_tire_set", {
        vehicle: "Familienauto",
        season: "winter",
        ...over,
      });
    return { ...session, vehicle, addSet };
  }

  it("offers listing to a reader and the rest to a writer only", async () => {
    const reader = await connect(["read"]);
    const names = (await reader.client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("list_tire_sets");
    for (const writer of [
      "add_tire_set",
      "mount_tire_set",
      "record_tire_tread",
    ]) {
      expect(names).not.toContain(writer);
    }
    const writer = await connect();
    expect((await writer.client.listTools()).tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "list_tire_sets",
        "add_tire_set",
        "mount_tire_set",
        "record_tire_tread",
      ]),
    );
  });

  it("adds a set that is not mounted and lists it with its warning and age", async () => {
    const { call, vehicle, addSet, day } = await connect();
    const id = await vehicle();
    const set = await addSet({
      brand: "Musterreifen",
      model: "Frost",
      size: "205/55 R16 91H",
      dot: "2423",
      treadDepthMm: 3.5,
      measuredOn: day(-2),
      storageLocation: "Keller",
      purchasedOn: "2024-10-05",
      notes: "mit Felgen",
    });
    expect(set).toMatchObject({
      vehicle: "Familienauto",
      vehicleId: id,
      season: "winter",
      brand: "Musterreifen",
      model: "Frost",
      size: "205/55 R16 91H",
      dot: "2423",
      treadMm: 3.5,
      treadMeasuredOn: day(-2),
      treadWarning: true,
      storage: "Keller",
      purchasedOn: "2024-10-05",
      notes: "mit Felgen",
    });
    expect(set.ageYears).toBeTypeOf("number");
    expect(set.mounted).toBeUndefined();

    const list = await call("list_tire_sets", { vehicle: "ZH 000000" });
    expect(list.summary).toBe(
      "1 tire set on Familienauto, ZH 000000; none mounted.",
    );
    expect(list.json.tireSets).toMatchObject([
      { id: set.id, treadWarning: true },
    ]);
  });

  it("refuses a DOT code that is none", async () => {
    const { call, vehicle } = await connect();
    await vehicle();
    const reply = await call("add_tire_set", {
      vehicle: "Familienauto",
      season: "summer",
      dot: "9999",
    });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("body.dot");
  });

  it("mounts a set by its season, takes the other off and counts the distance on each", async () => {
    const { call, ok, vehicle, addSet, day } = await connect();
    await vehicle();
    const winter = await addSet({ season: "winter", brand: "Musterreifen" });
    const summer = await addSet({ season: "summer", brand: "Beispielgummi" });

    const firstReply = await call("mount_tire_set", {
      vehicle: "Familienauto",
      tireSet: "winter",
      date: day(-60),
      odometer: 10_000,
    });
    expect(firstReply.summary).toBe(
      `Mounted winter tires (Musterreifen) on Familienauto, ZH 000000 (${day(-60)}, 10000 km).`,
    );
    const first = firstReply.json;
    expect(first).toMatchObject({
      id: winter.id,
      mounted: true,
      mountedOn: day(-60),
    });
    expect(first.tookOff).toBeUndefined();

    const secondReply = await call("mount_tire_set", {
      vehicle: "Familienauto",
      tireSet: "Beispielgummi",
      date: day(-1),
      odometer: 12_000,
    });
    expect(secondReply.summary).toBe(
      `Mounted summer tires (Beispielgummi) on Familienauto, ZH 000000 (${day(-1)}, 12000 km); took off winter tires (Musterreifen).`,
    );
    const second = secondReply.json;
    expect(second).toMatchObject({
      id: summer.id,
      mounted: true,
      tookOff: "winter tires (Musterreifen)",
    });

    const list = await ok("list_tire_sets", { vehicle: "Familienauto" });
    const byId = Object.fromEntries(
      list.tireSets.map((s: { id: string }) => [s.id, s]),
    );
    expect(byId[summer.id].mounted).toBe(true);
    expect(byId[winter.id].mounted).toBeUndefined();
    expect(byId[winter.id]).toMatchObject({
      distance: 2_000,
      distanceUnit: "km",
    });

    const car = await ok("get_vehicle", { vehicle: "Familienauto" });
    expect(car.odometer).toMatchObject({ value: 12_000, date: day(-1) });
  });

  it("says so when the set is already mounted, and changes nothing", async () => {
    const { call, ok, vehicle, addSet } = await connect();
    await vehicle();
    await addSet();
    await ok("mount_tire_set", { vehicle: "Familienauto", tireSet: "winter" });
    const again = await call("mount_tire_set", {
      vehicle: "Familienauto",
      tireSet: "winter",
      odometer: 5,
    });
    expect(again.isError).toBe(false);
    expect(again.summary).toContain("already runs on winter tires");
    expect(again.summary).toContain("nothing changed");
    expect(
      (await ok("get_vehicle", { vehicle: "Familienauto" })).odometer,
    ).toBeUndefined();
  });

  it("asks for the id when words fit several sets, and takes the id", async () => {
    const { call, ok, vehicle, addSet } = await connect();
    await vehicle();
    const old = await addSet({ brand: "Altgummi" });
    await addSet({ brand: "Neugummi" });
    const reply = await call("mount_tire_set", {
      vehicle: "Familienauto",
      tireSet: "winter",
    });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("ambiguous");
    expect(reply.text).toContain("Altgummi");
    expect(reply.text).toContain("Neugummi");
    expect(reply.text).toContain(old.id);
    const byId = await ok("mount_tire_set", {
      vehicle: "Familienauto",
      tireSet: old.id,
    });
    expect(byId.id).toBe(old.id);
  });

  it("names the sets of the vehicle when none fits, and never takes another vehicle's set", async () => {
    const { call, vehicle, addSet, ok } = await connect();
    await vehicle();
    await vehicle("Roller", "BE 222222");
    await addSet({ season: "summer", brand: "Beispielgummi" });
    const rollers = await ok("add_tire_set", {
      vehicle: "Roller",
      season: "winter",
    });
    const none = await call("mount_tire_set", {
      vehicle: "Familienauto",
      tireSet: "winter",
    });
    expect(none.isError).toBe(true);
    expect(none.text).toContain("Error [not_found]");
    expect(none.text).toContain("summer tires (Beispielgummi)");
    const foreign = await call("mount_tire_set", {
      vehicle: "Familienauto",
      tireSet: rollers.id,
    });
    expect(foreign.isError).toBe(true);
    expect(foreign.text).toContain("Error [not_found]");
  });

  it("does not mount a retired set, and lists it only on request", async () => {
    const { call, ok, vehicle, addSet, server } = await connect();
    await vehicle();
    const set = await addSet({ brand: "Altgummi" });
    await server.context.api.call(endpoints.tireSetsUpdate, {
      params: { id: set.id },
      body: { retired: true },
    });
    const byWords = await call("mount_tire_set", {
      vehicle: "Familienauto",
      tireSet: "winter",
    });
    expect(byWords.isError).toBe(true);
    expect(byWords.text).toContain("Error [not_found]");
    const byId = await call("mount_tire_set", {
      vehicle: "Familienauto",
      tireSet: set.id,
    });
    expect(byId.isError).toBe(true);
    expect(byId.text).toContain("Error [conflict]");
    expect(
      (await ok("list_tire_sets", { vehicle: "Familienauto" })).tireSets,
    ).toEqual([]);
    const all = await ok("list_tire_sets", {
      vehicle: "Familienauto",
      includeRetired: true,
    });
    expect(all.tireSets).toMatchObject([{ id: set.id, retired: true }]);
  });

  it("refuses an odometer lower than the reading before, and mounts nothing", async () => {
    const { call, ok, vehicle, addSet, day } = await connect();
    await vehicle();
    await addSet();
    await ok("record_odometer", {
      vehicle: "Familienauto",
      value: 50_000,
      date: day(-5),
    });
    const reply = await call("mount_tire_set", {
      vehicle: "Familienauto",
      tireSet: "winter",
      odometer: 40_000,
    });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("body.odometer");
    expect(
      (await ok("list_tire_sets", { vehicle: "Familienauto" })).tireSets[0]
        .mounted,
    ).toBeUndefined();
  });

  it("measures the mounted set and warns below the limit of its season", async () => {
    const { call, ok, vehicle, addSet } = await connect();
    await vehicle();
    await addSet({ season: "winter" });
    await ok("mount_tire_set", { vehicle: "Familienauto", tireSet: "winter" });
    const worn = await call("record_tire_tread", {
      vehicle: "Familienauto",
      treadDepthMm: 3.2,
    });
    expect(worn.summary).toContain("Measured 3.2 mm on winter tires");
    expect(worn.summary).toContain("below 4 mm");
    expect(worn.json).toMatchObject({ treadMm: 3.2, treadWarning: true });
    const good = await call("record_tire_tread", {
      vehicle: "Familienauto",
      treadDepthMm: 6,
    });
    expect(good.summary).not.toContain("below");
    expect(good.json.treadMm).toBe(6);
    expect(good.json.treadWarning).toBeUndefined();
  });

  it("measures a set that is not mounted by words or id, with an odometer reading", async () => {
    const { ok, vehicle, addSet, day } = await connect();
    await vehicle();
    const summer = await addSet({ season: "summer" });
    const measured = await ok("record_tire_tread", {
      vehicle: "Familienauto",
      tireSet: "summer",
      treadDepthMm: 2.8,
      date: day(-3),
      odometer: 30_000,
    });
    expect(measured).toMatchObject({
      id: summer.id,
      treadMm: 2.8,
      treadMeasuredOn: day(-3),
      treadWarning: true,
    });
    expect(
      (await ok("get_vehicle", { vehicle: "Familienauto" })).odometer,
    ).toMatchObject({ value: 30_000, date: day(-3) });
    const byId = await ok("record_tire_tread", {
      vehicle: "Familienauto",
      tireSet: summer.id,
      treadDepthMm: 2.5,
    });
    expect(byId.treadMm).toBe(2.5);
  });

  it("asks which set to measure when none is mounted", async () => {
    const { call, vehicle, addSet } = await connect();
    await vehicle();
    await addSet({ brand: "Altgummi" });
    const reply = await call("record_tire_tread", {
      vehicle: "Familienauto",
      treadDepthMm: 5,
    });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("No tire set is mounted");
    expect(reply.text).toContain("winter tires (Altgummi)");
  });

  it.each([
    ["a depth that is too deep", { treadDepthMm: 25 }, "treadDepthMm"],
    ["a negative depth", { treadDepthMm: -1 }, "treadDepthMm"],
    [
      "a date in the future",
      { treadDepthMm: 5, date: "2999-01-01" },
      "body.date",
    ],
  ])("refuses %s", async (_name, over, text) => {
    const { call, ok, vehicle, addSet } = await connect();
    await vehicle();
    await addSet();
    await ok("mount_tire_set", { vehicle: "Familienauto", tireSet: "winter" });
    const reply = await call("record_tire_tread", {
      vehicle: "Familienauto",
      ...over,
    });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain(text);
  });

  it("does not take a device for a vehicle", async () => {
    const { call, ok } = await connect();
    await ok("create_asset", { name: "Backofen" });
    for (const [name, args] of [
      ["list_tire_sets", {}],
      ["add_tire_set", { season: "winter" }],
      ["mount_tire_set", { tireSet: "winter" }],
      ["record_tire_tread", { treadDepthMm: 5 }],
    ] as const) {
      const reply = await call(name, { vehicle: "Backofen", ...args });
      expect(reply.isError).toBe(true);
      expect(reply.text).toContain("not a vehicle");
    }
  });
});
