import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  createFuelLogRequestSchema,
  updateFuelLogRequestSchema,
} from "$lib/api/schemas/fuel-logs";
import { putVehicleRequestSchema } from "$lib/api/schemas/vehicles";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { createAsset, deleteAsset } from "$lib/server/assets/assets";
import { createAttachment } from "$lib/server/attachments/attachments";
import {
  createCostRequestSchema,
  updateCostRequestSchema,
} from "$lib/api/schemas/costs";
import {
  createCost,
  deleteCost,
  getCost,
  updateCost,
} from "$lib/server/costs/costs";
import {
  attachments,
  costEntries,
  fuelLogs,
  odometerReadings,
} from "$lib/server/db";
import { updateHousehold } from "$lib/server/household/household";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, NOW } from "$lib/testing/domain";
import { samplePdf, useTestFilesDir } from "$lib/testing/files";
import { failure, fieldErrors, makeVehicle } from "$lib/testing/vehicles";
import {
  createFuelLog,
  deleteFuelLog,
  getFuelLog,
  listFuelLogs,
  updateFuelLog,
} from "./fuel-logs";
import { listReadings } from "./odometer";
import { putVehicle } from "./vehicles";

describe("fuel log", () => {
  const test = useTestDB();
  useTestFilesDir();
  const ctx = (now = NOW) => ctxAt(test.db, now);

  async function world() {
    const anna = await createTestUser({ displayName: "Anna" });
    const ben = await createTestUser({ displayName: "Ben" });
    const car = makeVehicle(test);
    const fill = (over: Record<string, unknown> = {}, userId = anna.id) =>
      createFuelLog(
        ctx(),
        car.id,
        createFuelLogRequestSchema.parse({
          date: "2026-06-01",
          odometer: 80_000,
          quantity: 40,
          amountMinor: 7_200,
          station: "Muster Tankstelle",
          ...over,
        }),
        userId,
      );
    const change = (
      id: string,
      patch: Record<string, unknown>,
      userId = anna.id,
    ) =>
      updateFuelLog(ctx(), id, updateFuelLogRequestSchema.parse(patch), userId);
    const readings = () =>
      listReadings(ctx(), car.id, { limit: 100 }).items.map(
        (r) => `${r.date} ${r.value} ${r.source}`,
      );
    return { anna, ben, car, fill, change, readings };
  }

  describe("a new entry", () => {
    it("is a fill, a reading of the vehicle and a cost entry for it, paid by the caller", async () => {
      const { anna, car, fill } = await world();
      const log = fill();
      expect(log).toMatchObject({
        assetId: car.id,
        date: "2026-06-01",
        odometer: 80_000,
        odometerUnit: "km",
        quantity: 40,
        unit: "l",
        amountMinor: 7_200,
        currency: "CHF",
        fullTank: true,
        missedPrevious: false,
        station: "Muster Tankstelle",
        paidByUserId: anna.id,
        pricePerUnitMinor: 180,
        distance: null,
        consumptionPer100: null,
        createdBy: anna.id,
      });

      const reading = test.db.select().from(odometerReadings).all()[0];
      expect(reading).toMatchObject({
        assetId: car.id,
        date: "2026-06-01",
        value: 80_000,
        source: "fuel_log",
        sourceId: log.id,
        createdBy: anna.id,
      });

      const cost = getCost(ctx(), log.costEntryId!);
      expect(cost).toMatchObject({
        title: "Tanken Muster Tankstelle",
        category: "fuel",
        amountMinor: 7_200,
        currency: "CHF",
        date: "2026-06-01",
        assetId: car.id,
        payee: "Muster Tankstelle",
        paidByUserId: anna.id,
        splitMode: "ownership",
        countsAsExpense: true,
        deductible: "unknown",
      });
      expect(cost.shares.map((s) => s.amountMinor).sort()).toEqual([
        3_600, 3_600,
      ]);
    });

    it("defaults to today, a full tank and litres, and leaves out the station in the title", async () => {
      const { fill } = await world();
      const log = fill({ date: undefined, station: undefined });
      expect(log).toMatchObject({
        date: "2026-06-15",
        fullTank: true,
        unit: "l",
      });
      expect(getCost(ctx(), log.costEntryId!).title).toBe("Tanken");
    });

    it("counts kilowatt hours for an electric vehicle, and says it charged", async () => {
      const { car, fill } = await world();
      putVehicle(
        ctx(),
        car.id,
        putVehicleRequestSchema.parse({ fuelType: "electric" }),
      );
      const log = fill({
        quantity: 30,
        amountMinor: 900,
        station: "Ladesäule",
      });
      expect(log.unit).toBe("kWh");
      expect(getCost(ctx(), log.costEntryId!).title).toBe("Laden Ladesäule");
      expect(fill({ unit: "l" }).unit).toBe("l");
    });

    it("books for another payer and splits as asked", async () => {
      const { ben, fill, anna } = await world();
      const byBen = fill({ paidByUserId: ben.id, splitMode: "none" });
      expect(getCost(ctx(), byBen.costEntryId!)).toMatchObject({
        paidByUserId: ben.id,
        splitMode: "none",
        shares: [],
      });
      expect(byBen.paidByUserId).toBe(ben.id);
      const nobody = fill({ paidByUserId: null, odometer: 80_100 });
      expect(getCost(ctx(), nobody.costEntryId!).paidByUserId).toBeNull();
      const custom = fill({
        odometer: 80_200,
        splitMode: "custom",
        shares: [
          { userId: anna.id, shareBps: 7_000 },
          { userId: ben.id, shareBps: 3_000 },
        ],
      });
      const parts = Object.fromEntries(
        getCost(ctx(), custom.costEntryId!).shares.map((s) => [
          s.userName,
          s.amountMinor,
        ]),
      );
      expect(parts).toEqual({ Anna: 5_040, Ben: 2_160 });
    });

    it("books in the currency of the fill", async () => {
      const { fill } = await world();
      const log = fill({ currency: "EUR", amountMinor: 6_000 });
      expect(log.currency).toBe("EUR");
      expect(getCost(ctx(), log.costEntryId!).currency).toBe("EUR");
    });

    it("a free charge is logged without a cost entry", async () => {
      const { fill } = await world();
      const log = fill({ unit: "kWh", amountMinor: 0, quantity: 25 });
      expect(log.costEntryId).toBeNull();
      expect(log.pricePerUnitMinor).toBe(0);
      expect(test.db.select().from(costEntries).all()).toEqual([]);
      expect(test.db.select().from(odometerReadings).all()).toHaveLength(1);
    });

    it.each([
      [
        "an odometer lower than the reading before",
        { odometer: 70_000 },
        "odometer",
      ],
      ["a date in the future", { date: "2026-12-01" }, "date"],
      ["a payer who does not exist", { paidByUserId: "nope" }, "paidByUserId"],
      [
        "shares without a custom split",
        { shares: [{ userId: "x", shareBps: 10_000 }] },
        "shares",
      ],
    ])("refuses %s and keeps nothing of it", async (_name, over, field) => {
      const { fill } = await world();
      fill({ odometer: 79_000, date: "2026-05-01" });
      const before = {
        logs: test.db.select().from(fuelLogs).all().length,
        costs: test.db.select().from(costEntries).all().length,
        readings: test.db.select().from(odometerReadings).all().length,
      };
      const err = await failure(() => fill(over));
      expect(err.code).toBe("invalid_request");
      expect(fieldErrors(err, field)).not.toEqual([]);
      expect({
        logs: test.db.select().from(fuelLogs).all().length,
        costs: test.db.select().from(costEntries).all().length,
        readings: test.db.select().from(odometerReadings).all().length,
      }).toEqual(before);
    });

    it("only vehicles have a fuel log; a missing asset is a 404", async () => {
      const { anna } = await world();
      const device = createAsset(
        ctx(),
        createAssetRequestSchema.parse({ name: "Backofen" }),
      );
      const input = createFuelLogRequestSchema.parse({
        odometer: 1,
        quantity: 1,
        amountMinor: 1,
      });
      expect(
        (await failure(() => createFuelLog(ctx(), device.id, input, anna.id)))
          .code,
      ).toBe("invalid_request");
      expect(
        (await failure(() => createFuelLog(ctx(), "nope", input, anna.id)))
          .code,
      ).toBe("not_found");
    });
  });

  describe("consumption and prices", () => {
    it("works out each full stretch from the whole log", async () => {
      const { fill } = await world();
      fill({
        date: "2026-01-01",
        odometer: 10_000,
        quantity: 50,
        amountMinor: 9_000,
      });
      const partial = fill({
        date: "2026-01-10",
        odometer: 10_300,
        quantity: 15,
        amountMinor: 2_700,
        fullTank: false,
      });
      const closing = fill({
        date: "2026-01-20",
        odometer: 10_700,
        quantity: 35,
        amountMinor: 6_300,
      });
      expect(getFuelLog(ctx(), partial.id)).toMatchObject({
        consumptionPer100: null,
        distance: null,
        pricePerUnitMinor: 180,
      });
      const closed = getFuelLog(ctx(), closing.id);
      expect(closed.distance).toBe(700);
      expect(closed.consumptionPer100).toBeCloseTo((50 / 700) * 100, 9);
      expect(closed.costPerDistanceMinor).toBeCloseTo(9_000 / 700, 9);
    });

    it("a gap flagged on an entry breaks the chain", async () => {
      const { fill } = await world();
      fill({ date: "2026-01-01", odometer: 10_000 });
      const after = fill({
        date: "2026-03-01",
        odometer: 12_000,
        quantity: 80,
        missedPrevious: true,
      });
      expect(getFuelLog(ctx(), after.id).consumptionPer100).toBeNull();
    });

    it("knows no cost per distance when the fill is in another currency", async () => {
      const { fill } = await world();
      fill({ date: "2026-01-01", odometer: 10_000 });
      const eur = fill({
        date: "2026-01-20",
        odometer: 10_500,
        currency: "EUR",
      });
      expect(getFuelLog(ctx(), eur.id).consumptionPer100).toBeCloseTo(8, 9);
      expect(getFuelLog(ctx(), eur.id).costPerDistanceMinor).toBeNull();
      expect(getFuelLog(ctx(), eur.id).pricePerUnitMinor).toBeNull();
    });
  });

  describe("changing an entry", () => {
    it("keeps the cost entry in step with amount, date, station and payer", async () => {
      const { ben, fill, change } = await world();
      const log = fill();
      const changed = change(log.id, {
        amountMinor: 8_000,
        date: "2026-06-02",
        station: "Andere Tankstelle",
        paidByUserId: ben.id,
      });
      expect(changed).toMatchObject({
        amountMinor: 8_000,
        date: "2026-06-02",
        station: "Andere Tankstelle",
        paidByUserId: ben.id,
      });
      const cost = getCost(ctx(), log.costEntryId!);
      expect(cost).toMatchObject({
        title: "Tanken Andere Tankstelle",
        payee: "Andere Tankstelle",
        amountMinor: 8_000,
        date: "2026-06-02",
        paidByUserId: ben.id,
      });
      expect(cost.shares.map((s) => s.amountMinor)).toEqual([4_000, 4_000]);
    });

    it("a patch of the booking alone changes the payer or the split of the cost entry", async () => {
      const { ben, fill, change } = await world();
      const log = fill();
      const byBen = change(log.id, { paidByUserId: ben.id });
      expect(byBen.paidByUserId).toBe(ben.id);
      expect(getCost(ctx(), log.costEntryId!)).toMatchObject({
        paidByUserId: ben.id,
        splitMode: "ownership",
        amountMinor: 7_200,
      });
      const nobody = change(log.id, { paidByUserId: null });
      expect(nobody.paidByUserId).toBeNull();
      change(log.id, { splitMode: "none" });
      expect(getCost(ctx(), log.costEntryId!)).toMatchObject({
        paidByUserId: null,
        splitMode: "none",
        shares: [],
      });
      change(log.id, { splitMode: "equal" });
      const cost = getCost(ctx(), log.costEntryId!);
      expect(cost.splitMode).toBe("equal");
      expect(cost.shares.map((s) => s.amountMinor)).toEqual([3_600, 3_600]);
    });

    it("a patch of a custom split alone is booked on the cost entry", async () => {
      const { anna, ben, fill, change } = await world();
      const log = fill();
      change(log.id, {
        splitMode: "custom",
        shares: [
          { userId: anna.id, shareBps: 7_000 },
          { userId: ben.id, shareBps: 3_000 },
        ],
      });
      const parts = Object.fromEntries(
        getCost(ctx(), log.costEntryId!).shares.map((s) => [
          s.userName,
          s.amountMinor,
        ]),
      );
      expect(parts).toEqual({ Anna: 5_040, Ben: 2_160 });
    });

    it("a patch of the booking alone touches the fill's updated time", async () => {
      const { ben, fill } = await world();
      const log = fill();
      const later = ctx(NOW + 60_000);
      const changed = updateFuelLog(
        later,
        log.id,
        updateFuelLogRequestSchema.parse({ paidByUserId: ben.id }),
        ben.id,
      );
      expect(changed.updatedAt.getTime()).toBe(NOW + 60_000);
    });

    it("moves the reading with the date and the odometer", async () => {
      const { fill, change, readings } = await world();
      const log = fill();
      change(log.id, { odometer: 80_500, date: "2026-06-03" });
      expect(readings()).toEqual(["2026-06-03 80500 fuel_log"]);
    });

    it("refuses an odometer lower than the reading before, and changes nothing", async () => {
      const { fill, change, readings } = await world();
      fill({ date: "2026-05-01", odometer: 79_000 });
      const log = fill({ date: "2026-06-01", odometer: 80_000 });
      const err = await failure(() =>
        change(log.id, { odometer: 70_000, amountMinor: 9_999 }),
      );
      expect(fieldErrors(err, "odometer")).not.toEqual([]);
      expect(getFuelLog(ctx(), log.id)).toMatchObject({
        odometer: 80_000,
        amountMinor: 7_200,
      });
      expect(getCost(ctx(), log.costEntryId!).amountMinor).toBe(7_200);
      expect(readings()).toEqual([
        "2026-06-01 80000 fuel_log",
        "2026-05-01 79000 fuel_log",
      ]);
    });

    it("leaves the cost entry alone when only other things change", async () => {
      const { fill, change } = await world();
      const log = fill();
      test.db
        .update(costEntries)
        .set({ title: "Von Hand umbenannt" })
        .where(eq(costEntries.id, log.costEntryId!))
        .run();
      change(log.id, { notes: "Bar bezahlt", quantity: 41, fullTank: false });
      expect(getCost(ctx(), log.costEntryId!).title).toBe("Von Hand umbenannt");
    });

    it("a fill made free loses its cost entry, one that costs again gets a new one", async () => {
      const { fill, change } = await world();
      const log = fill();
      const free = change(log.id, { amountMinor: 0 });
      expect(free.costEntryId).toBeNull();
      expect(test.db.select().from(costEntries).all()).toEqual([]);
      const paid = change(log.id, { amountMinor: 5_000 });
      expect(paid.costEntryId).not.toBeNull();
      expect(getCost(ctx(), paid.costEntryId!)).toMatchObject({
        amountMinor: 5_000,
        category: "fuel",
        title: "Tanken Muster Tankstelle",
      });
    });

    it("does not bring back a cost entry somebody deleted, unless the amount is changed", async () => {
      const { fill, change } = await world();
      const log = fill();
      test.db
        .delete(costEntries)
        .where(eq(costEntries.id, log.costEntryId!))
        .run();
      expect(getFuelLog(ctx(), log.id).costEntryId).toBeNull();
      expect(change(log.id, { notes: "x" }).costEntryId).toBeNull();
      expect(change(log.id, { amountMinor: 7_500 }).costEntryId).not.toBeNull();
    });

    it("a missing entry is a 404", async () => {
      await world();
      expect((await failure(() => getFuelLog(ctx(), "nope"))).code).toBe(
        "not_found",
      );
    });
  });

  describe("the cost entry a fill booked", () => {
    const patchCost = (id: string, patch: Record<string, unknown>) =>
      updateCost(ctx(), id, updateCostRequestSchema.parse(patch));

    it("says which fill booked it", async () => {
      const { car, fill } = await world();
      const log = fill();
      expect(getCost(ctx(), log.costEntryId!).fuelLogId).toBe(log.id);
      const manual = createCost(
        ctx(),
        createCostRequestSchema.parse({
          title: "Wäsche",
          amountMinor: 1_500,
          category: "other",
          assetId: car.id,
        }),
        null,
      );
      expect(manual.fuelLogId).toBeNull();
    });

    it.each([
      ["amount", { amountMinor: 9_999 }],
      ["currency", { currency: "EUR" }],
      ["date", { date: "2026-06-02" }],
      ["amount and date", { amountMinor: 1, date: "2026-06-03" }],
    ])(
      "keeps its %s: a change there is refused, naming the fill",
      async (_name, patch) => {
        const { fill } = await world();
        const log = fill();
        const err = await failure(() => patchCost(log.costEntryId!, patch));
        expect(err).toMatchObject({
          code: "conflict",
          status: 409,
          details: { fuelLogId: log.id },
        });
        expect(err.message).toMatch(/fuel log/i);
        expect(getCost(ctx(), log.costEntryId!)).toMatchObject({
          amountMinor: 7_200,
          currency: "CHF",
          date: "2026-06-01",
        });
      },
    );

    it("accepts what repeats the amount, the currency and the date as they are", async () => {
      const { fill } = await world();
      const log = fill();
      expect(
        patchCost(log.costEntryId!, {
          amountMinor: 7_200,
          currency: "CHF",
          date: "2026-06-01",
          notes: "Beleg liegt bei",
        }).notes,
      ).toBe("Beleg liegt bei");
    });

    it("stays editable in everything else", async () => {
      const { anna, ben, car, fill } = await world();
      const log = fill();
      const other = createAsset(
        ctx(),
        createAssetRequestSchema.parse({ name: "Zweitwagen", kind: "vehicle" }),
      );
      const changed = patchCost(log.costEntryId!, {
        title: "Benzin",
        category: "other",
        notes: "Geschäftsreise",
        payee: "Andere Tankstelle",
        deductible: "maintenance",
        paidByUserId: ben.id,
        splitMode: "custom",
        shares: [
          { userId: anna.id, shareBps: 2_000 },
          { userId: ben.id, shareBps: 8_000 },
        ],
        assetId: other.id,
      });
      expect(changed).toMatchObject({
        title: "Benzin",
        category: "other",
        notes: "Geschäftsreise",
        payee: "Andere Tankstelle",
        deductible: "maintenance",
        paidByUserId: ben.id,
        splitMode: "custom",
        assetId: other.id,
        fuelLogId: log.id,
      });
      expect(changed.assetId).not.toBe(car.id);
      expect(getFuelLog(ctx(), log.id).paidByUserId).toBe(ben.id);
    });

    it("cannot be deleted while the fill exists", async () => {
      const { fill } = await world();
      const log = fill();
      const err = await failure(() => deleteCost(ctx(), log.costEntryId!));
      expect(err).toMatchObject({
        code: "conflict",
        details: { fuelLogId: log.id },
      });
      expect(err.message).toMatch(/fuel log/i);
      expect(getCost(ctx(), log.costEntryId!).id).toBe(log.costEntryId);
      expect(getFuelLog(ctx(), log.id).costEntryId).toBe(log.costEntryId);
    });

    it("is the fill's to change and to delete", async () => {
      const { fill, change } = await world();
      const log = fill();
      change(log.id, {
        amountMinor: 8_000,
        date: "2026-06-04",
        currency: "EUR",
      });
      expect(getCost(ctx(), log.costEntryId!)).toMatchObject({
        amountMinor: 8_000,
        date: "2026-06-04",
        currency: "EUR",
      });
      change(log.id, { amountMinor: 0 });
      expect(test.db.select().from(costEntries).all()).toEqual([]);
      const again = change(log.id, { amountMinor: 5_000 });
      deleteFuelLog(ctx(), log.id);
      expect(
        test.db
          .select()
          .from(costEntries)
          .where(eq(costEntries.id, again.costEntryId!))
          .all(),
      ).toEqual([]);
    });

    it("is free again once the vehicle, and with it the fill, is gone", async () => {
      const { car, fill } = await world();
      const log = fill();
      deleteAsset(ctx(), car.id);
      expect(getCost(ctx(), log.costEntryId!).fuelLogId).toBeNull();
      expect(
        patchCost(log.costEntryId!, { amountMinor: 100 }).amountMinor,
      ).toBe(100);
      deleteCost(ctx(), log.costEntryId!);
      expect(test.db.select().from(costEntries).all()).toEqual([]);
    });

    it("is free again when the fill lets go of it", async () => {
      const { fill } = await world();
      const log = fill();
      test.db
        .update(fuelLogs)
        .set({ costEntryId: null })
        .where(eq(fuelLogs.id, log.id))
        .run();
      expect(patchCost(log.costEntryId!, { amountMinor: 1 }).amountMinor).toBe(
        1,
      );
    });

    describe("title and payee", () => {
      const rename = (
        id: string,
        fields: { title?: string; payee?: string | null },
      ) =>
        test.db
          .update(costEntries)
          .set(fields)
          .where(eq(costEntries.id, id))
          .run();

      it("follow the station while they are what the fill wrote", async () => {
        const { fill, change } = await world();
        const log = fill();
        change(log.id, { station: "Andere Tankstelle" });
        expect(getCost(ctx(), log.costEntryId!)).toMatchObject({
          title: "Tanken Andere Tankstelle",
          payee: "Andere Tankstelle",
        });
        change(log.id, { station: null });
        expect(getCost(ctx(), log.costEntryId!)).toMatchObject({
          title: "Tanken",
          payee: null,
        });
      });

      it("keep a title somebody changed on the cost entry, and the payee still follows", async () => {
        const { fill, change } = await world();
        const log = fill();
        rename(log.costEntryId!, { title: "Wocheneinkauf Benzin" });
        change(log.id, { station: "Andere Tankstelle" });
        expect(getCost(ctx(), log.costEntryId!)).toMatchObject({
          title: "Wocheneinkauf Benzin",
          payee: "Andere Tankstelle",
        });
      });

      it("keep a payee somebody changed, and the title still follows", async () => {
        const { fill, change } = await world();
        const log = fill();
        rename(log.costEntryId!, { payee: "Firmenkarte" });
        change(log.id, { station: "Andere Tankstelle" });
        expect(getCost(ctx(), log.costEntryId!)).toMatchObject({
          title: "Tanken Andere Tankstelle",
          payee: "Firmenkarte",
        });
      });

      it("keep both when both were changed, whatever else the patch moves", async () => {
        const { ben, fill, change } = await world();
        const log = fill();
        rename(log.costEntryId!, { title: "Eigener Titel", payee: null });
        change(log.id, {
          station: "Andere Tankstelle",
          unit: "kWh",
          amountMinor: 8_000,
          paidByUserId: ben.id,
        });
        expect(getCost(ctx(), log.costEntryId!)).toMatchObject({
          title: "Eigener Titel",
          payee: null,
          amountMinor: 8_000,
          paidByUserId: ben.id,
        });
      });

      it("follow a change of the unit while the title is the generated one", async () => {
        const { fill, change } = await world();
        const log = fill();
        change(log.id, { unit: "kWh" });
        expect(getCost(ctx(), log.costEntryId!).title).toBe(
          "Laden Muster Tankstelle",
        );
        rename(log.costEntryId!, { title: "Strom" });
        change(log.id, { unit: "l" });
        expect(getCost(ctx(), log.costEntryId!).title).toBe("Strom");
      });
    });
  });

  describe("deleting an entry", () => {
    it("takes the reading and the cost entry with it, receipts included", async () => {
      const { fill, readings } = await world();
      const keep = fill({ date: "2026-05-01", odometer: 79_000 });
      const log = fill();
      await createAttachment(ctx(), {
        bytes: samplePdf(),
        filename: "beleg.pdf",
        ownerType: "cost",
        ownerId: log.costEntryId!,
        uploadedBy: null,
      });
      deleteFuelLog(ctx(), log.id);
      expect(
        test.db
          .select()
          .from(fuelLogs)
          .all()
          .map((l) => l.id),
      ).toEqual([keep.id]);
      expect(
        test.db
          .select()
          .from(costEntries)
          .all()
          .map((c) => c.id),
      ).toEqual([keep.costEntryId]);
      expect(test.db.select().from(attachments).all()).toEqual([]);
      expect(readings()).toEqual(["2026-05-01 79000 fuel_log"]);
    });

    it("a missing entry is a 404", async () => {
      await world();
      expect(await failure(() => deleteFuelLog(ctx(), "nope"))).toMatchObject({
        code: "not_found",
      });
    });

    it("an entry whose cost entry is gone can still be deleted", async () => {
      const { fill } = await world();
      const log = fill();
      test.db
        .delete(costEntries)
        .where(eq(costEntries.id, log.costEntryId!))
        .run();
      deleteFuelLog(ctx(), log.id);
      expect(test.db.select().from(fuelLogs).all()).toEqual([]);
    });

    it("the cost entries stay when the vehicle is deleted, without the vehicle", async () => {
      const { car, fill } = await world();
      const log = fill();
      deleteAsset(ctx(), car.id);
      expect(test.db.select().from(fuelLogs).all()).toEqual([]);
      expect(getCost(ctx(), log.costEntryId!)).toMatchObject({ assetId: null });
    });
  });

  describe("the list", () => {
    it("is newest first, pages, and can be limited to a year", async () => {
      const { car, fill } = await world();
      fill({ date: "2025-12-20", odometer: 9_000 });
      fill({ date: "2026-01-10", odometer: 10_000 });
      fill({ date: "2026-02-10", odometer: 10_500 });
      fill({ date: "2026-02-10", odometer: 10_600 });
      const all = listFuelLogs(ctx(), car.id, {}, { limit: 2 });
      expect(all.items.map((l) => l.odometer)).toEqual([10_600, 10_500]);
      const rest = listFuelLogs(
        ctx(),
        car.id,
        {},
        { limit: 2, cursor: all.nextCursor! },
      );
      expect(rest.items.map((l) => l.odometer)).toEqual([10_000, 9_000]);
      expect(rest.nextCursor).toBeNull();
      expect(
        listFuelLogs(ctx(), car.id, { year: 2026 }, { limit: 10 }).items.map(
          (l) => l.odometer,
        ),
      ).toEqual([10_600, 10_500, 10_000]);
      // The first fill of 2026 closes a stretch that began in 2025.
      expect(
        listFuelLogs(ctx(), car.id, { year: 2026 }, { limit: 10 }).items.at(-1)
          ?.distance,
      ).toBe(1_000);
    });

    it("a missing asset is a 404", async () => {
      await world();
      expect(
        (await failure(() => listFuelLogs(ctx(), "nope", {}, { limit: 1 })))
          .code,
      ).toBe("not_found");
    });
  });

  it("the household currency decides which amounts count towards the cost per distance", async () => {
    const { fill } = await world();
    updateHousehold(ctx(), { currency: "EUR" });
    fill({
      date: "2026-01-01",
      odometer: 10_000,
      currency: "EUR",
      amountMinor: 9_000,
    });
    const second = fill({
      date: "2026-01-20",
      odometer: 10_500,
      currency: "EUR",
      amountMinor: 6_000,
    });
    expect(getFuelLog(ctx(), second.id).costPerDistanceMinor).toBe(12);
  });
});
