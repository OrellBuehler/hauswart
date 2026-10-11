import { describe, expect, it } from "vitest";
import type { FuelLog } from "$lib/api/schemas/fuel-logs";
import {
  buildCreateFuelLog,
  buildUpdateFuelLog,
  defaultFuelUnit,
  draftFromFuelLog,
  newFuelDraft,
  type FuelDraft,
} from "./fuel-form";

const TODAY = "2026-10-11";
const USERS = ["u1", "u2"];

const log: FuelLog = {
  id: "f1",
  assetId: "a1",
  date: "2026-10-01",
  odometer: 45200,
  odometerUnit: "km",
  quantity: 41.23,
  unit: "l",
  amountMinor: 7595,
  currency: "CHF",
  fullTank: true,
  missedPrevious: false,
  station: "Beispiel-Tankstelle",
  notes: null,
  costEntryId: "c1",
  paidByUserId: "u1",
  pricePerUnitMinor: 184.2,
  distance: 520,
  consumptionPer100: 7.9,
  costPerDistanceMinor: 14.6,
  createdBy: "u1",
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
};

const draft = (over: Partial<FuelDraft> = {}): FuelDraft => ({
  ...newFuelDraft({
    today: TODAY,
    unit: "l",
    currency: "CHF",
    paidByUserId: "u1",
    userIds: USERS,
  }),
  odometer: "45700",
  quantity: "38,5",
  amount: "70.40",
  ...over,
});

describe("defaultFuelUnit", () => {
  it("takes kWh for an electric vehicle and litres for the rest", () => {
    expect(defaultFuelUnit("electric")).toBe("kWh");
    for (const type of [
      "petrol",
      "diesel",
      "hybrid",
      "plugin_hybrid",
      "other",
    ] as const) {
      expect(defaultFuelUnit(type)).toBe("l");
    }
    expect(defaultFuelUnit(null)).toBe("l");
  });
});

describe("newFuelDraft", () => {
  it("starts today with a full tank and the person as payer", () => {
    expect(draft()).toMatchObject({
      date: TODAY,
      fullTank: true,
      missedPrevious: false,
      paidByUserId: "u1",
      splitMode: "ownership",
      unit: "l",
      currency: "CHF",
    });
  });
});

