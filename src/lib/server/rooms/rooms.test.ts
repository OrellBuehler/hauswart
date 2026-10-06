import { describe, expect, it } from "vitest";
import { ApiError } from "$lib/api/errors";
import { assets, tasks } from "$lib/server/db";
import { createAsset } from "$lib/server/assets/assets";
import { ctxAt, makeTask } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import {
  createRoom,
  deleteRoom,
  getRoom,
  listRooms,
  updateRoom,
} from "./rooms";

describe("rooms", () => {
  const test = useTestDB();
  const room = (name: string, extra = {}) =>
    createRoom(ctxAt(test.db), { name, ...extra });

  it("derives a unique slug from the name", () => {
    expect(room("Küche").slug).toBe("kueche");
    expect(room("Küche").slug).toBe("kueche-2");
    expect(room("Bad", { slug: "wc" }).slug).toBe("wc");
  });

  it("refuses a duplicate explicit slug with a conflict", () => {
    room("Bad", { slug: "bad" });
    expect(() => room("Anderes Bad", { slug: "bad" })).toThrow(ApiError);
    try {
      room("Anderes Bad", { slug: "bad" });
    } catch (err) {
      expect((err as ApiError).code).toBe("conflict");
    }
  });

  it("numbers rooms in creation order unless told otherwise", () => {
    expect(room("A").sortOrder).toBe(0);
    expect(room("B").sortOrder).toBe(1);
    expect(room("C", { sortOrder: 40 }).sortOrder).toBe(40);
  });

  it("lists by sort order then name and pages", () => {
    room("Zimmer", { sortOrder: 1 });
    room("Bad", { sortOrder: 2 });
    room("Arbeitszimmer", { sortOrder: 2 });
    const first = listRooms(ctxAt(test.db), { limit: 2 });
    expect(first.items.map((r) => r.name)).toEqual(["Zimmer", "Arbeitszimmer"]);
    const second = listRooms(ctxAt(test.db), {
      limit: 2,
      cursor: first.nextCursor as string,
    });
    expect(second.items.map((r) => r.name)).toEqual(["Bad"]);
    expect(second.nextCursor).toBeNull();
  });

  it("updates fields, clearing with null", () => {
    const r = room("Keller", { icon: "box", notes: "feucht" });
    const updated = updateRoom(ctxAt(test.db), r.id, {
      name: "Kellerabteil",
      icon: null,
    });
    expect(updated).toMatchObject({
      name: "Kellerabteil",
      icon: null,
      notes: "feucht",
      slug: "keller",
    });
  });

  it("refuses to move a room onto another room's slug", () => {
    room("Bad");
    const other = room("Küche");
    expect(() => updateRoom(ctxAt(test.db), other.id, { slug: "bad" })).toThrow(
      /slug already exists/,
    );
    expect(updateRoom(ctxAt(test.db), other.id, { slug: "kueche" }).slug).toBe(
      "kueche",
    );
  });

  it("404s for unknown rooms", () => {
    for (const run of [
      () => getRoom(ctxAt(test.db), "nope"),
      () => updateRoom(ctxAt(test.db), "nope", { name: "x" }),
      () => deleteRoom(ctxAt(test.db), "nope"),
    ]) {
      try {
        run();
        expect.unreachable();
      } catch (err) {
        expect((err as ApiError).code).toBe("not_found");
      }
    }
  });

  it("deleting a room detaches its assets and tasks instead of deleting them", async () => {
    const ctx = ctxAt(test.db);
    const r = room("Bad");
    const asset = createAsset(
      ctx,
      createAssetRequestSchema.parse({ name: "Waschmaschine", roomId: r.id }),
    );
    const task = await makeTask(ctx, { roomId: r.id });
    deleteRoom(ctx, r.id);
    expect(test.db.select().from(assets).get()?.roomId).toBeNull();
    expect(test.db.select().from(tasks).get()?.roomId).toBeNull();
    expect(asset.id).toBeDefined();
    expect(task.id).toBeDefined();
  });
});
