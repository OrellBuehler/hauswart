import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { createTireSetRequestSchema } from "$lib/api/schemas/tire-sets";
import {
  vehicleSchema,
  putVehicleRequestSchema,
} from "$lib/api/schemas/vehicles";
import {
  createAsset,
  deleteAsset,
  getAsset,
  listAssets,
  updateAsset,
} from "$lib/server/assets/assets";
import { vehicleDetails } from "$lib/server/db";
import { search } from "$lib/server/search/search";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, NOW } from "$lib/testing/domain";
import { failure, fieldErrors, makeVehicle } from "$lib/testing/vehicles";
import { deleteOdometerReading, recordOdometer } from "./odometer";
import { createTireSet } from "./tires";
import { getVehicle, putVehicle } from "./vehicles";

describe("vehicle details", () => {
  const test = useTestDB();
  const ctx = (now = NOW) => ctxAt(test.db, now);
  const put = (assetId: string, body: Record<string, unknown>) =>
    putVehicle(ctx(), assetId, putVehicleRequestSchema.parse(body));

  it("a vehicle that was never saved answers with empty details in kilometres", () => {
    const car = makeVehicle(test);
    expect(getVehicle(ctx(), car.id)).toEqual({
      assetId: car.id,
      plate: null,
      vin: null,
      registrationNumber: null,
      firstRegistration: null,
      fuelType: null,
      tireSizeSummer: null,
      tireSizeWinter: null,
      location: null,
      odometerUnit: "km",
      notes: null,
      odometer: null,
      updatedAt: null,
    });
    expect(test.db.select().from(vehicleDetails).all()).toEqual([]);
  });

  it("saves and reads every detail", () => {
    const car = makeVehicle(test);
    const saved = put(car.id, {
      plate: "ZH 000000",
      vin: "XXXEXAMPLE0000000",
      registrationNumber: "000.000.000",
      firstRegistration: "2022-03-10",
      fuelType: "plugin_hybrid",
      tireSizeSummer: "205/55 R16 91V",
      tireSizeWinter: "205/55 R16 91H",
      location: "Tiefgarage, Platz 12",
      odometerUnit: "km",
      notes: "Schlüssel im Schrank.",
    });
    expect(saved).toMatchObject({
      assetId: car.id,
      plate: "ZH 000000",
      vin: "XXXEXAMPLE0000000",
      registrationNumber: "000.000.000",
      firstRegistration: "2022-03-10",
      fuelType: "plugin_hybrid",
      tireSizeSummer: "205/55 R16 91V",
      tireSizeWinter: "205/55 R16 91H",
      location: "Tiefgarage, Platz 12",
      odometerUnit: "km",
      notes: "Schlüssel im Schrank.",
    });
    expect(saved.updatedAt).toBeInstanceOf(Date);
    expect(getVehicle(ctx(), car.id)).toEqual(saved);
  });

  it("answers in the shape of its schema", () => {
    const car = makeVehicle(test);
    const { updatedAt, ...rest } = put(car.id, { plate: "ZH 000000" });
    expect(
      vehicleSchema.safeParse({
        ...rest,
        updatedAt: updatedAt?.toISOString() ?? null,
      }).success,
    ).toBe(true);
  });

  it("replaces the details: what is left out is cleared", () => {
    const car = makeVehicle(test);
    put(car.id, {
      plate: "ZH 000000",
      location: "Garage",
      fuelType: "diesel",
      odometerUnit: "mi",
    });
    const second = put(car.id, { vin: "XXXEXAMPLE0000000" });
    expect(second).toMatchObject({
      plate: null,
      location: null,
      fuelType: null,
      odometerUnit: "km",
      vin: "XXXEXAMPLE0000000",
    });
    expect(test.db.select().from(vehicleDetails).all()).toHaveLength(1);
  });

  it("empty text and blanks clear a field", () => {
    const car = makeVehicle(test);
    const saved = put(car.id, { plate: "  ", location: "" });
    expect(saved.plate).toBeNull();
    expect(saved.location).toBeNull();
  });

  it("shows the newest odometer reading in the unit of the vehicle", async () => {
    const car = makeVehicle(test);
    await recordOdometer(ctx(), {
      assetId: car.id,
      date: "2026-06-10",
      value: 82_300,
      source: "manual",
    });
    await recordOdometer(ctx(), {
      assetId: car.id,
      date: "2026-05-01",
      value: 80_000,
      source: "manual",
    });
    expect(getVehicle(ctx(), car.id).odometer).toEqual({
      value: 82_300,
      date: "2026-06-10",
      unit: "km",
    });
    // The unit relabels the readings, it does not convert them.
    expect(put(car.id, { odometerUnit: "mi" }).odometer).toEqual({
      value: 82_300,
      date: "2026-06-10",
      unit: "mi",
    });
  });

  it("only an asset of kind vehicle has details", async () => {
    const device = createAsset(
      ctx(),
      createAssetRequestSchema.parse({ name: "Waschmaschine" }),
    );
    const put400 = await failure(() => put(device.id, { plate: "ZH 1" }));
    expect(put400.code).toBe("invalid_request");
    expect(put400.status).toBe(400);
    const get404 = await failure(() => getVehicle(ctx(), device.id));
    expect(get404.code).toBe("not_found");
    expect(test.db.select().from(vehicleDetails).all()).toEqual([]);
  });

  it("a missing asset is a 404 for both", async () => {
    expect((await failure(() => getVehicle(ctx(), "nope"))).code).toBe(
      "not_found",
    );
    expect((await failure(() => put("nope", {}))).code).toBe("not_found");
  });

  it("goes away with the vehicle", () => {
    const car = makeVehicle(test);
    put(car.id, { plate: "ZH 000000" });
    deleteAsset(ctx(), car.id);
    expect(test.db.select().from(vehicleDetails).all()).toEqual([]);
  });
});

