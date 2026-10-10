import { describe, expect, it } from "vitest";
import type { Asset } from "$lib/api/schemas/assets";
import { emptyFilter, filterAssets, isFiltered } from "./filter";

const TODAY = "2026-10-06";

function asset(over: Partial<Asset> & { name: string }): Asset {
  return {
    id: over.name,
    kind: "device",
    slug: over.name,
    qrSlug: "aaaaaaaaaa",
    roomId: null,
    roomName: null,
    category: null,
    manufacturer: null,
    model: null,
    serialNumber: null,
    purchaseDate: null,
    installedDate: null,
    warrantyUntil: null,
    warrantyExtendedUntil: null,
    warrantySource: "manual",
    showOnEmergency: false,
    notes: null,
    species: null,
    light: null,
    waterNotes: null,
    photoAttachmentId: null,
    photoUrl: null,
    externalSource: null,
    externalRef: null,
    commentCount: 0,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const assets = [
  asset({
    name: "Waschmaschine",
    roomId: "bad",
    roomName: "Bad",
    manufacturer: "Musterwerk",
    model: "WM-1000",
    warrantyUntil: "2027-11-20",
  }),
  asset({
    name: "Backofen",
    roomId: "kueche",
    roomName: "Küche",
    warrantyUntil: "2026-12-01",
  }),
  asset({ name: "Rollo", kind: "fixture", roomId: "bad", roomName: "Bad" }),
  asset({
    name: "Alter Toaster",
    archivedAt: "2026-02-01T00:00:00.000Z",
    warrantyUntil: "2020-01-01",
  }),
];

function names(filter: Partial<typeof emptyFilter>) {
  return filterAssets(assets, { ...emptyFilter, ...filter }, TODAY).map(
    (a) => a.name,
  );
}

describe("filterAssets", () => {
  it("hides archived assets by default", () => {
    expect(names({})).toEqual(["Waschmaschine", "Backofen", "Rollo"]);
    expect(names({ archived: true })).toHaveLength(4);
  });

  it("filters by room and kind", () => {
    expect(names({ roomId: "bad" })).toEqual(["Waschmaschine", "Rollo"]);
    expect(names({ kind: "fixture" })).toEqual(["Rollo"]);
  });

  it("filters by warranty status", () => {
    expect(names({ warranty: "valid" })).toEqual(["Waschmaschine"]);
    expect(names({ warranty: "expiring" })).toEqual(["Backofen"]);
    expect(names({ warranty: "unknown" })).toEqual(["Rollo"]);
    expect(names({ warranty: "expired", archived: true })).toEqual([
      "Alter Toaster",
    ]);
  });

  it("searches every term across the text fields", () => {
    expect(names({ q: "muster 1000" })).toEqual(["Waschmaschine"]);
    expect(names({ q: "küche" })).toEqual(["Backofen"]);
    expect(names({ q: "nothing" })).toEqual([]);
  });

  it("finds a vehicle by its plate, with or without the space", () => {
    const car = asset({
      name: "Familienauto",
      kind: "vehicle",
      vehicle: { plate: "ZH 000000", odometer: null },
    });
    const find = (q: string) =>
      filterAssets([...assets, car], { ...emptyFilter, q }, TODAY).map(
        (a) => a.name,
      );
    expect(find("zh 000000")).toEqual(["Familienauto"]);
    expect(find("ZH000000")).toEqual(["Familienauto"]);
    expect(find("0000")).toEqual(["Familienauto"]);
    expect(find("BE 1")).toEqual([]);
  });
});

describe("isFiltered", () => {
  it("is false for the empty filter", () => {
    expect(isFiltered(emptyFilter)).toBe(false);
    expect(isFiltered({ ...emptyFilter, q: "  " })).toBe(false);
    expect(isFiltered({ ...emptyFilter, kind: "device" })).toBe(true);
  });
});
