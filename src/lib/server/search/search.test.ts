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
import { createContactRequestSchema } from "$lib/api/schemas/contacts";
import { createDefectRequestSchema } from "$lib/api/schemas/defects";
import { createHintRequestSchema } from "$lib/api/schemas/hints";
import { createPartRequestSchema } from "$lib/api/schemas/parts";
import {
  createContact,
  deleteContact,
  updateContact,
} from "$lib/server/contacts/contacts";
import {
  createDefect,
  deleteDefect,
  updateDefect,
} from "$lib/server/defects/defects";
import { createHint, deleteHint, updateHint } from "$lib/server/hints/hints";
import { createPart, deletePart, updatePart } from "$lib/server/parts/parts";
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
    expect(byType[a.id]!.url).toBe(`/assets/${a.id}`);
    expect(byType[plant.id]!.url).toBe(`/assets/${plant.id}`);
    expect(byType[r.id]!.url).toBe(`/rooms/${r.id}`);
    expect(byType[t.id]!.url).toBe(`/tasks/${t.id}`);
    expect(byType[p.id]!.snippet).toContain("Ventil im Keller");
    expect(byType[p.id]!.snippet).not.toContain("**");
  });

  describe("defects, contacts, parts and care hints", () => {
    const defect = (input: Record<string, unknown>) =>
      createDefect(
        ctx(),
        createDefectRequestSchema.parse({ title: "Riss", ...input }),
        null,
      );
    const contact = (input: Record<string, unknown>) =>
      createContact(
        ctx(),
        createContactRequestSchema.parse({ name: "Muster AG", ...input }),
      );
    const part = (input: Record<string, unknown>) =>
      createPart(
        ctx(),
        createPartRequestSchema.parse({ name: "Dichtung", ...input }),
        null,
      );
    const hint = (assetId: string, input: Record<string, unknown>) =>
      createHint(
        ctx(),
        assetId,
        createHintRequestSchema.parse({ title: "Tipp", ...input }),
      );

    it("finds them with the route of their detail page", async () => {
      const a = asset({ name: "Geschirrspüler" });
      const d = await defect({
        title: "Sprung im Parkett",
        descriptionMd: "Beim **Fenster** links",
        locationDetail: "Wohnzimmer, Ostseite",
      });
      const c = contact({
        name: "Kaminfeger Meier",
        company: "Russ und Funke GmbH",
        notes: "Kommt im Herbst",
      });
      const p = part({
        name: "Dichtungsring",
        partNumber: "DR-4711-X",
        supplier: "Ersatzteilhandel Nord",
        notes: "Passt auch beim Vorgängermodell",
      });
      const h = hint(a.id, {
        title: "Salz nachfüllen",
        bodyMd: "Regeneriersalz alle zwei Monate",
      });
      const urlOf = (q: string, type: string) => {
        const hits = find(q).filter((hit) => hit.type === type);
        expect(hits, `${type} for ${q}`).toHaveLength(1);
        return hits[0]!.url;
      };
      for (const q of ["parkett", "fenster", "ostseite"]) {
        expect(urlOf(q, "defect")).toBe(`/defects/${d.id}`);
      }
      for (const q of ["kaminfeger", "russ", "herbst"]) {
        expect(urlOf(q, "contact")).toBe(`/contacts/${c.id}`);
      }
      for (const q of [
        "dichtungsring",
        "DR-4711",
        "ersatzteilhandel",
        "vorgänger",
      ]) {
        expect(urlOf(q, "part")).toBe(`/parts/${p.id}`);
      }
      for (const q of ["salz", "regeneriersalz"]) {
        expect(urlOf(q, "asset_hint")).toBe(`/assets/${a.id}`);
      }
      expect(find("salz").find((hit) => hit.type === "asset_hint")!.id).toBe(
        h.id,
      );
      expect(find("parkett", { type: "defect" })).toHaveLength(1);
      expect(find("parkett", { type: "contact" })).toEqual([]);
    });

    it("never indexes a contact's phone, e-mail or address", () => {
      contact({
        name: "Elektro Blitz",
        phone: "044 123 45 67",
        email: "service@blitz-example.org",
        address: "Seestrasse 12, 8000 Beispielstadt",
        url: "https://blitz-example.org",
      });
      for (const q of ["044", "123", "blitz-example", "seestrasse", "8000"]) {
        expect(find(q, { type: "contact" }), q).toEqual([]);
      }
      expect(find("elektro", { type: "contact" })).toHaveLength(1);
    });

    it("cuts markdown and notes at the first block when they mention a secret", async () => {
      const a = asset({ name: "Tresor" });
      await defect({
        title: "Schloss klemmt",
        descriptionMd: `Sichtbar\n\n:::secret\nCode ${SECRET}\n:::`,
      });
      contact({
        name: "Schlüsseldienst",
        notes: `Erreichbar\n:::secret\n${SECRET}\n:::`,
      });
      part({ name: "Zylinder", notes: `Typ A\n::: secret\n${SECRET}` });
      hint(a.id, {
        title: "Öffnen",
        bodyMd: `Kurz\n:::secret\n${SECRET}\n:::`,
      });
      expect(find(SECRET)).toEqual([]);
      for (const q of ["sichtbar", "erreichbar", "typ", "kurz"]) {
        expect(find(q), q).toHaveLength(1);
      }
      expect(find("code")).toEqual([]);
    });

    it("follows edits, archiving and deletion", async () => {
      const a = asset({ name: "Boiler" });
      const d = await defect({ title: "Alt gefunden" });
      const c = contact({ name: "Alt Kontakt" });
      const p = part({ name: "Alt Teil" });
      const h = hint(a.id, { title: "Alt Tipp" });
      expect(find("alt")).toHaveLength(4);

      await updateDefect(ctx(), d.id, { title: "Neu gefunden" });
      updateContact(ctx(), c.id, { name: "Neu Kontakt" });
      updatePart(ctx(), p.id, { name: "Neu Teil" });
      updateHint(ctx(), h.id, { title: "Neu Tipp" });
      expect(find("alt")).toEqual([]);
      expect(find("neu")).toHaveLength(4);

      updatePart(ctx(), p.id, { archived: true });
      expect(find("neu").map((hit) => hit.type)).not.toContain("part");
      updatePart(ctx(), p.id, { archived: false });
      expect(find("neu").map((hit) => hit.type)).toContain("part");

      deleteDefect(ctx(), d.id);
      deleteContact(ctx(), c.id);
      deletePart(ctx(), p.id);
      deleteHint(ctx(), h.id);
      expect(find("neu")).toEqual([]);
    });

    it("drops hints with their asset", () => {
      const a = asset({ name: "Kaffeemaschine" });
      hint(a.id, { title: "Entkalken", bodyMd: "Alle drei Monate" });
      expect(find("entkalken")).toHaveLength(1);
      deleteAsset(ctx(), a.id);
      expect(find("entkalken")).toEqual([]);
    });
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
