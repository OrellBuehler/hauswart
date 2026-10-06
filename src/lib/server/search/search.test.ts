import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { createPageRequestSchema } from "$lib/api/schemas/docs";
import {
  createAsset,
  deleteAsset,
  updateAsset,
} from "$lib/server/assets/assets";
import { assets, rooms, tasks } from "$lib/server/db";
import { shutdownMarkdownWorkers } from "$lib/server/docs/markdown-runner";
import { createPage, deletePage, updatePage } from "$lib/server/docs/pages";
import { createRoom, deleteRoom, updateRoom } from "$lib/server/rooms/rooms";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, makeTask } from "$lib/testing/domain";
import { ftsExpression, search, searchRefs } from "./search";
import { deleteTask, updateTask } from "$lib/server/tasks/tasks";

const SECRET = "tresor-code-4711";

afterEach(() => shutdownMarkdownWorkers());

describe("ftsExpression", () => {
  it.each([
    ["Heizung", '"heizung"*'],
    ["  Heizung   Keller ", '"heizung"* "keller"*'],
    ["Küche-Boiler 2000", '"küche"* "boiler"* "2000"*'],
    ['a" OR "b', '"a"* "or"* "b"*'],
    ["NEAR(x y) AND -z *", '"near"* "x"* "y"* "and"* "z"*'],
    ["col:value", '"col"* "value"*'],
  ])("%j -> %s", (input, expected) => {
    expect(ftsExpression(input)).toBe(expected);
  });

  it("returns null when there is nothing to search for and caps the number of words", () => {
    expect(ftsExpression("")).toBeNull();
    expect(ftsExpression('"*()-:^')).toBeNull();
    expect(ftsExpression("a b c d e f g h i j")!.split(" ")).toHaveLength(8);
    expect(ftsExpression("x".repeat(500))!.length).toBeLessThan(80);
  });
});

