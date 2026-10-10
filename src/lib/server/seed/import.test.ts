import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ApiError } from "$lib/api/errors";
import { createApiClient, type FetchLike } from "$lib/api/client";
import { endpoints } from "$lib/api/registry";
import { seedSchema, type Seed, type SeedInput } from "$lib/api/schemas/seed";
import { assets, rooms, taskPreparations, tasks } from "$lib/server/db";
import { createInProcessFetch } from "$lib/testing/api";
import { createTestToken, createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { importSeed, SeedError } from "./import";

const exampleJson = (): SeedInput =>
  JSON.parse(
    readFileSync(join(process.cwd(), "seed", "example.de.json"), "utf8"),
  );
const example = (): Seed => seedSchema.parse(exampleJson());
const vehiclesInFile = (seed: Seed) =>
  seed.assets.filter((a) => a.vehicle !== undefined).length;

describe("seed import", () => {
  const test = useTestDB();

  async function client(
    scopes: ("read" | "write" | "admin")[] = ["read", "write"],
  ) {
    const user = await createTestUser({ displayName: "Anna", role: "admin" });
    await createTestUser({ displayName: "Ben" });
    const calls: string[] = [];
    const inner = createInProcessFetch({
      bearer: createTestToken(user, { kind: "integration", scopes }).token,
    });
    const spy: FetchLike = (input, init) => {
      calls.push(`${init?.method ?? "GET"} ${input.split("?")[0]}`);
      return inner(input, init);
    };
    return {
      user,
      api: createApiClient(spy, "http://localhost"),
      writes: () => calls.filter((c) => !c.startsWith("GET ")),
      reset: () => calls.splice(0),
    };
  }
  const rowCounts = () => ({
    rooms: test.db.select().from(rooms).all().length,
    assets: test.db.select().from(assets).all().length,
    tasks: test.db.select().from(tasks).all().length,
    preps: test.db.select().from(taskPreparations).all().length,
  });

  it("validates the example seed file", () => {
    const seed = example();
    expect(seed.rooms.map((r) => r.name)).toEqual([
      "Küche",
      "Bad",
      "Wohnzimmer",
      "Keller",
      "Schlafzimmer",
    ]);
    expect(seed.assets.map((a) => a.name)).toEqual(
      expect.arrayContaining([
        "Waschmaschine",
        "Kühlschrank",
        "Backofen",
        "Monstera",
      ]),
    );
    expect(seed.tasks.map((t) => t.trigger.type)).toEqual(
      expect.arrayContaining(["interval", "calendar", "min_per_period"]),
    );
  });

  it("imports the example through the API", async () => {
    const { api } = await client();
    const seed = example();
    const lines: string[] = [];
    const report = await importSeed(api, seed, { log: (l) => lines.push(l) });
    expect(report).toEqual({
      household: "skipped",
      rooms: { created: 5, updated: 0, unchanged: 0 },
      assets: { created: seed.assets.length, updated: 0, unchanged: 0 },
      vehicles: { created: vehiclesInFile(seed), updated: 0, unchanged: 0 },
      tasks: { created: seed.tasks.length, updated: 0, unchanged: 0 },
      preparations: {
        created: seed.tasks.reduce((n, t) => n + t.preparations.length, 0),
        updated: 0,
        unchanged: 0,
      },
    });
    expect(lines).toContain("room kueche created");
    expect(lines.some((l) => l.startsWith("household skipped"))).toBe(true);
    expect(rowCounts()).toMatchObject({
      rooms: 5,
      assets: seed.assets.length,
      tasks: seed.tasks.length,
    });

    const filter = test.db
      .select()
      .from(tasks)
      .all()
      .find((t) => t.externalRef === "dampfabzug-filter")!;
    expect(filter).toMatchObject({
      source: "seed",
      externalSource: "seed",
      category: "filter",
      priority: "high",
    });
    const { items } = await api.call(
      (await import("$lib/api/registry")).endpoints.tasksList,
      {
        query: { limit: 200 },
      },
    );
    const byRef = new Map(items.map((t) => [t.externalRef, t]));
    expect(byRef.get("dampfabzug-filter")).toMatchObject({
      assetName: "Dampfabzug",
      state: { status: expect.any(String) },
    });
    expect(byRef.get("putzen-bad")).toMatchObject({
      assignMode: "rotate",
      roomName: "Bad",
    });
    expect(byRef.get("putzen-bad")?.rotationOrder).toHaveLength(2);
    expect(byRef.get("putzen-kueche")?.rotationStrategy).toBe("fair");
    expect(items.every((t) => t.state !== null)).toBe(true);
  });

  it("sets the household when the token may", async () => {
    const { api } = await client(["read", "write", "admin"]);
    const first = await importSeed(api, example());
    expect(first.household).toBe("updated");
    expect(await importSeed(api, example())).toMatchObject({
      household: "unchanged",
    });
    const household = await api.call(endpoints.householdGet);
    expect(household).toMatchObject({
      name: "Musterwohnung",
      handoverDate: "2026-01-01",
    });
  });

  it("is idempotent: a second run writes nothing", async () => {
    const { api, writes, reset } = await client(["read", "write", "admin"]);
    const seed = example();
    await importSeed(api, seed);
    const before = rowCounts();
    reset();
    const report = await importSeed(api, seed);
    expect(writes()).toEqual([]);
    expect(report).toEqual({
      household: "unchanged",
      rooms: { created: 0, updated: 0, unchanged: 5 },
      assets: { created: 0, updated: 0, unchanged: seed.assets.length },
      vehicles: { created: 0, updated: 0, unchanged: vehiclesInFile(seed) },
      tasks: { created: 0, updated: 0, unchanged: seed.tasks.length },
      preparations: {
        created: 0,
        updated: 0,
        unchanged: seed.tasks.reduce((n, t) => n + t.preparations.length, 0),
      },
    });
    expect(rowCounts()).toEqual(before);
  });

  it("only adds what is new", async () => {
    const { api } = await client();
    const json = exampleJson();
    await importSeed(api, seedSchema.parse(json));
    json.rooms = [...(json.rooms ?? []), { key: "balkon", name: "Balkon" }];
    json.tasks = [
      ...(json.tasks ?? []),
      {
        key: "balkon-fegen",
        title: "Balkon fegen",
        room: "balkon",
        trigger: { v: 1, type: "one_off", date: "2026-12-01" },
      },
    ];
    const report = await importSeed(api, seedSchema.parse(json));
    expect(report.rooms).toMatchObject({ created: 1, unchanged: 5 });
    expect(report.tasks).toMatchObject({ created: 1 });
    expect(rowCounts().tasks).toBe((json.tasks ?? []).length);
  });

  it("leaves edited entries alone unless asked to update", async () => {
    const { api } = await client();
    const json = exampleJson();
    await importSeed(api, seedSchema.parse(json));
    json.tasks = (json.tasks ?? []).map((t) =>
      t.key === "backofen-reinigen"
        ? { ...t, title: "Backofen gründlich reinigen" }
        : t,
    );
    json.rooms = (json.rooms ?? []).map((r) =>
      r.key === "bad" ? { ...r, name: "Badezimmer" } : r,
    );
    const skipped = await importSeed(api, seedSchema.parse(json));
    expect(skipped.tasks.updated).toBe(0);
    expect(
      test.db
        .select()
        .from(tasks)
        .all()
        .some((t) => t.title === "Backofen reinigen"),
    ).toBe(true);

    const updated = await importSeed(api, seedSchema.parse(json), {
      update: true,
    });
    expect(updated.rooms).toMatchObject({ updated: 1, unchanged: 4 });
    expect(updated.tasks.updated).toBe((json.tasks ?? []).length);
    expect(
      test.db
        .select()
        .from(tasks)
        .all()
        .some((t) => t.title === "Backofen gründlich reinigen"),
    ).toBe(true);
    expect(
      test.db
        .select()
        .from(rooms)
        .all()
        .map((r) => r.name),
    ).toContain("Badezimmer");
    expect(rowCounts().tasks).toBe((json.tasks ?? []).length);
  });

  it("finds tasks by key even after they were archived", async () => {
    const { api } = await client();
    const seed = example();
    await importSeed(api, seed);
    test.db.update(tasks).set({ archivedAt: new Date() }).run();
    const report = await importSeed(api, seed);
    expect(report.tasks).toMatchObject({
      created: 0,
      unchanged: seed.tasks.length,
    });
  });

  it("resolves people by display name and refuses unknown ones", async () => {
    const { api, user } = await client();
    const json = exampleJson();
    json.tasks = [
      {
        key: "fest",
        title: "Fest zugewiesen",
        trigger: { v: 1, type: "one_off", date: "2026-12-01" },
        assign: { mode: "fixed", user: "ben" },
      },
    ];
    await importSeed(api, seedSchema.parse(json));
    const row = test.db
      .select()
      .from(tasks)
      .all()
      .find((t) => t.externalRef === "fest");
    expect(row?.assignMode).toBe("fixed");
    expect(row?.assigneeUserId).not.toBe(user.id);
    expect(row?.assigneeUserId).toBeTruthy();

    json.tasks = [
      {
        key: "fremd",
        title: "Unbekannt",
        trigger: { v: 1, type: "one_off", date: "2026-12-01" },
        assign: { mode: "fixed", user: "Niemand" },
      },
    ];
    await expect(importSeed(api, seedSchema.parse(json))).rejects.toThrow(
      SeedError,
    );
    await expect(importSeed(api, seedSchema.parse(json))).rejects.toThrow(
      'No user named "Niemand"',
    );
  });

  it("surfaces API errors, e.g. a token without write access", async () => {
    const { api } = await client(["read"]);
    await expect(importSeed(api, example())).rejects.toBeInstanceOf(ApiError);
    await expect(importSeed(api, example())).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(rowCounts()).toEqual({ rooms: 0, assets: 0, tasks: 0, preps: 0 });
  });

  it("imports plants and fixtures with their fields", async () => {
    const { api } = await client();
    await importSeed(api, example());
    const monstera = test.db
      .select()
      .from(assets)
      .all()
      .find((a) => a.slug === "monstera");
    expect(monstera).toMatchObject({
      kind: "plant",
      species: "Monstera deliciosa",
    });
    expect(monstera?.roomId).toBeTruthy();
    expect(monstera?.qrSlug).toMatch(/^[a-z2-7]{10}$/);
  });

  describe("vehicles", () => {
    const detailsOf = async (
      api: Awaited<ReturnType<typeof client>>["api"],
    ) => {
      const car = test.db
        .select()
        .from(assets)
        .all()
        .find((a) => a.slug === "familienauto")!;
      return {
        car,
        details: await api.call(endpoints.vehiclesGet, {
          params: { id: car.id },
        }),
      };
    };
    const withVehicle = (over: Record<string, unknown>): SeedInput => {
      const json = exampleJson();
      json.assets = (json.assets ?? []).map((a) =>
        a.key === "familienauto"
          ? { ...a, vehicle: { ...a.vehicle, ...over } }
          : a,
      );
      return json;
    };

    it("saves the details of the example vehicle with the asset", async () => {
      const { api } = await client();
      const report = await importSeed(api, example());
      expect(report.vehicles).toEqual({ created: 1, updated: 0, unchanged: 0 });
      const { car, details } = await detailsOf(api);
      expect(car).toMatchObject({ kind: "vehicle", name: "Familienauto" });
      expect(car.roomId).toBeNull();
      expect(details).toMatchObject({
        plate: "ZH 000000",
        firstRegistration: "2022-03-10",
        fuelType: "plugin_hybrid",
        tireSizeWinter: "205/55 R16 91H",
        location: "Tiefgarage, Platz 0",
        odometerUnit: "km",
      });
    });

    it("leaves saved details alone unless asked to update", async () => {
      const { api, writes, reset } = await client();
      await importSeed(api, example());
      reset();
      const changed = seedSchema.parse(withVehicle({ plate: "ZH 111111" }));
      const skipped = await importSeed(api, changed);
      expect(skipped.vehicles).toEqual({
        created: 0,
        updated: 0,
        unchanged: 1,
      });
      expect(writes().filter((w) => w.includes("/vehicle"))).toEqual([]);
      expect((await detailsOf(api)).details.plate).toBe("ZH 000000");

      const updated = await importSeed(api, changed, { update: true });
      expect(updated.vehicles).toEqual({
        created: 0,
        updated: 1,
        unchanged: 0,
      });
      expect((await detailsOf(api)).details.plate).toBe("ZH 111111");

      reset();
      const again = await importSeed(api, changed, { update: true });
      expect(again.vehicles).toEqual({ created: 0, updated: 0, unchanged: 1 });
      expect(writes().filter((w) => w.includes("/vehicle"))).toEqual([]);
    });

    it("saves details that a run which stopped half way left out", async () => {
      const { api } = await client();
      await importSeed(
        api,
        seedSchema.parse({
          version: 1,
          assets: [
            { key: "familienauto", kind: "vehicle", name: "Familienauto" },
          ],
        }),
      );
      expect((await detailsOf(api)).details.updatedAt).toBeNull();
      const report = await importSeed(api, example());
      expect(report.assets.unchanged).toBeGreaterThanOrEqual(1);
      expect(report.vehicles).toEqual({ created: 1, updated: 0, unchanged: 0 });
      expect((await detailsOf(api)).details.plate).toBe("ZH 000000");
    });

    it("clears what the file leaves out when updating (PUT replaces)", async () => {
      const { api } = await client();
      await importSeed(api, example());
      const json = exampleJson();
      json.assets = (json.assets ?? []).map((a) =>
        a.key === "familienauto"
          ? { ...a, vehicle: { plate: "BE 222222" } }
          : a,
      );
      await importSeed(api, seedSchema.parse(json), { update: true });
      expect((await detailsOf(api)).details).toMatchObject({
        plate: "BE 222222",
        vin: null,
        fuelType: null,
        odometerUnit: "km",
      });
    });

    it("rejects details on an asset that is no vehicle, and unknown fields", () => {
      const json = exampleJson();
      json.assets = (json.assets ?? []).map((a) =>
        a.key === "backofen" ? { ...a, vehicle: { plate: "ZH 1" } } : a,
      );
      const result = seedSchema.safeParse(json);
      expect(result.success).toBe(false);
      expect(
        result.error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      ).toEqual([
        expect.stringMatching(
          /^assets\.\d+\.vehicle: Only an asset of kind "vehicle"/,
        ),
      ]);
      expect(seedSchema.safeParse(withVehicle({ colour: "red" })).success).toBe(
        false,
      );
    });
  });
});

describe("seedSchema", () => {
  const base = (): SeedInput => ({
    version: 1,
    rooms: [{ key: "bad", name: "Bad" }],
    assets: [{ key: "boiler", name: "Boiler", room: "bad" }],
    tasks: [
      {
        key: "entkalken",
        title: "Boiler entkalken",
        asset: "boiler",
        trigger: { v: 1, type: "one_off", date: "2026-12-01" },
      },
    ],
  });
  const issues = (input: unknown) => {
    const r = seedSchema.safeParse(input);
    return r.success
      ? []
      : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  };

  it("accepts a minimal valid file and fills defaults", () => {
    const seed = seedSchema.parse(base());
    expect(seed.tasks[0]).toMatchObject({
      category: "other",
      priority: "normal",
      assign: { mode: "none" },
      notifyMode: "assignee",
      graceDays: 0,
      preparations: [],
    });
    expect(seedSchema.parse({ version: 1 })).toMatchObject({
      rooms: [],
      assets: [],
      tasks: [],
    });
  });

  it("rejects what cannot be imported", () => {
    const dupes = base();
    dupes.rooms = [
      ...(dupes.rooms ?? []),
      { key: "bad", name: "Noch ein Bad" },
    ];
    expect(issues(dupes)).toEqual(['rooms.1.key: Duplicate key "bad"']);

    const badRoom = base();
    (badRoom.assets ?? [])[0].room = "keller";
    expect(issues(badRoom)).toEqual(['assets.0.room: Unknown room "keller"']);

    const badAsset = base();
    (badAsset.tasks ?? [])[0].asset = "ofen";
    expect(issues(badAsset)).toEqual(['tasks.0.asset: Unknown asset "ofen"']);

    expect(issues({ ...base(), version: 2 })).not.toEqual([]);
    expect(issues({ ...base(), extra: true })).not.toEqual([]);
    expect(
      issues({ ...base(), rooms: [{ key: "Bad Raum", name: "x" }] }),
    ).not.toEqual([]);
    const badTrigger = base();
    (badTrigger.tasks ?? [])[0].trigger = { v: 1, type: "interval" } as never;
    expect(
      issues(badTrigger).some((i) => i.startsWith("tasks.0.trigger")),
    ).toBe(true);
    const badAssign = base();
    (badAssign.tasks ?? [])[0].assign = { mode: "rotate", users: [] } as never;
    expect(issues(badAssign)).not.toEqual([]);
  });
});
