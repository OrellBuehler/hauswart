import { describe, expect, it } from "vitest";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { ApiError } from "$lib/api/errors";
import { tasks } from "$lib/server/db";
import { createRoom } from "$lib/server/rooms/rooms";
import { ctxAt, makeTask } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import {
  createAsset,
  deleteAsset,
  generateQrSlug,
  getAsset,
  getAssetByQr,
  listAssets,
  updateAsset,
} from "./assets";

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as ApiError).code;
  }
  return null;
};

describe("assets", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db);
  const asset = (input: Record<string, unknown>) =>
    createAsset(ctx(), createAssetRequestSchema.parse(input));

  it("generates 10-character base32 QR slugs that differ", () => {
    const slugs = new Set(Array.from({ length: 200 }, generateQrSlug));
    expect(slugs.size).toBe(200);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z2-7]{10}$/);
  });

  it("creates with defaults, a name-derived slug and its own QR slug", () => {
    const a = asset({ name: "Kühlschrank" });
    expect(a).toMatchObject({
      kind: "device",
      slug: "kuehlschrank",
      showOnEmergency: false,
      roomId: null,
      roomName: null,
      archivedAt: null,
    });
    expect(a.qrSlug).toMatch(/^[a-z2-7]{10}$/);
    expect(a.qrSlug).not.toBe(a.slug);
    expect(asset({ name: "Kühlschrank" }).slug).toBe("kuehlschrank-2");
  });

  it("resolves an asset by QR slug, archived or not", () => {
    const a = asset({ name: "Backofen" });
    expect(getAssetByQr(ctx(), a.qrSlug).id).toBe(a.id);
    updateAsset(ctx(), a.id, { archived: true });
    expect(getAssetByQr(ctx(), a.qrSlug).archivedAt).not.toBeNull();
    expect(codeOf(() => getAssetByQr(ctx(), "aaaaaaaaaa"))).toBe("not_found");
  });

  it("carries the room name and rejects an unknown room", () => {
    const room = createRoom(ctx(), { name: "Küche" });
    expect(asset({ name: "Herd", roomId: room.id }).roomName).toBe("Küche");
    expect(codeOf(() => asset({ name: "Herd", roomId: "nope" }))).toBe(
      "invalid_request",
    );
    const a = asset({ name: "Mixer" });
    expect(codeOf(() => updateAsset(ctx(), a.id, { roomId: "nope" }))).toBe(
      "invalid_request",
    );
  });

  it("filters by kind, room, search text and archive state", () => {
    const kitchen = createRoom(ctx(), { name: "Küche" });
    const living = createRoom(ctx(), { name: "Wohnzimmer" });
    asset({ name: "Backofen", roomId: kitchen.id, manufacturer: "Muster AG" });
    asset({
      name: "Monstera",
      kind: "plant",
      roomId: living.id,
      species: "Monstera deliciosa",
    });
    const old = asset({ name: "Alter Toaster", roomId: kitchen.id });
    updateAsset(ctx(), old.id, { archived: true });
    const names = (filter: Parameters<typeof listAssets>[1]) =>
      listAssets(ctx(), filter, { limit: 50 }).items.map((a) => a.name);

    expect(names({})).toEqual(["Backofen", "Monstera"]);
    expect(names({ includeArchived: true })).toEqual([
      "Alter Toaster",
      "Backofen",
      "Monstera",
    ]);
    expect(names({ kind: "plant" })).toEqual(["Monstera"]);
    expect(names({ roomId: kitchen.id })).toEqual(["Backofen"]);
    expect(names({ q: "muster" })).toEqual(["Backofen"]);
    expect(names({ q: "deliciosa" })).toEqual(["Monstera"]);
    expect(names({ q: "100%" })).toEqual([]);
    expect(names({ q: "_" })).toEqual([]);
  });

  it("archives and restores, keeping the first archive time", () => {
    const a = asset({ name: "Boiler" });
    const archived = updateAsset(ctx(), a.id, { archived: true });
    expect(archived.archivedAt).toBeInstanceOf(Date);
    const again = updateAsset({ db: test.db, now: ctx().now + 5000 }, a.id, {
      archived: true,
    });
    expect(again.archivedAt?.getTime()).toBe(archived.archivedAt?.getTime());
    expect(updateAsset(ctx(), a.id, { archived: false }).archivedAt).toBeNull();
  });

  it("updates plant fields and clears with null", () => {
    const a = asset({
      name: "Ficus",
      kind: "plant",
      species: "Ficus",
      light: "hell",
    });
    const updated = updateAsset(ctx(), a.id, {
      species: null,
      waterNotes: "wöchentlich",
    });
    expect(updated).toMatchObject({
      species: null,
      light: "hell",
      waterNotes: "wöchentlich",
    });
  });

  it("conflicts on a taken explicit slug", () => {
    asset({ name: "A", slug: "gleich" });
    const b = asset({ name: "B" });
    expect(codeOf(() => asset({ name: "C", slug: "gleich" }))).toBe("conflict");
    expect(codeOf(() => updateAsset(ctx(), b.id, { slug: "gleich" }))).toBe(
      "conflict",
    );
  });

  it("deleting detaches tasks and 404s for unknown ids", async () => {
    const a = asset({ name: "Dampfabzug" });
    const task = await makeTask(ctx(), { assetId: a.id });
    expect(task.assetName).toBe("Dampfabzug");
    deleteAsset(ctx(), a.id);
    expect(test.db.select().from(tasks).get()?.assetId).toBeNull();
    expect(codeOf(() => getAsset(ctx(), a.id))).toBe("not_found");
    expect(codeOf(() => deleteAsset(ctx(), a.id))).toBe("not_found");
  });
});
