import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import {
  createTireSetRequestSchema,
  measureTreadRequestSchema,
  mountTireSetRequestSchema,
  updateTireSetRequestSchema,
} from "$lib/api/schemas/tire-sets";
import { createAsset, deleteAsset } from "$lib/server/assets/assets";
import { createAttachment } from "$lib/server/attachments/attachments";
import { createContact } from "$lib/server/contacts/contacts";
import { createContactRequestSchema } from "$lib/api/schemas/contacts";
import {
  attachments,
  odometerReadings,
  tireSetEvents,
  tireSets,
} from "$lib/server/db";
import { getSignal } from "$lib/server/signals/service";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt, NOW } from "$lib/testing/domain";
import { samplePdf, useTestFilesDir } from "$lib/testing/files";
import { failure, fieldErrors, makeVehicle } from "$lib/testing/vehicles";
import { odometerSignalKey } from "$lib/vehicles/odometer";
import { listReadings, recordOdometer } from "./odometer";
import {
  createTireSet,
  deleteTireSet,
  getTireSet,
  listTireSets,
  measureTread,
  mountTireSet,
  mountedTireSet,
  updateTireSet,
} from "./tires";

describe("tire sets", () => {
  const test = useTestDB();
  useTestFilesDir();
  const ctx = (now = NOW) => ctxAt(test.db, now);
  const make = (assetId: string, over: Record<string, unknown> = {}) =>
    createTireSet(
      ctx(),
      assetId,
      createTireSetRequestSchema.parse({ season: "winter", ...over }),
    );
  const mount = (
    assetId: string,
    setId: string,
    body: Record<string, unknown> = {},
    now = NOW,
  ) =>
    mountTireSet(
      ctx(now),
      assetId,
      setId,
      mountTireSetRequestSchema.parse(body),
      null,
    );
  const reading = (assetId: string, date: string, value: number) =>
    recordOdometer(ctx(), { assetId, date, value, source: "manual" });
  const readings = (assetId: string) =>
    listReadings(ctx(), assetId, { limit: 100 }).items.map(
      (r) => `${r.date} ${r.value} ${r.source}`,
    );

  describe("creating", () => {
    it("a set starts unmounted, with what was given", () => {
      const car = makeVehicle(test);
      const set = make(car.id, {
        season: "summer",
        brand: "Musterreifen",
        model: "Sommer 1",
        size: "205/55 R16 91V",
        dot: "2423",
        storageLocation: "Keller",
        purchasedOn: "2024-04-01",
        notes: "Alufelgen",
      });
      expect(set).toMatchObject({
        assetId: car.id,
        season: "summer",
        brand: "Musterreifen",
        size: "205/55 R16 91V",
        dot: "2423",
        storageLocation: "Keller",
        purchasedOn: "2024-04-01",
        mounted: false,
        mountedOn: null,
        retiredAt: null,
        treadDepthMm: null,
        treadMeasuredOn: null,
        distance: 0,
        odometerUnit: "km",
        events: [],
      });
    });

    it("a first tread measurement is stored as the first event", () => {
      const car = makeVehicle(test);
      const set = make(car.id, { treadDepthMm: 7.5 });
      expect(set.treadDepthMm).toBe(7.5);
      expect(set.treadMeasuredOn).toBe("2026-06-15");
      expect(set.events).toMatchObject([
        { kind: "tread_measured", date: "2026-06-15", treadDepthMm: 7.5 },
      ]);
      const earlier = make(car.id, {
        treadDepthMm: 6,
        treadMeasuredOn: "2026-05-01",
      });
      expect(earlier.treadMeasuredOn).toBe("2026-05-01");
    });

    it.each([
      [
        "a date without a depth",
        { treadMeasuredOn: "2026-05-01" },
        "treadDepthMm",
      ],
      [
        "a measurement in the future",
        { treadDepthMm: 6, treadMeasuredOn: "2026-12-01" },
        "date",
      ],
      [
        "a contact that does not exist",
        { storageContactId: "nope" },
        "storageContactId",
      ],
    ])("refuses %s", async (_name, over, field) => {
      const car = makeVehicle(test);
      const err = await failure(() => make(car.id, over));
      expect(err.code).toBe("invalid_request");
      expect(fieldErrors(err, field)).not.toEqual([]);
      expect(test.db.select().from(tireSets).all()).toEqual([]);
    });

    it("remembers the contact that stores it", () => {
      const car = makeVehicle(test);
      const hotel = createContact(
        ctx(),
        createContactRequestSchema.parse({ name: "Reifenhotel Muster" }),
      );
      const set = make(car.id, { storageContactId: hotel.id });
      expect(set).toMatchObject({
        storageContactId: hotel.id,
        storageContactName: "Reifenhotel Muster",
      });
    });

    it("only vehicles have tire sets; a missing asset is a 404", async () => {
      const device = createAsset(
        ctx(),
        createAssetRequestSchema.parse({ name: "Backofen" }),
      );
      expect((await failure(() => make(device.id))).code).toBe(
        "invalid_request",
      );
      expect((await failure(() => make("nope"))).code).toBe("not_found");
    });
  });

  describe("mounting", () => {
    it("mounts a set and writes the event", () => {
      const car = makeVehicle(test);
      const set = make(car.id);
      const mounted = mount(car.id, set.id, { date: "2026-06-10" });
      expect(mounted).toMatchObject({ mounted: true, mountedOn: "2026-06-10" });
      expect(mounted.events).toMatchObject([
        { kind: "mounted", date: "2026-06-10", odometer: null },
      ]);
      expect(mountedTireSet(ctx(), car.id)?.id).toBe(set.id);
    });

    it("takes the mounted set off, on the same day and at the same odometer", async () => {
      const car = makeVehicle(test);
      await reading(car.id, "2026-05-01", 80_000);
      const summer = make(car.id, { season: "summer" });
      const winter = make(car.id, { season: "winter" });
      mount(car.id, summer.id, { date: "2026-05-02" });
      mount(car.id, winter.id, { date: "2026-06-10", odometer: 85_000 });

      const after = getTireSet(ctx(), summer.id);
      expect(after.mounted).toBe(false);
      expect(after.mountedOn).toBeNull();
      expect(after.events.map((e) => [e.kind, e.date, e.odometer])).toEqual([
        ["mounted", "2026-05-02", null],
        ["unmounted", "2026-06-10", 85_000],
      ]);
      expect(getTireSet(ctx(), winter.id).mounted).toBe(true);
      expect(
        test.db
          .select()
          .from(tireSets)
          .all()
          .filter((s) => s.mounted),
      ).toHaveLength(1);
    });

    it("an odometer value is a reading of the vehicle, from the mount event", async () => {
      const car = makeVehicle(test);
      const set = make(car.id);
      const mounted = mount(car.id, set.id, {
        date: "2026-06-10",
        odometer: 91_000,
      });
      const event = mounted.events[0];
      const row = test.db.select().from(odometerReadings).all()[0];
      expect(row).toMatchObject({
        assetId: car.id,
        date: "2026-06-10",
        value: 91_000,
        source: "tire_change",
        sourceId: event.id,
      });
      expect(getSignal(ctx(), odometerSignalKey(car.id))?.numeric).toBe(91_000);
    });

    it("a value lower than the reading before changes nothing at all", async () => {
      const car = makeVehicle(test);
      await reading(car.id, "2026-05-01", 90_000);
      const first = make(car.id, { season: "summer" });
      const second = make(car.id);
      mount(car.id, first.id, { date: "2026-05-02" });
      const err = await failure(() =>
        mount(car.id, second.id, { date: "2026-06-10", odometer: 80_000 }),
      );
      expect(err.code).toBe("invalid_request");
      expect(fieldErrors(err, "odometer")).not.toEqual([]);
      expect(getTireSet(ctx(), first.id).mounted).toBe(true);
      expect(getTireSet(ctx(), first.id).events).toHaveLength(1);
      expect(getTireSet(ctx(), second.id).mounted).toBe(false);
      expect(getTireSet(ctx(), second.id).events).toEqual([]);
      expect(readings(car.id)).toEqual(["2026-05-01 90000 manual"]);
    });

    it.each([
      ["a date in the future", { date: "2026-12-01" }, "invalid_request"],
      ["a set that is mounted already", { again: true }, "conflict"],
    ])("refuses %s", async (_name, body, code) => {
      const car = makeVehicle(test);
      const set = make(car.id);
      if ("again" in body) mount(car.id, set.id);
      const err = await failure(() =>
        mount(car.id, set.id, "date" in body ? { date: body.date } : {}),
      );
      expect(err.code).toBe(code);
    });

    it("refuses a retired set and a set of another vehicle", async () => {
      const car = makeVehicle(test, "Auto A");
      const other = makeVehicle(test, "Auto B");
      const set = make(car.id);
      updateTireSet(
        ctx(),
        set.id,
        updateTireSetRequestSchema.parse({ retired: true }),
      );
      expect((await failure(() => mount(car.id, set.id))).code).toBe(
        "conflict",
      );
      const fresh = make(car.id);
      expect((await failure(() => mount(other.id, fresh.id))).code).toBe(
        "not_found",
      );
      expect((await failure(() => mount(car.id, "nope"))).code).toBe(
        "not_found",
      );
    });

    it("cannot have two sets mounted, whatever the code does", () => {
      const car = makeVehicle(test);
      const a = make(car.id);
      const b = make(car.id, { season: "summer" });
      test.db
        .update(tireSets)
        .set({ mounted: true })
        .where(eq(tireSets.id, a.id))
        .run();
      expect(() =>
        test.db
          .update(tireSets)
          .set({ mounted: true })
          .where(eq(tireSets.id, b.id))
          .run(),
      ).toThrow(/UNIQUE/i);
    });

    it("every vehicle has its own mounted set", () => {
      const a = makeVehicle(test, "Auto A");
      const b = makeVehicle(test, "Auto B");
      mount(a.id, make(a.id).id);
      mount(b.id, make(b.id).id);
      expect(
        test.db
          .select()
          .from(tireSets)
          .all()
          .filter((s) => s.mounted),
      ).toHaveLength(2);
    });
  });

  describe("distance", () => {
    it("is what the vehicle drove while the set was on", async () => {
      const car = makeVehicle(test);
      await reading(car.id, "2025-04-01", 50_000);
      const summer = make(car.id, { season: "summer" });
      const winter = make(car.id);
      mount(car.id, summer.id, { date: "2025-04-02", odometer: 50_100 });
      mount(car.id, winter.id, { date: "2025-10-20", odometer: 56_100 });
      await reading(car.id, "2026-03-01", 61_100);
      expect(getTireSet(ctx(), summer.id).distance).toBe(6_000);
      // Still mounted: up to the newest reading.
      expect(getTireSet(ctx(), winter.id).distance).toBe(5_000);
      mount(car.id, summer.id, { date: "2026-04-10", odometer: 62_000 });
      expect(getTireSet(ctx(), winter.id).distance).toBe(5_900);
      expect(getTireSet(ctx(), summer.id).distance).toBe(6_000);
    });

    it("falls back to the readings when the events carry no odometer", async () => {
      const car = makeVehicle(test);
      await reading(car.id, "2025-04-01", 50_000);
      await reading(car.id, "2025-10-01", 57_000);
      const summer = make(car.id, { season: "summer" });
      const winter = make(car.id);
      mount(car.id, summer.id, { date: "2025-04-05" });
      mount(car.id, winter.id, { date: "2025-10-05" });
      expect(getTireSet(ctx(), summer.id).distance).toBe(7_000);
    });

    it("is unknown when nothing can be measured", () => {
      const car = makeVehicle(test);
      const set = make(car.id);
      expect(getTireSet(ctx(), set.id).distance).toBe(0);
      mount(car.id, set.id);
      expect(getTireSet(ctx(), set.id).distance).toBeNull();
    });
  });

  describe("tread", () => {
    const measure = (setId: string, body: Record<string, unknown>) =>
      measureTread(ctx(), setId, measureTreadRequestSchema.parse(body), null);

    it("the newest measurement is the current depth, and every one is an event", () => {
      const car = makeVehicle(test);
      const set = make(car.id, {
        treadDepthMm: 8,
        treadMeasuredOn: "2026-01-01",
      });
      measure(set.id, { date: "2026-06-01", treadDepthMm: 6.5 });
      const afterOlder = measure(set.id, {
        date: "2026-03-01",
        treadDepthMm: 7.2,
      });
      expect(afterOlder).toMatchObject({
        treadDepthMm: 6.5,
        treadMeasuredOn: "2026-06-01",
      });
      expect(afterOlder.events.map((e) => [e.date, e.treadDepthMm])).toEqual([
        ["2026-01-01", 8],
        ["2026-03-01", 7.2],
        ["2026-06-01", 6.5],
      ]);
    });

    it("defaults to today and refuses the future and impossible depths", async () => {
      const car = makeVehicle(test);
      const set = make(car.id);
      expect(measure(set.id, { treadDepthMm: 5 }).treadMeasuredOn).toBe(
        "2026-06-15",
      );
      expect(
        (
          await failure(() =>
            measure(set.id, { treadDepthMm: 5, date: "2026-12-01" }),
          )
        ).code,
      ).toBe("invalid_request");
      expect(() =>
        measureTreadRequestSchema.parse({ treadDepthMm: -1 }),
      ).toThrow();
      expect(() =>
        measureTreadRequestSchema.parse({ treadDepthMm: 25 }),
      ).toThrow();
    });

    it("an odometer value is a reading of the vehicle", async () => {
      const car = makeVehicle(test);
      await reading(car.id, "2026-05-01", 80_000);
      const set = make(car.id);
      const measured = measure(set.id, { treadDepthMm: 5, odometer: 81_000 });
      expect(readings(car.id)[0]).toBe("2026-06-15 81000 tire_change");
      expect(measured.events.at(-1)?.odometer).toBe(81_000);
      const err = await failure(() =>
        measure(set.id, { treadDepthMm: 5, odometer: 70_000 }),
      );
      expect(fieldErrors(err, "odometer")).not.toEqual([]);
      expect(getTireSet(ctx(), set.id).events).toHaveLength(1);
    });

    it("a missing set is a 404", async () => {
      expect(
        (await failure(() => measure("nope", { treadDepthMm: 5 }))).code,
      ).toBe("not_found");
    });
  });

  describe("changing, listing and deleting", () => {
    it("changes the fields given and clears with null", () => {
      const car = makeVehicle(test);
      const set = make(car.id, {
        brand: "A",
        dot: "2423",
        storageLocation: "Keller",
      });
      const changed = updateTireSet(
        ctx(),
        set.id,
        updateTireSetRequestSchema.parse({
          brand: "B",
          dot: "",
          storageLocation: null,
          season: "all_season",
        }),
      );
      expect(changed).toMatchObject({
        brand: "B",
        dot: null,
        storageLocation: null,
        season: "all_season",
      });
    });

    it("retiring a mounted set takes it off; retiring is undone with retired: false", () => {
      const car = makeVehicle(test);
      const set = make(car.id);
      mount(car.id, set.id, { date: "2026-06-10" });
      const retired = updateTireSet(ctx(), set.id, { retired: true });
      expect(retired.mounted).toBe(false);
      expect(retired.retiredAt).toBeInstanceOf(Date);
      expect(retired.events.at(-1)).toMatchObject({
        kind: "unmounted",
        date: "2026-06-15",
      });
      expect(
        updateTireSet(ctx(), set.id, { retired: false }).retiredAt,
      ).toBeNull();
    });

    it("lists the mounted set first, then by season, without retired ones unless asked", () => {
      const car = makeVehicle(test);
      const all = make(car.id, { season: "all_season" });
      const winter = make(car.id, { season: "winter" });
      const summer = make(car.id, { season: "summer" });
      const old = make(car.id, { season: "summer", brand: "alt" });
      updateTireSet(ctx(), old.id, { retired: true });
      mount(car.id, winter.id);
      const ids = (includeRetired?: boolean) =>
        listTireSets(
          ctx(),
          car.id,
          { includeRetired },
          { limit: 50 },
        ).items.map((s) => s.id);
      expect(ids()).toEqual([winter.id, summer.id, all.id]);
      expect(ids(true)).toEqual([winter.id, summer.id, all.id, old.id]);
    });

    it("pages", () => {
      const car = makeVehicle(test);
      for (let i = 0; i < 3; i += 1) make(car.id);
      const first = listTireSets(ctx(), car.id, {}, { limit: 2 });
      expect(first.items).toHaveLength(2);
      const second = listTireSets(
        ctx(),
        car.id,
        {},
        { limit: 2, cursor: first.nextCursor! },
      );
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeNull();
    });

    it("a missing asset is a 404 for the list", async () => {
      expect(
        (await failure(() => listTireSets(ctx(), "nope", {}, { limit: 5 })))
          .code,
      ).toBe("not_found");
    });

    it("deleting a set takes its events, readings and photos along, and no other", async () => {
      const car = makeVehicle(test);
      const a = make(car.id);
      const b = make(car.id, { season: "summer" });
      mount(car.id, a.id, { date: "2026-06-01", odometer: 80_000 });
      mount(car.id, b.id, { date: "2026-06-10", odometer: 81_000 });
      await createAttachment(ctx(), {
        bytes: samplePdf(),
        filename: "dot.pdf",
        ownerType: "tire_set",
        ownerId: a.id,
        uploadedBy: null,
      });
      deleteTireSet(ctx(), a.id);
      expect(() => getTireSet(ctx(), a.id)).toThrow(/not found/i);
      expect(test.db.select().from(attachments).all()).toEqual([]);
      expect(readings(car.id)).toEqual(["2026-06-10 81000 tire_change"]);
      expect(getSignal(ctx(), odometerSignalKey(car.id))?.numeric).toBe(81_000);
      expect(
        test.db
          .select()
          .from(tireSetEvents)
          .all()
          .map((e) => e.tireSetId),
      ).not.toContain(a.id);
      expect(getTireSet(ctx(), b.id).mounted).toBe(true);
    });

    it("goes with the vehicle, photos included", async () => {
      const car = makeVehicle(test);
      const set = make(car.id);
      await createAttachment(ctx(), {
        bytes: samplePdf(),
        filename: "dot.pdf",
        ownerType: "tire_set",
        ownerId: set.id,
        uploadedBy: null,
      });
      deleteAsset(ctx(), car.id);
      expect(test.db.select().from(tireSets).all()).toEqual([]);
      expect(test.db.select().from(tireSetEvents).all()).toEqual([]);
      expect(test.db.select().from(attachments).all()).toEqual([]);
    });

    it("only takes photos for a set that exists", async () => {
      await expect(
        createAttachment(ctx(), {
          bytes: samplePdf(),
          filename: "dot.pdf",
          ownerType: "tire_set",
          ownerId: "nope",
          uploadedBy: null,
        }),
      ).rejects.toMatchObject({ code: "invalid_request" });
    });
  });

  it("uses the time of the injected clock for the default date", () => {
    const car = makeVehicle(test);
    const set = make(car.id);
    const later = mount(car.id, set.id, {}, at("2026-08-20"));
    expect(later.mountedOn).toBe("2026-08-20");
  });
});
