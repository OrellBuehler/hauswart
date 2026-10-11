import { eq } from "drizzle-orm";
import { createContact } from "$lib/server/contacts/contacts";
import { createContactRequestSchema } from "$lib/api/schemas/contacts";
import { createInsurancePolicyRequestSchema } from "$lib/api/schemas/insurance";
import { createPolicy, updatePolicy } from "$lib/server/insurance/policies";
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

    describe("insurance", () => {
      const text = (blocks: unknown) => JSON.stringify(blocks);
      const policy = (over: Record<string, unknown> = {}) =>
        createPolicy(
          ctx(),
          createInsurancePolicyRequestSchema.parse({
            title: "Hausrat Muster",
            premiumMinor: 48_000,
            startDate: "2026-01-01",
            showOnEmergency: true,
            ...over,
          }),
        );

      it("lists the active policies marked for the page with insurer, number and assistance line", async () => {
        const insurer = createContact(
          ctx(),
          createContactRequestSchema.parse({
            name: "Muster Versicherungen",
            kind: "insurance",
            phone: "000 000 00 01",
          }),
        );
        const kasko = await policy({
          title: "Kasko Kombi",
          insurerContactId: insurer.id,
          policyNumber: "POL-2026-0042",
          assistancePhone: "000 000 00 00",
          notes: "NOTIZ-POLICE",
        });
        await policy({ title: "Alt", showOnEmergency: false });
        const archived = await policy({ title: "Archiviert" });
        await updatePolicy(ctx(), archived.id, { archived: true });
        await policy({ title: "Allein" });
        expect(getEmergency(ctx()).insurance).toEqual([
          {
            id: expect.any(String),
            title: "Allein",
            type: "other",
            insurerName: null,
            insurerPhone: null,
            policyNumber: null,
            assistancePhone: null,
          },
          {
            id: kasko.id,
            title: "Kasko Kombi",
            type: "other",
            insurerName: "Muster Versicherungen",
            insurerPhone: "000 000 00 01",
            policyNumber: "POL-2026-0042",
            assistancePhone: "000 000 00 00",
          },
        ]);
        expect(JSON.stringify(getEmergency(ctx()).insurance)).not.toContain(
          "NOTIZ-POLICE",
        );
      });

      it("prints them on the sheet in a section of their own, only when there are any", async () => {
        const without = text(
          (
            await emergencyDocument(ctx(), {
              locale: "de",
              includeSecrets: false,
            })
          ).content,
        );
        expect(without).not.toContain("Versicherungen");
        const insurer = createContact(
          ctx(),
          createContactRequestSchema.parse({
            name: "Muster Versicherungen",
            phone: "000 000 00 01",
          }),
        );
        await policy({
          title: "Kasko Kombi",
          insurerContactId: insurer.id,
          policyNumber: "POL-2026-0042",
          assistancePhone: "000 000 00 00",
          notes: "NOTIZ-POLICE",
        });
        await policy({ title: "Ohne Angaben" });
        for (const includeSecrets of [false, true]) {
          const { content } = await emergencyDocument(ctx(), {
            locale: "de",
            includeSecrets,
          });
          const json = text(content);
          expect(json).toContain("Versicherungen");
          expect(json).toContain("Kasko Kombi");
          expect(json).toContain("Muster Versicherungen");
          expect(json).toContain("000 000 00 01");
          expect(json).toContain("POL-2026-0042");
          expect(json).toContain("000 000 00 00");
          expect(json).toContain("Ohne Angaben");
          expect(json).not.toContain("NOTIZ-POLICE");
          // The section comes after the contacts and before the places.
          expect(json.indexOf("Notfallkontakte")).toBeLessThan(
            json.indexOf("Versicherungen"),
          );
          expect(json.indexOf("Versicherungen")).toBeLessThan(
            json.indexOf("Wichtige Orte"),
          );
        }
        const en = text(
          (
            await emergencyDocument(ctx(), {
              locale: "en",
              includeSecrets: false,
            })
          ).content,
        );
        expect(en).toContain("Insurance");
        expect(en).toContain("Policy number");
        expect(en).toContain("Assistance line");
      });

      it("renders a valid pdf", async () => {
        await policy({ policyNumber: "POL-2026-0042" });
        const bytes = await exportEmergencyPdf(ctx(), {
          locale: "de",
          includeSecrets: false,
        });
        expect(pdfInfo(bytes).header).toBe("%PDF-");
      });
    });

    it("is empty on a fresh household", () => {
      expect(getEmergency(ctx())).toEqual({
        householdName: "Haushalt",
        pages: [],
        contacts: [],
        assets: [],
        insurance: [],
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
