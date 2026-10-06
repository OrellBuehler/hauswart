import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { assets, docPages } from "$lib/server/db";
import { shutdownMarkdownWorkers } from "$lib/server/docs/markdown-runner";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, NOW } from "$lib/testing/domain";
import { useTestFilesDir } from "$lib/testing/files";
import { pdfInfo } from "$lib/testing/pdf";
import { SECRET_TEXT, shareFixture } from "$lib/testing/share";
import { getEmergency } from "./emergency";
import { emergencyDocument, exportEmergencyPdf, htmlToBlocks } from "./pdf";

describe("emergency", () => {
  const test = useTestDB();
  useTestFilesDir();
  const ctx = () => ctxAt(test.db);
  afterEach(() => shutdownMarkdownWorkers());

  async function setup() {
    const user = await createTestUser();
    return shareFixture(ctx(), user.id);
  }

  describe("record", () => {
    it("collects emergency and rules pages, emergency contacts and flagged devices", async () => {
      const fx = await setup();
      const e = getEmergency(ctx());
      expect(e.householdName).toBe("Haus Muster");
      expect(e.pages.map((p) => p.title).sort()).toEqual([
        "Hausregeln",
        "Interne Regeln",
        "Wasser abstellen",
      ]);
      expect(e.contacts.map((c) => c.name).sort()).toEqual([
        "Notfall Sanitär",
        "Privat Notfall",
      ]);
      expect(e.assets.map((a) => a.name)).toEqual(["Absperrhahn", "Boiler"]);
      const boiler = e.assets.find((a) => a.id === fx.assets.boiler.id)!;
      expect(boiler.roomName).toBe("Keller");
      expect(boiler.pinnedHints.map((h) => h.title)).toEqual([
        "Sicherung",
        "Interner Hinweis",
      ]);
    });

    it("leaves out howto and general pages, archived pages and archived devices", async () => {
      const fx = await setup();
      test.db
        .update(docPages)
        .set({ archivedAt: new Date(NOW) })
        .where(eq(docPages.id, fx.pages.rules.id))
        .run();
      test.db
        .update(assets)
        .set({ archivedAt: new Date(NOW) })
        .where(eq(assets.id, fx.assets.shutoff.id))
        .run();
      const e = getEmergency(ctx());
      const json = JSON.stringify(e);
      expect(json).not.toContain("Kaffeemaschine");
      expect(json).not.toContain("Allgemeines");
      expect(e.pages.map((p) => p.id)).not.toContain(fx.pages.rules.id);
      expect(e.assets.map((a) => a.name)).toEqual(["Boiler"]);
    });

    it("is empty on a fresh household", () => {
      expect(getEmergency(ctx())).toEqual({
        householdName: "Haushalt",
        pages: [],
        contacts: [],
        assets: [],
      });
    });
  });

  describe("pdf", () => {
    const text = (blocks: unknown) => JSON.stringify(blocks);

    it("leaves secrets out by default", async () => {
      await setup();
      const { content } = await emergencyDocument(ctx(), {
        locale: "de",
        includeSecrets: false,
      });
      const json = text(content);
      expect(json).toContain("Notfall- & Vertretungsblatt");
      expect(json).toContain("Haus Muster");
      expect(json).toContain("Notfall Sanitär");
      expect(json).toContain("044 000 00 01");
      expect(json).toContain("sanitaer@example.org");
      expect(json).toContain("Boiler");
      expect(json).toContain("Sicherung");
      expect(json).toContain("Im Keller.");
      expect(json).toContain("Hahn im Keller");
      expect(json).toContain("Schuhe aus");
      expect(json).not.toContain(SECRET_TEXT);
      expect(json).not.toContain("vertrauliche");
    });

    it("prints secrets only on request and then says so prominently", async () => {
      await setup();
      const { content } = await emergencyDocument(ctx(), {
        locale: "de",
        includeSecrets: true,
      });
      const json = text(content);
      expect(json).toContain(SECRET_TEXT);
      expect(json).toContain("Enthält vertrauliche Angaben");
      // The notice comes first, before any section.
      expect(json.indexOf("vertrauliche")).toBeLessThan(
        json.indexOf("Notfallkontakte"),
      );
    });

    it("lists the emergency contacts and devices, not other contacts or devices", async () => {
      await setup();
      const json = text(
        (
          await emergencyDocument(ctx(), {
            locale: "de",
            includeSecrets: false,
          })
        ).content,
      );
      expect(json).toContain("Privat Notfall");
      for (const absent of ["Nachbarin", "Versteckt", "Kaffeemaschine"]) {
        expect(json, absent).not.toContain(absent);
      }
      expect(json).not.toContain("NOTIZ-KONTAKT");
      expect(json).not.toContain("NOTIZ-GERAET");
      expect(json).not.toContain("SERIAL-GERAET");
    });

    it("speaks the caller's language", async () => {
      await setup();
      const json = text(
        (
          await emergencyDocument(ctx(), {
            locale: "en",
            includeSecrets: true,
          })
        ).content,
      );
      expect(json).toContain("Emergency & cover sheet");
      expect(json).toContain("Emergency contacts");
      expect(json).toContain("Contains confidential information");
    });

    it("says when a section has no entries", async () => {
      const { content } = await emergencyDocument(ctx(), {
        locale: "de",
        includeSecrets: false,
      });
      expect(text(content).match(/Keine Einträge\./g)).toHaveLength(3);
    });

    it("renders a valid A4 pdf, with and without secrets", async () => {
      await setup();
      for (const includeSecrets of [false, true]) {
        const bytes = await exportEmergencyPdf(ctx(), {
          locale: "de",
          includeSecrets,
        });
        const info = pdfInfo(bytes);
        expect(info.header).toBe("%PDF-");
        expect(info.trailer).toBe(true);
        expect(info.pageCount).toBeGreaterThanOrEqual(1);
        expect(info.text).toContain("/MediaBox [0 0 595.28");
        expect(bytes.length).toBeGreaterThan(1500);
      }
    });

    it("makes the same file for the same input", async () => {
      await setup();
      const input = { locale: "de", includeSecrets: false } as const;
      const [a, b] = [
        await exportEmergencyPdf(ctx(), input),
        await exportEmergencyPdf(ctx(), input),
      ];
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    });
  });

  describe("htmlToBlocks", () => {
    const texts = (html: string) =>
      htmlToBlocks(html).map((b) => (b as { text: string }).text);

    it("turns paragraphs, headings, lists and tables into text blocks", () => {
      expect(
        texts(
          "<h2>Titel</h2><p>Erster &amp; zweiter <strong>Satz</strong>.</p><ul><li>eins</li><li>zwei</li></ul><table><tr><td>a</td><td>b</td></tr></table>",
        ),
      ).toEqual(["Titel", "Erster & zweiter Satz.", "• eins\n• zwei", "a | b"]);
      expect(htmlToBlocks("<h2>Titel</h2>")[0]).toMatchObject({ bold: true });
    });

    it("drops markup it does not know and decodes entities only once", () => {
      expect(texts('<div class="x"><p>&lt;b&gt;</p></div>')).toEqual(["<b>"]);
      expect(texts("")).toEqual([]);
    });
  });
});
