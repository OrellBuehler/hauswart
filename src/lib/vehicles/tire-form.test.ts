import { describe, expect, it } from "vitest";
import type { TireSet } from "$lib/api/schemas/tire-sets";
import {
  buildCreateTireSet,
  buildMount,
  buildTread,
  buildUpdateTireSet,
  draftFromTireSet,
  newTireSetDraft,
  type TireSetDraft,
} from "./tire-form";

const TODAY = "2026-10-11";

const set: TireSet = {
  id: "ts1",
  assetId: "a1",
  season: "winter",
  brand: "Beispiel",
  model: "Alpin",
  size: "195/65 R15",
  dot: "2423",
  treadDepthMm: 6.5,
  treadMeasuredOn: "2026-03-01",
  treadWarning: false,
  ageYears: 2.3,
  storageLocation: "Keller",
  storageContactId: "c1",
  storageContactName: "Reifenhotel Beispiel",
  mounted: false,
  mountedOn: null,
  purchasedOn: "2024-10-01",
  retiredAt: null,
  notes: "Felgen aus Stahl",
  distance: 8200,
  odometerUnit: "km",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const draft = (over: Partial<TireSetDraft> = {}): TireSetDraft => ({
  ...newTireSetDraft({ season: "summer", today: TODAY }),
  ...over,
});

describe("newTireSetDraft", () => {
  it("starts with the size of the season and today's date for a measurement", () => {
    expect(
      newTireSetDraft({ season: "winter", today: TODAY, size: "195/65 R15" }),
    ).toMatchObject({
      season: "winter",
      size: "195/65 R15",
      treadMeasuredOn: TODAY,
      dot: "",
      brand: "",
    });
  });
});

describe("draftFromTireSet", () => {
  it("fills the form with the set and never with its tread", () => {
    expect(draftFromTireSet(set)).toMatchObject({
      season: "winter",
      brand: "Beispiel",
      dot: "2423",
      storageContactId: "c1",
      purchasedOn: "2024-10-01",
      treadDepth: "",
    });
  });
});

describe("buildCreateTireSet", () => {
  it("sends the set without a measurement when no depth is typed", () => {
    const { body, errors } = buildCreateTireSet(draft(), TODAY);
    expect(errors).toEqual({});
    expect(body).toEqual({
      season: "summer",
      brand: null,
      model: null,
      size: null,
      dot: null,
      storageLocation: null,
      storageContactId: null,
      purchasedOn: null,
      notes: null,
    });
  });

  it("sends the first measurement with its day", () => {
    const { body } = buildCreateTireSet(
      draft({
        brand: " Beispiel ",
        dot: " 2423 ",
        treadDepth: "7,5",
        treadMeasuredOn: "2026-10-01",
      }),
      TODAY,
    );
    expect(body).toMatchObject({
      brand: "Beispiel",
      dot: "2423",
      treadDepthMm: 7.5,
      treadMeasuredOn: "2026-10-01",
    });
  });

  it("measures today when the day is left empty", () => {
    const { body } = buildCreateTireSet(
      draft({ treadDepth: "8", treadMeasuredOn: "" }),
      TODAY,
    );
    expect(body).toMatchObject({ treadDepthMm: 8, treadMeasuredOn: TODAY });
  });

  it("refuses a DOT code that is no week and year", () => {
    for (const dot of ["24", "0023", "5424", "abcd", "24234"]) {
      const { body, errors } = buildCreateTireSet(draft({ dot }), TODAY);
      expect(body).toBeUndefined();
      expect(errors.dot).toBeTruthy();
    }
  });

  it("refuses a depth that is no number or too deep", () => {
    for (const treadDepth of ["tief", "21", "-1"]) {
      const { body, errors } = buildCreateTireSet(draft({ treadDepth }), TODAY);
      expect(body).toBeUndefined();
      expect(errors.treadDepthMm).toBeTruthy();
    }
  });

  it("refuses a measurement dated in the future", () => {
    const { errors } = buildCreateTireSet(
      draft({ treadDepth: "7", treadMeasuredOn: "2026-10-12" }),
      TODAY,
    );
    expect(errors.treadMeasuredOn).toBeTruthy();
  });

  it("refuses a purchase date that is none", () => {
    const { errors } = buildCreateTireSet(
      draft({ purchasedOn: "2026-13-40" }),
      TODAY,
    );
    expect(errors.purchasedOn).toBeTruthy();
  });
});

describe("buildUpdateTireSet", () => {
  it("sends every field of the form and never the tread", () => {
    const { body, errors } = buildUpdateTireSet(draftFromTireSet(set));
    expect(errors).toEqual({});
    expect(body).toEqual({
      season: "winter",
      brand: "Beispiel",
      model: "Alpin",
      size: "195/65 R15",
      dot: "2423",
      storageLocation: "Keller",
      storageContactId: "c1",
      purchasedOn: "2024-10-01",
      notes: "Felgen aus Stahl",
    });
  });

  it("clears what is emptied", () => {
    const { body } = buildUpdateTireSet(
      draft({ season: "winter", dot: "", storageContactId: null }),
    );
    expect(body).toMatchObject({ dot: null, storageContactId: null });
  });
});

describe("buildMount", () => {
  it("mounts today without a reading when the field is unchanged or empty", () => {
    for (const odometer of ["", "45200"]) {
      expect(
        buildMount({ date: TODAY, odometer, known: 45200, today: TODAY }),
      ).toEqual({ body: { date: TODAY }, errors: {} });
    }
  });

  it("sends a new reading with the mount", () => {
    expect(
      buildMount({
        date: "2026-10-10",
        odometer: "45'350",
        known: 45200,
        today: TODAY,
      }).body,
    ).toEqual({ date: "2026-10-10", odometer: 45350 });
  });

  it("refuses a day in the future, a missing day and a reading that is none", () => {
    expect(
      buildMount({
        date: "2026-10-12",
        odometer: "",
        known: null,
        today: TODAY,
      }).errors.date,
    ).toBeTruthy();
    expect(
      buildMount({ date: "", odometer: "", known: null, today: TODAY }).errors
        .date,
    ).toBeTruthy();
    expect(
      buildMount({ date: TODAY, odometer: "x", known: null, today: TODAY })
        .errors.odometer,
    ).toBeTruthy();
  });
});

describe("buildTread", () => {
  it("needs a depth", () => {
    const { body, errors } = buildTread({
      date: TODAY,
      depth: "",
      odometer: "",
      known: null,
      today: TODAY,
    });
    expect(body).toBeUndefined();
    expect(errors.treadDepthMm).toBeTruthy();
  });

  it("sends the depth, the day and a changed reading", () => {
    expect(
      buildTread({
        date: TODAY,
        depth: "3.5",
        odometer: "45300",
        known: 45200,
        today: TODAY,
      }).body,
    ).toEqual({ date: TODAY, treadDepthMm: 3.5, odometer: 45300 });
  });

  it("leaves the reading out when it is unchanged", () => {
    expect(
      buildTread({
        date: TODAY,
        depth: "3,5",
        odometer: "45200",
        known: 45200,
        today: TODAY,
      }).body,
    ).toEqual({ date: TODAY, treadDepthMm: 3.5 });
  });

  it("refuses a depth beyond what a tire has", () => {
    expect(
      buildTread({
        date: TODAY,
        depth: "25",
        odometer: "",
        known: null,
        today: TODAY,
      }).errors.treadDepthMm,
    ).toBeTruthy();
  });
});