describe("vehicles among the assets", () => {
  const test = useTestDB();
  const ctx = (now = NOW) => ctxAt(test.db, now);

  it("lists can be filtered by kind vehicle", () => {
    makeVehicle(test, "Auto");
    makeVehicle(test, "Roller");
    createAsset(ctx(), createAssetRequestSchema.parse({ name: "Backofen" }));
    createAsset(
      ctx(),
      createAssetRequestSchema.parse({ name: "Monstera", kind: "plant" }),
    );
    const page = listAssets(ctx(), { kind: "vehicle" }, { limit: 50 });
    expect(page.items.map((a) => a.name)).toEqual(["Auto", "Roller"]);
    expect(
      listAssets(ctx(), { kind: "device" }, { limit: 50 }).items.map(
        (a) => a.name,
      ),
    ).toEqual(["Backofen"]);
  });

  it("carries the plate and the newest reading, for vehicles only", async () => {
    const car = makeVehicle(test, "Auto");
    const device = createAsset(
      ctx(),
      createAssetRequestSchema.parse({ name: "Backofen" }),
    );
    expect(getAsset(ctx(), car.id).vehicle).toEqual({
      plate: null,
      odometer: null,
    });
    putVehicle(
      ctx(),
      car.id,
      putVehicleRequestSchema.parse({ plate: "ZH 000000" }),
    );
    await recordOdometer(ctx(), {
      assetId: car.id,
      date: "2026-06-10",
      value: 82_300,
      source: "manual",
    });
    const summary = {
      plate: "ZH 000000",
      odometer: { value: 82_300, date: "2026-06-10", unit: "km" },
    };
    expect(getAsset(ctx(), car.id).vehicle).toEqual(summary);
    expect(
      listAssets(ctx(), {}, { limit: 50 }).items.find((a) => a.id === car.id)
        ?.vehicle,
    ).toEqual(summary);
    expect(getAsset(ctx(), device.id).vehicle).toBeUndefined();
    expect(
      listAssets(ctx(), {}, { limit: 50 }).items.find((a) => a.id === device.id)
        ?.vehicle,
    ).toBeUndefined();
  });

  it("the summary is added to the vehicles of the page only", () => {
    for (let i = 1; i <= 3; i += 1) makeVehicle(test, `Auto ${i}`);
    const first = listAssets(ctx(), { kind: "vehicle" }, { limit: 2 });
    expect(first.items.every((a) => a.vehicle !== undefined)).toBe(true);
    const second = listAssets(
      ctx(),
      { kind: "vehicle" },
      { limit: 2, cursor: first.nextCursor! },
    );
    expect(second.items.map((a) => a.name)).toEqual(["Auto 3"]);
    expect(second.items[0].vehicle).toBeDefined();
  });

  it("is found by its plate, written with or without spaces", () => {
    const car = makeVehicle(test, "Auto");
    makeVehicle(test, "Roller");
    putVehicle(
      ctx(),
      car.id,
      putVehicleRequestSchema.parse({ plate: "ZH 000000" }),
    );
    const find = (q: string) =>
      listAssets(ctx(), { q }, { limit: 50 }).items.map((a) => a.name);
    expect(find("zh 000000")).toEqual(["Auto"]);
    expect(find("ZH000000")).toEqual(["Auto"]);
    expect(find("0000")).toEqual(["Auto"]);
    expect(find("zh 0000 ")).toEqual(["Auto"]);
    expect(find("BE 1")).toEqual([]);
  });
});

