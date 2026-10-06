import { afterEach, describe, expect, it } from "vitest";
import { shutdownMarkdownWorkers } from "$lib/server/docs/markdown-runner";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt } from "$lib/testing/domain";
import { useTestFilesDir } from "$lib/testing/files";
import { pdfInfo } from "$lib/testing/pdf";
import { SECRET_TEXT, shareFixture } from "$lib/testing/share";

type Emergency = {
  household: { name: string };
  pages: {
    slug: string;
    title: string;
    section: string;
    renderedHtml: string;
  }[];
  contacts: { name: string; emergency: boolean; notes: string | null }[];
  assets: {
    name: string;
    roomName: string | null;
    pinnedHints: { title: string; bodyMd: string }[];
  }[];
};

describe("emergency API", () => {
  const test = useTestDB();
  useTestFilesDir();
  afterEach(() => shutdownMarkdownWorkers());

  async function setup(locale: "de" | "en" = "de") {
    const user = await createTestUser({ locale });
    await shareFixture(ctxAt(test.db, Date.now()), user.id);
    return {
      user,
      call: createCaller({ session: loginTestUser(user).token }),
    };
  }

  it("gives members everything for the emergency page, secrets included", async () => {
    const { call } = await setup();
    const r = await call("GET", "/api/v1/emergency");
    expect(r.res.status).toBe(200);
    const e = r.body as Emergency;
    expect(e.household.name).toBe("Haus Muster");
    expect(e.pages.map((p) => p.title).sort()).toEqual([
      "Hausregeln",
      "Interne Regeln",
      "Wasser abstellen",
    ]);
    expect(
      e.pages.every((p) => ["emergency", "rules"].includes(p.section)),
    ).toBe(true);
    expect(
      e.pages.find((p) => p.title === "Wasser abstellen")!.renderedHtml,
    ).toContain(SECRET_TEXT);
    // Full contacts, whether or not they are shared with guests.
    expect(e.contacts.map((c) => c.name).sort()).toEqual([
      "Notfall Sanitär",
      "Privat Notfall",
    ]);
    expect(e.contacts.every((c) => c.emergency)).toBe(true);
    expect(e.contacts.find((c) => c.name === "Notfall Sanitär")!.notes).toBe(
      "NOTIZ-KONTAKT",
    );
    expect(e.assets.map((a) => a.name)).toEqual(["Absperrhahn", "Boiler"]);
    expect(e.assets[1]).toMatchObject({ roomName: "Keller" });
    expect(e.assets[1].pinnedHints.map((h) => h.title)).toEqual([
      "Sicherung",
      "Interner Hinweis",
    ]);
    expect(e.assets[1].pinnedHints[0].bodyMd).toContain(SECRET_TEXT);
    expect(r.res.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(e)).not.toContain("NOTIZ-GERAET");
  });

  it("is open to a read token and refuses one without the scope", async () => {
    const { user } = await setup();
    const ok = createCaller({
      bearer: createTestToken(user, { kind: "mcp", scopes: ["read"] }).token,
    });
    expect((await ok("GET", "/api/v1/emergency")).res.status).toBe(200);
    expect((await ok("GET", "/api/v1/emergency/export.pdf")).res.status).toBe(
      200,
    );
    const none = createCaller({
      bearer: createTestToken(user, { kind: "mcp", scopes: ["write"] }).token,
    });
    expect(errorCode(await none("GET", "/api/v1/emergency"))).toBe("forbidden");
    expect(errorCode(await none("GET", "/api/v1/emergency/export.pdf"))).toBe(
      "forbidden",
    );
  });

  describe("pdf", () => {
    it("downloads an A4 pdf with no-store headers", async () => {
      const { call } = await setup();
      const r = await call("GET", "/api/v1/emergency/export.pdf");
      expect(r.res.status).toBe(200);
      expect(r.res.headers.get("content-type")).toBe("application/pdf");
      expect(r.res.headers.get("content-disposition")).toMatch(
        /^attachment; filename="emergency-\d{4}-\d{2}-\d{2}\.pdf"$/,
      );
      expect(r.res.headers.get("cache-control")).toBe("no-store");
      const info = pdfInfo(r.body as Uint8Array);
      expect(info.header).toBe("%PDF-");
      expect(info.trailer).toBe(true);
      expect(info.text).toContain("/MediaBox [0 0 595.28");
    });

    it("accepts includeSecrets as 1 or true and refuses other values", async () => {
      const { call } = await setup();
      for (const value of ["1", "true", "0", "false"]) {
        const r = await call(
          "GET",
          `/api/v1/emergency/export.pdf?includeSecrets=${value}`,
        );
        expect(r.res.status, value).toBe(200);
      }
      expect(
        errorCode(
          await call("GET", "/api/v1/emergency/export.pdf?includeSecrets=yes"),
        ),
      ).toBe("invalid_request");
    });

    it("makes a different (larger) sheet with secrets than without", async () => {
      const { call } = await setup();
      const plain = (await call("GET", "/api/v1/emergency/export.pdf"))
        .body as Uint8Array;
      const secret = (
        await call("GET", "/api/v1/emergency/export.pdf?includeSecrets=1")
      ).body as Uint8Array;
      expect(secret.length).not.toBe(plain.length);
    });
  });
});
