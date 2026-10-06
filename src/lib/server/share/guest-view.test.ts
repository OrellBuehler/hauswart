import { afterEach, describe, expect, it } from "vitest";
import { createGuestLinkRequestSchema } from "$lib/api/schemas/share";
import { assets, docPages } from "$lib/server/db";
import { shutdownMarkdownWorkers } from "$lib/server/docs/markdown-runner";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, NOW } from "$lib/testing/domain";
import { useTestFilesDir } from "$lib/testing/files";
import { SECRET_TEXT, shareFixture } from "$lib/testing/share";
import { eq } from "drizzle-orm";
import { createGuestLink, type GuestLinkRow } from "./guest-links";
import { guestLinks } from "$lib/server/db";
import {
  clearGuestRenderCache,
  getGuestFile,
  getGuestHome,
  getGuestPage,
  pageAccessible,
} from "./guest-view";

const DAY = 86_400_000;
const TOKEN = "T".repeat(43);

describe("guest view", () => {
  const test = useTestDB();
  useTestFilesDir();
  const ctx = () => ctxAt(test.db);
  afterEach(() => {
    clearGuestRenderCache();
    return shutdownMarkdownWorkers();
  });

  async function setup(over: Record<string, unknown> = {}) {
    const user = await createTestUser();
    const fx = await shareFixture(ctx(), user.id);
    const mk = async (extra: Record<string, unknown>) => {
      const { record } = await createGuestLink(
        ctx(),
        user.id,
        "de",
        createGuestLinkRequestSchema.parse({
          label: "Gäste",
          expiresAt: new Date(NOW + DAY).toISOString(),
          ...extra,
        }),
      );
      return test.db
        .select()
        .from(guestLinks)
        .where(eq(guestLinks.id, record.id))
        .get() as GuestLinkRow;
    };
    return { user, fx, link: await mk(over), mk };
  }
  const slugs = (list: { slug: string }[]) => list.map((p) => p.slug);

  describe("home", () => {
    it("shows the household and, per section, only what is flagged guest visible", async () => {
      const { link, fx } = await setup();
      const home = await getGuestHome(ctx(), link, TOKEN);
      expect(home.householdName).toBe("Haus Muster");
      expect(home.emergencyContacts.map((c) => c.name)).toEqual([
        "Notfall Sanitär",
      ]);
      expect(home.contacts.map((c) => c.name)).toEqual(["Nachbarin"]);
      expect(slugs(home.pages.emergency)).toEqual([fx.pages.emergency.slug]);
      expect(slugs(home.pages.rules)).toEqual([fx.pages.rules.slug]);
      expect(slugs(home.pages.howto)).toEqual([fx.pages.howto.slug]);
      expect(home.pages.other).toEqual([]);
      const json = JSON.stringify(home);
      for (const hidden of [
        "Privat Notfall",
        "Versteckt",
        "Interne Regeln",
        "Geheim Seite",
        "HINT-INTERN",
        "Nur intern",
        "Unscheinbar",
        "044 000 00 02",
        "044 000 00 04",
      ]) {
        expect(json, hidden).not.toContain(hidden);
      }
    });

    it("gives guests the contact's name, company, phone and e-mail, never notes or address", async () => {
      const { link } = await setup();
      const [contact] = (await getGuestHome(ctx(), link, TOKEN))
        .emergencyContacts;
      expect(contact).toEqual({
        id: expect.any(String),
        name: "Notfall Sanitär",
        company: "Muster AG",
        phone: "044 000 00 01",
        email: "sanitaer@example.org",
      });
      const json = JSON.stringify(await getGuestHome(ctx(), link, TOKEN));
      expect(json).not.toContain("NOTIZ-KONTAKT");
      expect(json).not.toContain("Strasse 1");
    });

    it("lists devices flagged for emergencies, or carrying a guest-visible hint, with only the guest-visible hints", async () => {
      const { link } = await setup();
      const home = await getGuestHome(ctx(), link, TOKEN);
      expect(home.devices.map((d) => d.name)).toEqual([
        "Absperrhahn",
        "Boiler",
        "Kaffeemaschine",
      ]);
      const boiler = home.devices.find((d) => d.name === "Boiler")!;
      expect(boiler.roomName).toBe("Keller");
      expect(boiler.hints.map((h) => h.title)).toEqual([
        "Sicherung",
        "Wartung",
      ]);
      expect(home.devices.find((d) => d.name === "Absperrhahn")!.hints).toEqual(
        [],
      );
      const json = JSON.stringify(home);
      expect(json).not.toContain("NOTIZ-GERAET");
      expect(json).not.toContain("SERIAL-GERAET");
    });

    it("strips secret blocks from hints unless the link includes secrets", async () => {
      const { link, mk } = await setup();
      const hint = (await getGuestHome(ctx(), link, TOKEN)).devices
        .find((d) => d.name === "Boiler")!
        .hints.find((h) => h.title === "Sicherung")!;
      expect(hint.html).toContain("Im Keller");
      expect(hint.html).not.toContain(SECRET_TEXT);
      const open = await mk({ includeSecrets: true });
      const withSecrets = (await getGuestHome(ctx(), open, TOKEN)).devices
        .find((d) => d.name === "Boiler")!
        .hints.find((h) => h.title === "Sicherung")!;
      expect(withSecrets.html).toContain(SECRET_TEXT);
    });

    it("offers hint files only when guest visible and of a visible hint", async () => {
      const { link, fx } = await setup();
      const boiler = (await getGuestHome(ctx(), link, TOKEN)).devices.find(
        (d) => d.name === "Boiler",
      )!;
      const shared = boiler.hints.find((h) => h.title === "Sicherung")!;
      expect(shared.files.map((f) => f.id)).toEqual([fx.hintFiles.shared.id]);
      expect(JSON.stringify(boiler)).not.toContain(fx.hintFiles.private.id);
      expect(JSON.stringify(boiler)).not.toContain(
        fx.hintFiles.onPrivateHint.id,
      );
    });

    it("follows the link's sections", async () => {
      const { link, fx } = await setup({ sections: ["rules"] });
      const home = await getGuestHome(ctx(), link, TOKEN);
      expect(home.emergencyContacts).toEqual([]);
      expect(home.contacts).toEqual([]);
      expect(home.devices).toEqual([]);
      expect(slugs(home.pages.rules)).toEqual([fx.pages.rules.slug]);
      expect(home.pages.emergency).toEqual([]);
      expect(home.pages.howto).toEqual([]);
    });

    it("lists the emergency contacts once even when contacts are shared too", async () => {
      const { link, mk } = await setup({ sections: ["emergency", "contacts"] });
      const home = await getGuestHome(ctx(), link, TOKEN);
      expect(home.emergencyContacts.map((c) => c.name)).toEqual([
        "Notfall Sanitär",
      ]);
      expect(home.contacts.map((c) => c.name)).toEqual(["Nachbarin"]);
      const contactsOnly = await mk({ sections: ["contacts"] });
      expect(
        (await getGuestHome(ctx(), contactsOnly, TOKEN)).contacts.map(
          (c) => c.name,
        ),
      ).toEqual(["Nachbarin", "Notfall Sanitär"]);
    });

    it("adds pages chosen by id under 'other' when their section is not shared, but only if guest visible", async () => {
      const { fx, mk } = await setup({ sections: ["emergency"] });
      const link = await mk({
        sections: ["emergency"],
        pageIds: [fx.pages.general.id, fx.pages.hiddenGeneral.id],
      });
      const home = await getGuestHome(ctx(), link, TOKEN);
      expect(slugs(home.pages.other)).toEqual([fx.pages.general.slug]);
      expect(JSON.stringify(home)).not.toContain(fx.pages.hiddenGeneral.slug);
    });

    it("drops archived pages and archived devices", async () => {
      const { link, fx } = await setup();
      test.db
        .update(docPages)
        .set({ archivedAt: new Date(NOW) })
        .where(eq(docPages.id, fx.pages.rules.id))
        .run();
      test.db
        .update(assets)
        .set({ archivedAt: new Date(NOW) })
        .where(eq(assets.id, fx.assets.boiler.id))
        .run();
      const home = await getGuestHome(ctx(), link, TOKEN);
      expect(home.pages.rules).toEqual([]);
      expect(home.devices.map((d) => d.name)).not.toContain("Boiler");
    });

    it("is empty when nothing is flagged", async () => {
      const user = await createTestUser();
      const { record } = await createGuestLink(
        ctx(),
        user.id,
        "de",
        createGuestLinkRequestSchema.parse({
          label: "Leer",
          expiresAt: new Date(NOW + DAY).toISOString(),
        }),
      );
      const link = test.db
        .select()
        .from(guestLinks)
        .where(eq(guestLinks.id, record.id))
        .get() as GuestLinkRow;
      expect(await getGuestHome(ctx(), link, TOKEN)).toEqual({
        householdName: "Haushalt",
        emergencyContacts: [],
        contacts: [],
        devices: [],
        pages: { emergency: [], rules: [], howto: [], other: [] },
      });
    });
  });

  describe("pages", () => {
    it("serves the guest rendering with the token filled in", async () => {
      const { link, fx } = await setup();
      const page = (await getGuestPage(
        ctx(),
        link,
        TOKEN,
        fx.pages.howto.slug,
      ))!;
      expect(page.title).toBe("Kaffeemaschine");
      expect(page.html).not.toContain("{token}");
      expect(page.html).toContain(`/g/${TOKEN}/docs/hausregeln`);
      expect(page.html).toContain(
        `/g/${TOKEN}/files/${fx.files.pageShared.id}`,
      );
      expect(page.html).not.toContain(fx.files.pagePrivate.id);
    });

    it("hides secret blocks, headings of them included, unless the link includes secrets", async () => {
      const { link, fx } = await setup();
      const page = (await getGuestPage(
        ctx(),
        link,
        TOKEN,
        fx.pages.emergency.slug,
      ))!;
      expect(page.html).toContain("Hahn im Keller");
      expect(page.html).not.toContain(SECRET_TEXT);
      const open = await setup({ includeSecrets: true });
      const secret = (await getGuestPage(
        ctx(),
        open.link,
        TOKEN,
        open.fx.pages.emergency.slug,
      ))!;
      expect(secret.html).toContain(SECRET_TEXT);
    });

    it("never serves a page that is not guest visible, not in the link, or archived", async () => {
      const { link, fx, mk } = await setup();
      for (const slug of [
        fx.pages.hiddenRules.slug,
        fx.pages.hiddenGeneral.slug,
      ]) {
        expect(await getGuestPage(ctx(), link, TOKEN, slug), slug).toBeNull();
      }
      // A guest-visible page of a section the link does not cover.
      expect(
        await getGuestPage(ctx(), link, TOKEN, fx.pages.general.slug),
      ).toBeNull();
      expect(
        await getGuestPage(ctx(), link, TOKEN, "does-not-exist"),
      ).toBeNull();
      const rulesOnly = await mk({ sections: ["rules"] });
      expect(
        await getGuestPage(ctx(), rulesOnly, TOKEN, fx.pages.emergency.slug),
      ).toBeNull();
      test.db
        .update(docPages)
        .set({ archivedAt: new Date(NOW) })
        .where(eq(docPages.id, fx.pages.rules.id))
        .run();
      expect(
        await getGuestPage(ctx(), link, TOKEN, fx.pages.rules.slug),
      ).toBeNull();
    });

    it("serves an explicitly chosen page of any section while it stays guest visible", async () => {
      const { fx, mk } = await setup();
      const link = await mk({ sections: [], pageIds: [fx.pages.general.id] });
      expect(
        (await getGuestPage(ctx(), link, TOKEN, fx.pages.general.slug))?.title,
      ).toBe("Allgemeines");
      test.db
        .update(docPages)
        .set({ guestVisible: false })
        .where(eq(docPages.id, fx.pages.general.id))
        .run();
      expect(
        await getGuestPage(ctx(), link, TOKEN, fx.pages.general.slug),
      ).toBeNull();
    });

    it("applies the same rule through pageAccessible", async () => {
      const { link, fx } = await setup();
      const rows = test.db.select().from(docPages).all();
      const accessible = rows
        .filter((p) => pageAccessible(link, p))
        .map((p) => p.id);
      expect(accessible.sort()).toEqual(
        [fx.pages.emergency.id, fx.pages.rules.id, fx.pages.howto.id].sort(),
      );
    });
  });

  describe("files", () => {
    it("serves guest-visible files of shared pages and visible hints", async () => {
      const { link, fx } = await setup();
      expect(getGuestFile(ctx(), link, fx.files.pageShared.id)?.id).toBe(
        fx.files.pageShared.id,
      );
      expect(getGuestFile(ctx(), link, fx.files.onRulesPage.id)?.id).toBe(
        fx.files.onRulesPage.id,
      );
      expect(getGuestFile(ctx(), link, fx.hintFiles.shared.id)?.id).toBe(
        fx.hintFiles.shared.id,
      );
    });

    it("refuses everything else, whether it exists or not", async () => {
      const { link, fx } = await setup();
      for (const id of [
        fx.files.pagePrivate.id,
        fx.files.onHiddenPage.id,
        fx.files.onContact.id,
        fx.hintFiles.private.id,
        fx.hintFiles.onPrivateHint.id,
        "nope",
      ]) {
        expect(getGuestFile(ctx(), link, id), id).toBeNull();
      }
    });

    it("follows the link's sections and the page's flag", async () => {
      const { link, fx, mk } = await setup();
      const noDevices = await mk({ sections: ["rules", "howto"] });
      expect(getGuestFile(ctx(), noDevices, fx.hintFiles.shared.id)).toBeNull();
      const emergencyOnly = await mk({ sections: ["emergency"] });
      expect(
        getGuestFile(ctx(), emergencyOnly, fx.files.pageShared.id),
      ).toBeNull();
      test.db
        .update(docPages)
        .set({ guestVisible: false })
        .where(eq(docPages.id, fx.pages.howto.id))
        .run();
      expect(getGuestFile(ctx(), link, fx.files.pageShared.id)).toBeNull();
    });
  });
});