describe("the kind of a vehicle", () => {
  const test = useTestDB();
  const ctx = (now = NOW) => ctxAt(test.db, now);
  const save = (assetId: string, body: Record<string, unknown>) =>
    putVehicle(ctx(), assetId, putVehicleRequestSchema.parse(body));
  const kindOf = (id: string) => getAsset(ctx(), id).kind;

  it("cannot change while the vehicle has saved details", async () => {
    const car = makeVehicle(test, "Auto");
    save(car.id, { plate: "ZH 000000" });
    const err = await failure(() =>
      updateAsset(ctx(), car.id, { kind: "other" }),
    );
    expect(err.code).toBe("invalid_request");
    expect(err.status).toBe(400);
    expect(fieldErrors(err, "kind")).toEqual([
      expect.stringMatching(/details/),
    ]);
    expect(kindOf(car.id)).toBe("vehicle");
    expect(getAsset(ctx(), car.id).vehicle).toEqual({
      plate: "ZH 000000",
      odometer: null,
    });
    expect(test.db.select().from(vehicleDetails).all()).toHaveLength(1);
  });

  it("cannot change while the vehicle has odometer readings", async () => {
    const car = makeVehicle(test, "Auto");
    await recordOdometer(ctx(), {
      assetId: car.id,
      date: "2026-06-10",
      value: 82_300,
      source: "manual",
    });
    const err = await failure(() =>
      updateAsset(ctx(), car.id, { kind: "device" }),
    );
    expect(err.code).toBe("invalid_request");
    expect(fieldErrors(err, "kind")).toEqual([
      expect.stringMatching(/odometer readings/),
    ]);
    expect(kindOf(car.id)).toBe("vehicle");
  });

  it("cannot change while the vehicle has tire sets", async () => {
    const car = makeVehicle(test, "Auto");
    createTireSet(
      ctx(),
      car.id,
      createTireSetRequestSchema.parse({ season: "winter" }),
    );
    const err = await failure(() =>
      updateAsset(ctx(), car.id, { kind: "device" }),
    );
    expect(fieldErrors(err, "kind")).toEqual([
      expect.stringMatching(/tire sets/),
    ]);
    expect(kindOf(car.id)).toBe("vehicle");
  });

  it("names everything that stands in the way", async () => {
    const car = makeVehicle(test, "Auto");
    save(car.id, { plate: "ZH 000000" });
    await recordOdometer(ctx(), {
      assetId: car.id,
      date: "2026-06-10",
      value: 82_300,
      source: "manual",
    });
    const err = await failure(() =>
      updateAsset(ctx(), car.id, { kind: "device" }),
    );
    const [message] = fieldErrors(err, "kind");
    expect(message).toMatch(/details/);
    expect(message).toMatch(/odometer readings/);
  });

  it("changes once the readings are deleted and the details cleared", async () => {
    const car = makeVehicle(test, "Auto");
    save(car.id, { plate: "ZH 000000" });
    const reading = await recordOdometer(ctx(), {
      assetId: car.id,
      date: "2026-06-10",
      value: 82_300,
      source: "manual",
    });
    await deleteOdometerReading(ctx(), reading.id);
    expect(
      (await failure(() => updateAsset(ctx(), car.id, { kind: "device" })))
        .code,
    ).toBe("invalid_request");
    save(car.id, {});
    expect(updateAsset(ctx(), car.id, { kind: "device" }).kind).toBe("device");
    expect(getAsset(ctx(), car.id).vehicle).toBeUndefined();
    expect(test.db.select().from(vehicleDetails).all()).toEqual([]);
  });

  it("changes freely for a vehicle without any data, and back", () => {
    const car = makeVehicle(test, "Auto");
    expect(updateAsset(ctx(), car.id, { kind: "other" }).kind).toBe("other");
    expect(updateAsset(ctx(), car.id, { kind: "vehicle" }).kind).toBe(
      "vehicle",
    );
  });

  it("keeps a vehicle's kind when the request repeats it, and edits the rest", () => {
    const car = makeVehicle(test, "Auto");
    save(car.id, { plate: "ZH 000000" });
    const updated = updateAsset(ctx(), car.id, {
      kind: "vehicle",
      name: "Zweitwagen",
    });
    expect(updated).toMatchObject({ kind: "vehicle", name: "Zweitwagen" });
    expect(updated.vehicle?.plate).toBe("ZH 000000");
  });

  it("leaves other kinds alone", () => {
    const device = createAsset(
      ctx(),
      createAssetRequestSchema.parse({ name: "Backofen" }),
    );
    expect(updateAsset(ctx(), device.id, { kind: "plant" }).kind).toBe("plant");
  });
});