describe("buildCreateFuelLog", () => {
  it("builds the request from what was typed", () => {
    const { body, errors } = buildCreateFuelLog(draft(), {
      today: TODAY,
      userIds: USERS,
    });
    expect(errors).toEqual({});
    expect(body).toEqual({
      date: TODAY,
      odometer: 45700,
      quantity: 38.5,
      unit: "l",
      amountMinor: 7040,
      currency: "CHF",
      fullTank: true,
      missedPrevious: false,
      station: null,
      notes: null,
      paidByUserId: "u1",
      splitMode: "ownership",
    });
  });

  it("books a free charge with an amount of 0", () => {
    const { body } = buildCreateFuelLog(
      draft({ unit: "kWh", amount: "0", quantity: "22" }),
      { today: TODAY, userIds: USERS },
    );
    expect(body).toMatchObject({ unit: "kWh", amountMinor: 0, quantity: 22 });
  });

  it("sends nobody as payer when none is chosen", () => {
    const { body } = buildCreateFuelLog(draft({ paidByUserId: "" }), {
      today: TODAY,
      userIds: USERS,
    });
    expect(body?.paidByUserId).toBeNull();
  });

  it("trims the station and the notes", () => {
    const { body } = buildCreateFuelLog(
      draft({ station: "  Beispiel  ", notes: " Nachts " }),
      { today: TODAY, userIds: USERS },
    );
    expect(body).toMatchObject({ station: "Beispiel", notes: "Nachts" });
  });

  it("needs the odometer, the quantity and the amount", () => {
    const { body, errors } = buildCreateFuelLog(
      draft({ odometer: "", quantity: "", amount: "" }),
      { today: TODAY, userIds: USERS },
    );
    expect(body).toBeUndefined();
    expect(Object.keys(errors).sort()).toEqual([
      "amountMinor",
      "odometer",
      "quantity",
    ]);
  });

  it("refuses a quantity of 0, a negative amount and text that is no number", () => {
    const { errors } = buildCreateFuelLog(
      draft({ quantity: "0", amount: "-5", odometer: "viel" }),
      { today: TODAY, userIds: USERS },
    );
    expect(errors.quantity).toBeTruthy();
    expect(errors.amountMinor).toBeTruthy();
    expect(errors.odometer).toBeTruthy();
  });

  it("refuses more decimals than the currency has", () => {
    const { errors } = buildCreateFuelLog(draft({ amount: "70.404" }), {
      today: TODAY,
      userIds: USERS,
    });
    expect(errors.amountMinor).toBeTruthy();
  });

  it("refuses a day in the future or a missing day", () => {
    expect(
      buildCreateFuelLog(draft({ date: "2026-10-12" }), {
        today: TODAY,
        userIds: USERS,
      }).errors.date,
    ).toBeTruthy();
    expect(
      buildCreateFuelLog(draft({ date: "" }), {
        today: TODAY,
        userIds: USERS,
      }).errors.date,
    ).toBeTruthy();
  });

  it("refuses a currency that is no code", () => {
    expect(
      buildCreateFuelLog(draft({ currency: "fr" }), {
        today: TODAY,
        userIds: USERS,
      }).errors.currency,
    ).toBeTruthy();
  });

  it("sends custom shares only for a custom split, and they must add up", () => {
    const equal = buildCreateFuelLog(draft({ splitMode: "equal" }), {
      today: TODAY,
      userIds: USERS,
    });
    expect(equal.body?.splitMode).toBe("equal");
    expect(equal.body).not.toHaveProperty("shares");

    const custom = buildCreateFuelLog(
      draft({ splitMode: "custom", shares: { u1: "70", u2: "30" } }),
      { today: TODAY, userIds: USERS },
    );
    expect(custom.body?.shares).toEqual([
      { userId: "u1", shareBps: 7000 },
      { userId: "u2", shareBps: 3000 },
    ]);

    const short = buildCreateFuelLog(
      draft({ splitMode: "custom", shares: { u1: "70", u2: "20" } }),
      { today: TODAY, userIds: USERS },
    );
    expect(short.body).toBeUndefined();
    expect(short.errors.shares).toBeTruthy();
  });
});

describe("draftFromFuelLog", () => {
  it("fills the form with the fill-up as it was logged", () => {
    expect(draftFromFuelLog(log, USERS)).toMatchObject({
      date: "2026-10-01",
      odometer: "45200",
      quantity: "41.23",
      amount: "75.95",
      unit: "l",
      currency: "CHF",
      station: "Beispiel-Tankstelle",
      notes: "",
      paidByUserId: "u1",
    });
  });

  it("writes an amount in a currency without minor units whole", () => {
    expect(
      draftFromFuelLog({ ...log, currency: "JPY", amountMinor: 6500 }, USERS)
        .amount,
    ).toBe("6500");
  });
});

describe("buildUpdateFuelLog", () => {
  it("says nothing changed for the form as it was filled", () => {
    expect(
      buildUpdateFuelLog(draftFromFuelLog(log, USERS), log, TODAY),
    ).toEqual({ kind: "unchanged" });
  });

  it("sends only what changed", () => {
    const edited = {
      ...draftFromFuelLog(log, USERS),
      amount: "76.10",
      notes: "Regen",
    };
    expect(buildUpdateFuelLog(edited, log, TODAY)).toEqual({
      kind: "changed",
      body: { amountMinor: 7610, notes: "Regen" },
    });
  });

  it("sends a payer taken away as null and a cleared station as null", () => {
    const edited = {
      ...draftFromFuelLog(log, USERS),
      paidByUserId: "",
      station: " ",
    };
    expect(buildUpdateFuelLog(edited, log, TODAY)).toEqual({
      kind: "changed",
      body: { paidByUserId: null, station: null },
    });
  });

  it("never sends the split", () => {
    const edited = {
      ...draftFromFuelLog(log, USERS),
      splitMode: "none" as const,
    };
    expect(buildUpdateFuelLog(edited, log, TODAY)).toEqual({
      kind: "unchanged",
    });
  });

  it("reports what is wrong", () => {
    const edited = { ...draftFromFuelLog(log, USERS), quantity: "" };
    const result = buildUpdateFuelLog(edited, log, TODAY);
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") expect(result.errors.quantity).toBeTruthy();
  });
});
