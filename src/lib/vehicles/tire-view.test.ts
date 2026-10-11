import { describe, expect, it } from "vitest";
import { mountableSets, mountedSet, tireWarnings } from "./tire-view";

const base = {
  season: "winter" as const,
  treadWarning: false,
  treadDepthMm: 6 as number | null,
  ageYears: 2 as number | null,
  retiredAt: null as string | null,
};

describe("tireWarnings", () => {
  it("warns of nothing for a set in good shape", () => {
    expect(tireWarnings(base)).toEqual([]);
  });

  it("warns of the tread with the limit of the season", () => {
    expect(
      tireWarnings({ ...base, treadWarning: true, treadDepthMm: 3.5 }),
    ).toEqual([{ kind: "tread", depthMm: 3.5, limitMm: 4 }]);
    expect(
      tireWarnings({
        ...base,
        season: "summer",
        treadWarning: true,
        treadDepthMm: 2.5,
      }),
    ).toEqual([{ kind: "tread", depthMm: 2.5, limitMm: 3 }]);
  });

  it("warns of tires six years old or older", () => {
    expect(tireWarnings({ ...base, ageYears: 5.9 })).toEqual([]);
    expect(tireWarnings({ ...base, ageYears: 6 })).toEqual([
      { kind: "age", years: 6 },
    ]);
  });

  it("says both when both apply, tread first", () => {
    expect(
      tireWarnings({
        ...base,
        treadWarning: true,
        treadDepthMm: 2,
        ageYears: 8.4,
      }).map((w) => w.kind),
    ).toEqual(["tread", "age"]);
  });

  it("does not warn of a set that is retired", () => {
    expect(
      tireWarnings({
        ...base,
        treadWarning: true,
        ageYears: 9,
        retiredAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toEqual([]);
  });
});

describe("mountedSet and mountableSets", () => {
  const sets = [
    { id: "a", mounted: true, retiredAt: null },
    { id: "b", mounted: false, retiredAt: null },
    { id: "c", mounted: false, retiredAt: "2026-01-01T00:00:00.000Z" },
  ];

  it("finds the set the vehicle runs on", () => {
    expect(mountedSet(sets)?.id).toBe("a");
    expect(mountedSet([])).toBeUndefined();
  });

  it("offers the sets that are neither on the vehicle nor retired", () => {
    expect(mountableSets(sets).map((s) => s.id)).toEqual(["b"]);
  });
});
