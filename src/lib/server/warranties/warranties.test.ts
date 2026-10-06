import { describe, expect, it } from "vitest";
import { createAsset, updateAsset } from "$lib/server/assets/assets";
import { createRoom } from "$lib/server/rooms/rooms";
import { useTestDB } from "$lib/testing/db";
import { at, ctxAt } from "$lib/testing/domain";
import {
  allWarranties,
  dashboardWarranties,
  listWarranties,
  warrantyStatus,
} from "./warranties";

const TODAY = "2026-06-15";

describe("warrantyStatus", () => {
  it.each([
    ["the last day is still covered", "2026-06-15", "expiring", 0],
    ["the day after has expired", "2026-06-14", "expired", -1],
    ["90 days left is expiring", "2026-09-13", "expiring", 90],
    ["91 days left is valid", "2026-09-14", "valid", 91],
    ["tomorrow", "2026-06-16", "expiring", 1],
    ["long ago", "2024-06-15", "expired", -730],
    ["far away", "2030-01-01", "valid", 1296],
  ])("%s", (_name, until, status, daysLeft) => {
    expect(warrantyStatus(until, TODAY)).toEqual({ status, daysLeft });
  });
});

describe("warranty list", () => {
  const test = useTestDB();
  const ctx = (now = at(TODAY)) => ctxAt(test.db, now);
  const page = { limit: 50 };
  const make = (name: string, over: Record<string, unknown> = {}) =>
    createAsset(ctx(), {
      kind: "device",
      name,
      showOnEmergency: false,
      ...over,
    });

  it("is empty without warranty dates", () => {
    make("Ohne");
    expect(allWarranties(ctx())).toEqual([]);
  });

  it("uses the later of the warranty and its extension, or an extension alone", () => {
    make("Verlängert", {
      warrantyUntil: "2026-07-01",
      warrantyExtendedUntil: "2027-07-01",
    });
    make("Nur Ende", { warrantyUntil: "2026-08-01" });
    make("Nur Verlängerung", { warrantyExtendedUntil: "2026-09-01" });
    make("Verkürzt", {
      warrantyUntil: "2026-12-01",
      warrantyExtendedUntil: "2026-10-01",
    });
    const byName = Object.fromEntries(
      allWarranties(ctx()).map((w) => [w.assetName, w.effectiveUntil]),
    );
    expect(byName).toEqual({
      Verlängert: "2027-07-01",
      "Nur Ende": "2026-08-01",
      "Nur Verlängerung": "2026-09-01",
      Verkürzt: "2026-12-01",
    });
  });

  it("sorts by end date, then name, and carries asset details", () => {
    const room = createRoom(ctx(), { name: "Küche" });
    make("B", { warrantyUntil: "2026-08-01" });
    make("A", {
      warrantyUntil: "2026-08-01",
      roomId: room.id,
      manufacturer: "Muster AG",
      model: "X1",
      purchaseDate: "2024-08-01",
    });
    make("Früh", { warrantyUntil: "2026-07-01" });
    const list = allWarranties(ctx());
    expect(list.map((w) => w.assetName)).toEqual(["Früh", "A", "B"]);
    expect(list[1]).toMatchObject({
      roomName: "Küche",
      manufacturer: "Muster AG",
      model: "X1",
      purchaseDate: "2024-08-01",
      status: "expiring",
      daysLeft: 47,
    });
  });

  it("leaves archived assets out", () => {
    const a = make("Archiviert", { warrantyUntil: "2026-08-01" });
    updateAsset(ctx(), a.id, { archived: true });
    expect(allWarranties(ctx())).toEqual([]);
  });

  it("filters by status and pages", () => {
    make("E", { warrantyUntil: "2026-01-01" });
    make("S", { warrantyUntil: "2026-07-01" });
    make("V", { warrantyUntil: "2028-01-01" });
    const names = (status?: "valid" | "expiring" | "expired") =>
      listWarranties(ctx(), { status }, page).items.map((w) => w.assetName);
    expect(names()).toEqual(["E", "S", "V"]);
    expect(names("expired")).toEqual(["E"]);
    expect(names("expiring")).toEqual(["S"]);
    expect(names("valid")).toEqual(["V"]);
    const first = listWarranties(ctx(), {}, { limit: 2 });
    const second = listWarranties(
      ctx(),
      {},
      { limit: 2, cursor: first.nextCursor! },
    );
    expect([first.items.length, second.items.length]).toEqual([2, 1]);
  });

  it("the dashboard shows expiring warranties and those that ended at most 30 days ago", () => {
    make("vor 31 Tagen", { warrantyUntil: "2026-05-15" });
    make("vor 30 Tagen", { warrantyUntil: "2026-05-16" });
    make("gestern", { warrantyUntil: "2026-06-14" });
    make("heute", { warrantyUntil: "2026-06-15" });
    make("in 90 Tagen", { warrantyUntil: "2026-09-13" });
    make("in 91 Tagen", { warrantyUntil: "2026-09-14" });
    expect(dashboardWarranties(ctx()).map((w) => w.assetName)).toEqual([
      "vor 30 Tagen",
      "gestern",
      "heute",
      "in 90 Tagen",
    ]);
  });
});
