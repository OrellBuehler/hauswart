import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { household, HOUSEHOLD_ID } from "$lib/server/db";
import { ctxAt } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import { getHousehold, updateHousehold } from "./household";

describe("household", () => {
  const test = useTestDB();
  const originalZone = process.env.HAUSWART_TZ;
  afterEach(() => {
    if (originalZone === undefined) delete process.env.HAUSWART_TZ;
    else process.env.HAUSWART_TZ = originalZone;
  });

  it("is created lazily with defaults", () => {
    expect(test.db.select().from(household).all()).toHaveLength(0);
    const h = getHousehold(ctxAt(test.db));
    expect(h).toMatchObject({
      currency: "CHF",
      handoverDate: null,
      settings: { dueSoonDays: 7, digestTime: "08:00" },
    });
    expect(h.timezone).toBe(process.env.HAUSWART_TZ ?? "Europe/Zurich");
    expect(test.db.select().from(household).all()).toHaveLength(1);
  });

  it("stays a singleton", () => {
    getHousehold(ctxAt(test.db));
    getHousehold(ctxAt(test.db));
    updateHousehold(ctxAt(test.db), { name: "Musterwohnung" });
    const rows = test.db.select().from(household).all();
    expect(rows.map((r) => r.id)).toEqual([HOUSEHOLD_ID]);
  });

  it("patches fields and merges settings", () => {
    const ctx = ctxAt(test.db);
    updateHousehold(ctx, { name: "Musterwohnung", handoverDate: "2026-04-03" });
    const h = updateHousehold(ctx, { settings: { dueSoonDays: 10 } });
    expect(h).toMatchObject({
      name: "Musterwohnung",
      handoverDate: "2026-04-03",
      settings: { dueSoonDays: 10, digestTime: "08:00" },
    });
    expect(
      updateHousehold(ctx, { settings: { digestTime: "07:30" } }).settings,
    ).toEqual({
      dueSoonDays: 10,
      digestTime: "07:30",
      defectDeadlineMonths: 24,
      integrationHostAllowlist: [],
    });
    expect(
      updateHousehold(ctx, { handoverDate: null }).handoverDate,
    ).toBeNull();
  });

  it("follows HAUSWART_TZ", () => {
    getHousehold(ctxAt(test.db));
    process.env.HAUSWART_TZ = "America/New_York";
    expect(getHousehold(ctxAt(test.db)).timezone).toBe("America/New_York");
    expect(
      test.db
        .select()
        .from(household)
        .where(eq(household.id, HOUSEHOLD_ID))
        .get()?.timezone,
    ).toBe("America/New_York");
  });

  it("rejects stored settings that no longer fit", () => {
    getHousehold(ctxAt(test.db));
    test.db
      .update(household)
      .set({ settings: { dueSoonDays: "soon" } })
      .run();
    expect(() => getHousehold(ctxAt(test.db))).toThrow(
      "Stored household settings is invalid",
    );
  });
});