describe("search", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db);
  let userId: string | undefined;
  beforeEach(() => {
    userId = undefined;
  });
  const page = async (input: Record<string, unknown>) => {
    userId ??= (await createTestUser()).id;
    return createPage(ctx(), createPageRequestSchema.parse(input), userId!);
  };
  const asset = (input: Record<string, unknown>) =>
    createAsset(ctx(), createAssetRequestSchema.parse(input));
  const find = (q: string, extra: Record<string, unknown> = {}) =>
    search(ctx(), { q, limit: 20, ...extra });

  it("finds pages, assets, rooms and tasks with typed hits, urls and plain snippets", async () => {
    const p = await page({
      title: "Heizung entlüften",
      bodyMd: "Das Ventil im **Keller** öffnen",
    });
    const a = asset({
      name: "Heizkessel",
      manufacturer: "Wärmetech",
      model: "HK-200",
      serialNumber: "SN-123",
      notes: "Heizung im Keller",
    });
    const plant = asset({
      kind: "plant",
      name: "Monstera Heizungsnähe",
      species: "Monstera",
    });
    const r = createRoom(ctx(), {
      name: "Heizungsraum",
      notes: "Kellertür klemmt",
    });
    const t = await makeTask(ctx(), {
      title: "Heizung warten",
      descriptionMd: "Jährlich den Kessel prüfen",
    });

    const hits = find("heizung");
    expect(hits.map((h) => `${h.type}:${h.id}`).sort()).toEqual(
      [
        `page:${p.id}`,
        `asset:${a.id}`,
        `asset:${plant.id}`,
        `room:${r.id}`,
        `task:${t.id}`,
      ].sort(),
    );
    const byType = Object.fromEntries(hits.map((h) => [h.id, h]));
    expect(byType[p.id]).toMatchObject({
      type: "page",
      title: "Heizung entlüften",
      url: `/docs/${p.slug}`,
    });
    expect(byType[a.id]!.url).toBe(`/inventory/${a.id}`);
    expect(byType[plant.id]!.url).toBe(`/plants/${plant.id}`);
    expect(byType[r.id]!.url).toBe(`/rooms/${r.id}`);
    expect(byType[t.id]!.url).toBe(`/tasks/${t.id}`);
    expect(byType[p.id]!.snippet).toContain("Ventil im Keller");
    expect(byType[p.id]!.snippet).not.toContain("**");
  });

  it("searches the documented asset fields", async () => {
    const a = asset({
      name: "Kessel",
      manufacturer: "Wärmetech",
      model: "HK-200",
      serialNumber: "SN-123456",
      notes: "hinten links",
    });
    for (const q of [
      "kessel",
      "wärmetech",
      "hk-200",
      "SN-123456",
      "hinten",
      "SN-12",
    ]) {
      expect(
        find(q).map((h) => h.id),
        q,
      ).toEqual([a.id]);
    }
    expect(find("unauffindbar")).toEqual([]);
  });

  it("matches word prefixes, all words, ignoring case and diacritics", async () => {
    const a = asset({ name: "Waschmaschine", notes: "Schleudern Ablaufpumpe" });
    expect(find("wasch").map((h) => h.id)).toEqual([a.id]);
    expect(find("WASCHMASCHINE schleud").map((h) => h.id)).toEqual([a.id]);
    expect(find("waschmaschine fernseher")).toEqual([]);
    const kueche = createRoom(ctx(), { name: "Küche" });
    expect(find("kuche").map((h) => h.id)).toEqual([kueche.id]);
    expect(find("KÜCHE").map((h) => h.id)).toEqual([kueche.id]);
  });

  it("ranks title matches above body matches", async () => {
    const body = await page({
      title: "Anleitung",
      bodyMd: "Alles über den Thermostat",
    });
    const title = await page({ title: "Thermostat", bodyMd: "kurz" });
    expect(find("thermostat").map((h) => h.id)).toEqual([title.id, body.id]);
    expect(searchRefs(ctx(), "page", "thermostat")).toEqual([
      title.id,
      body.id,
    ]);
  });

  it("filters by type and limits the number of hits", async () => {
    for (const name of ["Lampe A", "Lampe B", "Lampe C"]) asset({ name });
    createRoom(ctx(), { name: "Lampenraum" });
    expect(find("lampe", { type: "room" }).map((h) => h.type)).toEqual([
      "room",
    ]);
    expect(find("lampe", { type: "asset" })).toHaveLength(3);
    expect(find("lampe", { limit: 2 })).toHaveLength(2);
  });

  it("is safe against query syntax", async () => {
    asset({ name: "Normal" });
    for (const q of [
      '"',
      "AND",
      "NEAR(",
      "a OR",
      "*",
      "name:x",
      "'; DROP TABLE assets; --",
      "\\",
      "()",
    ]) {
      expect(() => find(q), q).not.toThrow();
    }
    expect(test.db.select().from(assets).all()).toHaveLength(1);
  });

  describe("secrets", () => {
    it("never indexes secret blocks of pages", async () => {
      const p = await page({
        title: "WLAN",
        bodyMd: `Netzwerk Zuhause\n\n:::secret\nPasswort ${SECRET}\n:::\n\nDanach geht es weiter`,
      });
      expect(find(SECRET)).toEqual([]);
      expect(find("passwort")).toEqual([]);
      expect(find("weiter").map((h) => h.id)).toEqual([p.id]);
      for (const hit of find("netzwerk"))
        expect(hit.snippet).not.toContain(SECRET);
    });

    it("cuts free text of assets, rooms and tasks at the first block when it mentions a secret", async () => {
      const a = asset({
        name: "Router",
        notes: `Steht im Flur\n\n:::secret\nPIN ${SECRET}\n:::\n\nnach dem Block`,
      });
      const r = createRoom(ctx(), {
        name: "Büro",
        notes: `Offen\n\n::: secret\n${SECRET}\n:::`,
      });
      const t = await makeTask(ctx(), {
        title: "Zugang prüfen",
        descriptionMd: `Prüfen\n\n> :::secret\n> ${SECRET}`,
      });
      for (const id of [a.id, r.id, t.id]) expect(id).toBeTruthy();
      expect(find(SECRET)).toEqual([]);
      expect(find("pin")).toEqual([]);
      expect(find("flur").map((h) => h.id)).toEqual([a.id]);
      expect(find("offen").map((h) => h.id)).toEqual([r.id]);
      expect(find("prüfen").map((h) => h.type)).toContain("task");
      for (const hit of [
        ...find("router"),
        ...find("büro"),
        ...find("zugang"),
      ]) {
        expect(hit.snippet).not.toContain(SECRET);
      }
    });

    it("text without a secret keeps its blocks searchable", async () => {
      const a = asset({
        name: "Boiler",
        notes: "Vor\n\n:::warning\nHeiss nach dem Duschen\n:::\n\nEnde",
      });
      expect(find("heiss").map((h) => h.id)).toEqual([a.id]);
    });

    it("a secret added later disappears from the index", async () => {
      const a = asset({ name: "Safe", notes: `Code ${SECRET}` });
      expect(find(SECRET)).toHaveLength(1);
      updateAsset(ctx(), a.id, { notes: `Code\n:::secret\n${SECRET}\n:::` });
      expect(find(SECRET)).toEqual([]);
    });
  });

  describe("the index follows the data", () => {
    it("updates on edit and drops deleted and archived entries", async () => {
      const a = asset({ name: "Alt" });
      const r = createRoom(ctx(), { name: "Altraum" });
      const t = await makeTask(ctx(), { title: "Alte Aufgabe" });
      const p = await page({ title: "Alte Seite" });
      expect(find("alt")).toHaveLength(4);

      updateAsset(ctx(), a.id, { name: "Neu" });
      updateRoom(ctx(), r.id, { name: "Neuraum" });
      await updateTask(ctx(), t.id, { title: "Neue Aufgabe" });
      await updatePage(ctx(), p.slug, { rev: 1, title: "Neue Seite" }, userId!);
      expect(find("alt")).toEqual([]);
      expect(find("neu")).toHaveLength(4);

      updateAsset(ctx(), a.id, { archived: true });
      await updateTask(ctx(), t.id, { archived: true });
      await updatePage(ctx(), p.slug, { rev: 2, archived: true }, userId!);
      expect(find("neu").map((h) => h.type)).toEqual(["room"]);
      updateAsset(ctx(), a.id, { archived: false });
      expect(
        find("neu")
          .map((h) => h.type)
          .sort(),
      ).toEqual(["asset", "room"]);

      deleteAsset(ctx(), a.id);
      deleteRoom(ctx(), r.id);
      deleteTask(ctx(), t.id);
      deletePage(ctx(), p.slug);
      expect(find("neu")).toEqual([]);
      expect(
        test.db.$client.query("select count(*) as n from search_fts").get(),
      ).toEqual({ n: 0 });
    });

    it("does not touch the index for unrelated updates", async () => {
      const a = asset({ name: "Stabil" });
      updateAsset(ctx(), a.id, { showOnEmergency: true });
      expect(find("stabil")).toHaveLength(1);
    });
  });

  it("a hit whose entity is gone is not returned", () => {
    const r = createRoom(ctx(), { name: "Geisterzimmer" });
    // Simulate drift: the row vanishes without the triggers running.
    test.db.$client.run("PRAGMA recursive_triggers = OFF");
    test.db.$client.run("DROP TRIGGER search_rooms_ad");
    test.db.delete(rooms).where(eq(rooms.id, r.id)).run();
    expect(find("geisterzimmer")).toEqual([]);
    void tasks;
  });
});