describe("searching for a plate", () => {
  const test = useTestDB();
  const ctx = (now = NOW) => ctxAt(test.db, now);
  const find = (q: string) =>
    search(ctx(), { q, limit: 20 }).map((hit) => [
      hit.type,
      hit.title,
      hit.url,
    ]);
  const save = (assetId: string, body: Record<string, unknown>) =>
    putVehicle(ctx(), assetId, putVehicleRequestSchema.parse(body));

  it("finds the vehicle by its plate, with or without space, and links to the asset", () => {
    const car = makeVehicle(test, "Familienauto");
    save(car.id, { plate: "ZH 000000" });
    const hit = [["asset", "Familienauto", `/assets/${car.id}`]];
    expect(find("ZH 000000")).toEqual(hit);
    expect(find("zh000000")).toEqual(hit);
    expect(find("000000")).toEqual(hit);
    expect(find("zh")).toEqual(hit);
    expect(find("ZH 111111")).toEqual([]);
  });

  it("follows the plate when it changes or is removed", () => {
    const car = makeVehicle(test, "Familienauto");
    save(car.id, { plate: "ZH 000000" });
    save(car.id, { plate: "BE 111111" });
    expect(find("ZH 000000")).toEqual([]);
    expect(find("BE 111111")).toHaveLength(1);
    save(car.id, {});
    expect(find("BE 111111")).toEqual([]);
    expect(find("Familienauto")).toHaveLength(1);
  });

  it("keeps the plate when the asset itself is edited", () => {
    const car = makeVehicle(test, "Familienauto");
    save(car.id, { plate: "ZH 000000" });
    updateAsset(ctx(), car.id, { name: "Zweitwagen", manufacturer: "Muster" });
    expect(find("ZH 000000").map((h) => h[1])).toEqual(["Zweitwagen"]);
    expect(find("Muster")).toHaveLength(1);
  });

  it("leaves an archived vehicle out and brings it back with the plate", () => {
    const car = makeVehicle(test, "Familienauto");
    save(car.id, { plate: "ZH 000000" });
    updateAsset(ctx(), car.id, { archived: true });
    expect(find("ZH 000000")).toEqual([]);
    updateAsset(ctx(), car.id, { archived: false });
    expect(find("ZH 000000")).toHaveLength(1);
  });

  it("an archived vehicle does not turn up when its plate is saved", () => {
    const car = makeVehicle(test, "Familienauto");
    updateAsset(ctx(), car.id, { archived: true });
    save(car.id, { plate: "ZH 000000" });
    expect(find("ZH 000000")).toEqual([]);
  });

  it("forgets the vehicle when it is deleted", () => {
    const car = makeVehicle(test, "Familienauto");
    save(car.id, { plate: "ZH 000000" });
    deleteAsset(ctx(), car.id);
    expect(find("ZH 000000")).toEqual([]);
    expect(find("Familienauto")).toEqual([]);
  });

  it("indexes the plate and nothing else of the details", () => {
    const car = makeVehicle(test, "Familienauto");
    save(car.id, {
      plate: "ZH 000000",
      vin: "XXXEXAMPLE0000000",
      registrationNumber: "999.888.777",
      location: "Tiefgarage",
      notes: "Ersatzschlüssel bei Anna",
      tireSizeWinter: "205/55 R16",
    });
    expect(find("XXXEXAMPLE0000000")).toEqual([]);
    expect(find("999.888.777")).toEqual([]);
    expect(find("Tiefgarage")).toEqual([]);
    expect(find("Ersatzschlüssel")).toEqual([]);
    expect(find("205/55")).toEqual([]);
  });

  it("finds no plate for devices", () => {
    createAsset(ctx(), createAssetRequestSchema.parse({ name: "Backofen" }));
    expect(find("ZH 000000")).toEqual([]);
    expect(
      test.db
        .select()
        .from(vehicleDetails)
        .where(eq(vehicleDetails.plate, "ZH 000000"))
        .all(),
    ).toEqual([]);
  });
});
