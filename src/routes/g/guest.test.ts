import { isHttpError, isRedirect, type RequestEvent } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createGuestLinkRequestSchema } from "$lib/api/schemas/share";
import {
  SHARE_MISSES_PER_WINDOW,
  SHARE_REQUESTS_PER_MINUTE,
} from "$lib/server/auth/rate-limit";
import { guestLinks } from "$lib/server/db";
import { shutdownMarkdownWorkers } from "$lib/server/docs/markdown-runner";
import { GUEST_COOKIE } from "$lib/server/share/guest-access";
import {
  createGuestLink,
  MAX_PIN_FAILURES,
  revokeGuestLink,
  rotateGuestLink,
  updateGuestLink,
} from "$lib/server/share/guest-links";
import { clearGuestRenderCache } from "$lib/server/share/guest-view";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt } from "$lib/testing/domain";
import { useTestFilesDir } from "$lib/testing/files";
import { SECRET_TEXT, shareFixture } from "$lib/testing/share";
import { callRoute, type RouteResult } from "$lib/testing/route";
import * as filesRoute from "./[token]/files/[id]/+server";
import * as homeRoute from "./[token]/+page.server";
import * as docsRoute from "./[token]/docs/[slug]/+page.server";

const DAY = 86_400_000;
const GONE = "gone";

type Home = {
  locked: boolean;
  locale: string;
  secrets?: boolean;
  home?: {
    householdName: string;
    emergencyContacts: { name: string }[];
    contacts: { name: string }[];
    devices: { name: string; hints: { title: string; html: string }[] }[];
    pages: Record<string, { slug: string; title: string }[]>;
  };
};

/** Runs a page load or form action the way SvelteKit would and answers with a Response. */
function respond(run: (event: never) => unknown) {
  return async (event: RequestEvent): Promise<Response> => {
    try {
      const out = await run(event as never);
      if (out instanceof Response) return out;
      return new Response(JSON.stringify(out ?? null), {
        headers: { "content-type": "application/json" },
      });
    } catch (err) {
      if (isRedirect(err)) {
        return new Response(null, {
          status: err.status,
          headers: { location: err.location },
        });
      }
      if (isHttpError(err)) {
        return new Response(err.body.message, { status: err.status });
      }
      throw err;
    }
  };
}

describe("guest pages", () => {
  const test = useTestDB();
  useTestFilesDir();
  const ctx = (now = Date.now()) => ctxAt(test.db, now);
  afterEach(() => {
    clearGuestRenderCache();
    return shutdownMarkdownWorkers();
  });

  async function setup(over: Record<string, unknown> = {}) {
    const user = await createTestUser();
    const fx = await shareFixture(ctx(), user.id);
    const mk = async (extra: Record<string, unknown> = {}) => {
      const { record, token } = await createGuestLink(
        ctx(),
        user.id,
        "de",
        createGuestLinkRequestSchema.parse({
          label: "Gäste",
          expiresAt: new Date(Date.now() + 7 * DAY).toISOString(),
          ...extra,
        }),
      );
      return { record, token };
    };
    return { user, fx, mk, ...(await mk(over)) };
  }

  const url = (token: string, rest = "") =>
    `http://localhost/g/${token}${rest}`;
  const opts = (
    token: string,
    extra: {
      cookie?: string;
      ip?: string;
      params?: Record<string, string>;
      form?: Record<string, string>;
    } = {},
  ) => ({
    params: { token, ...extra.params },
    ...(extra.cookie ? { cookies: { [GUEST_COOKIE]: extra.cookie } } : {}),
    ...(extra.ip ? { ip: extra.ip } : {}),
    ...(extra.form ? { form: extra.form } : {}),
  });
  const home = (token: string, extra = {}) =>
    callRoute(respond(homeRoute.load as never), {
      url: url(token),
      ...opts(token, extra),
    });
  const unlock = (token: string, pin: string, ip?: string) =>
    callRoute(respond(homeRoute.actions.default as never), {
      url: url(token),
      method: "POST",
      ...opts(token, { form: { pin }, ip }),
    });
  const doc = (token: string, slug: string, extra = {}) =>
    callRoute(respond(docsRoute.load as never), {
      url: url(token, `/docs/${slug}`),
      ...opts(token, { ...extra, params: { slug } }),
    });
  const file = (token: string, id: string, extra = {}) =>
    callRoute(respond(filesRoute.GET as never), {
      url: url(token, `/files/${id}`),
      ...opts(token, { ...extra, params: { id } }),
    });
  const cookieOf = (r: RouteResult) => r.cookies.get(GUEST_COOKIE);
  const bytesOf = (r: RouteResult) => r.body as Uint8Array;

  describe("headers", () => {
    it("never caches, never indexes and sends no referrer: on pages, files and errors", async () => {
      const { token, fx } = await setup();
      const responses = [
        await home(token),
        await doc(token, fx.pages.rules.slug),
        await file(token, fx.files.pageShared.id),
        await home("x".repeat(43)),
        await file(token, "nope"),
      ];
      for (const r of responses) {
        expect(r.res.headers.get("cache-control")).toBe("no-store");
        expect(r.res.headers.get("x-robots-tag")).toBe(
          "noindex, nofollow, noarchive",
        );
        expect(r.res.headers.get("referrer-policy")).toBe("no-referrer");
        expect(r.res.headers.get("x-frame-options")).toBe("DENY");
        expect(r.res.headers.get("x-content-type-options")).toBe("nosniff");
      }
    });
  });

  describe("start page", () => {
    it("shows what the link covers, in the link's language, without a login", async () => {
      const { token } = await setup();
      const r = await home(token);
      expect(r.res.status).toBe(200);
      const data = r.body as Home;
      expect(data).toMatchObject({
        locked: false,
        locale: "de",
        secrets: false,
      });
      expect(data.home!.householdName).toBe("Haus Muster");
      expect(data.home!.emergencyContacts.map((c) => c.name)).toEqual([
        "Notfall Sanitär",
      ]);
      expect(data.home!.devices.map((d) => d.name)).toContain("Boiler");
      expect(JSON.stringify(data)).not.toContain(SECRET_TEXT);
      expect(JSON.stringify(data)).not.toContain("Privat Notfall");
    });

    it("tells the page to warn about secrets when the link includes them", async () => {
      const { token } = await setup({ includeSecrets: true });
      const data = (await home(token)).body as Home;
      expect(data.secrets).toBe(true);
      expect(JSON.stringify(data)).toContain(SECRET_TEXT);
    });

    it("counts a visit at most every ten minutes", async () => {
      const { token } = await setup();
      await home(token);
      await home(token);
      const row = () => test.db.select().from(guestLinks).get()!;
      expect(row().viewCount).toBe(1);
      expect(row().lastViewedAt).not.toBeNull();
    });
  });

  describe("a link that is not open", () => {
    it("answers every kind of dead link alike: unknown, malformed, revoked, expired, scheduled, replaced", async () => {
      const { user, mk, token, record, fx } = await setup();
      const revoked = await mk();
      revokeGuestLink(ctx(), revoked.record.id);
      const expired = await mk();
      test.db
        .update(guestLinks)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(guestLinks.id, expired.record.id))
        .run();
      const scheduled = await mk({
        startsAt: new Date(Date.now() + DAY).toISOString(),
      });
      const replaced = await mk();
      rotateGuestLink(ctx(), replaced.record.id);
      const closed = await mk({ pin: "4711" });
      test.db
        .update(guestLinks)
        .set({ pinFailures: MAX_PIN_FAILURES })
        .where(eq(guestLinks.id, closed.record.id))
        .run();
      void user;
      void record;
      const dead = [
        "x".repeat(43),
        "short",
        "..%2f..%2fetc",
        revoked.token,
        expired.token,
        scheduled.token,
        replaced.token,
        closed.token,
      ];
      const seen = new Set<string>();
      for (const t of dead) {
        for (const r of [
          await home(t),
          await doc(t, fx.pages.rules.slug),
          await file(t, fx.files.pageShared.id),
        ]) {
          expect([r.res.status, String(r.body).includes(GONE)], t).toEqual([
            404,
            true,
          ]);
          seen.add(`${r.res.status}|${r.res.headers.get("cache-control")}`);
        }
      }
      expect(seen.size).toBe(1);
      expect((await home(token)).res.status).toBe(200);
    });

    it("reopens when the expiry is extended", async () => {
      const { token, record } = await setup();
      test.db
        .update(guestLinks)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(guestLinks.id, record.id))
        .run();
      expect((await home(token)).res.status).toBe(404);
      await updateGuestLink(ctx(), record.id, {
        expiresAt: new Date(Date.now() + DAY).toISOString(),
      });
      expect((await home(token)).res.status).toBe(200);
    });

    it("opens exactly at its start", async () => {
      const { mk } = await setup();
      const soon = await mk({
        startsAt: new Date(Date.now() + 60_000).toISOString(),
      });
      expect((await home(soon.token)).res.status).toBe(404);
      test.db
        .update(guestLinks)
        .set({ startsAt: new Date(Date.now() - 1) })
        .where(eq(guestLinks.id, soon.record.id))
        .run();
      expect((await home(soon.token)).res.status).toBe(200);
    });
  });

  describe("PIN gate", () => {
    it("shows nothing but the PIN form before the PIN is entered", async () => {
      const { token, fx } = await setup({ pin: "4711" });
      const data = (await home(token)).body as Home;
      expect(data).toEqual({ locked: true, locale: "de" });
      expect(
        ((await doc(token, fx.pages.rules.slug)).body as Home).locked,
      ).toBe(true);
      expect((await file(token, fx.files.pageShared.id)).res.status).toBe(404);
    });

    it("rejects a wrong PIN without a cookie and says nothing more", async () => {
      const { token } = await setup({ pin: "4711" });
      const r = await unlock(token, "0000");
      expect(r.body).toMatchObject({ status: 400, data: { error: "wrong" } });
      expect(cookieOf(r)).toBeUndefined();
    });

    it("accepts the right PIN: a cookie scoped to this link, then the content", async () => {
      const { token, fx } = await setup({ pin: "4711" });
      const r = await unlock(token, "4711");
      expect(r.res.status).toBe(303);
      expect(r.res.headers.get("location")).toBe(`/g/${token}`);
      const cookie = cookieOf(r)!;
      expect(cookie).toBeTruthy();
      expect(r.cookies.options(GUEST_COOKIE)).toMatchObject({
        path: `/g/${token}`,
        httpOnly: true,
        sameSite: "lax",
      });
      const opened = (await home(token, { cookie })).body as Home;
      expect(opened.locked).toBe(false);
      expect(opened.home!.householdName).toBe("Haus Muster");
      expect(
        (
          (await doc(token, fx.pages.rules.slug, { cookie })).body as {
            locked: boolean;
          }
        ).locked,
      ).toBe(false);
      expect(
        (await file(token, fx.files.pageShared.id, { cookie })).res.status,
      ).toBe(200);
    });

    it("redirects back to the page it was posted from", async () => {
      const { token, fx } = await setup({ pin: "4711" });
      const r = await callRoute(respond(docsRoute.actions.default as never), {
        url: url(token, `/docs/${fx.pages.rules.slug}`),
        method: "POST",
        ...opts(token, {
          form: { pin: "4711" },
          params: { slug: fx.pages.rules.slug },
        }),
      });
      expect(r.res.headers.get("location")).toBe(
        `/g/${token}/docs/${fx.pages.rules.slug}`,
      );
    });

    it("does not carry over to another link, a changed PIN or a forged cookie", async () => {
      const { token, mk, record } = await setup({ pin: "4711" });
      const other = await mk({ pin: "4711" });
      const cookie = cookieOf(await unlock(token, "4711"))!;
      expect(((await home(other.token, { cookie })).body as Home).locked).toBe(
        true,
      );
      expect(
        ((await home(token, { cookie: `${cookie}0` })).body as Home).locked,
      ).toBe(true);
      expect(
        ((await home(token, { cookie: "9999999999999.abc" })).body as Home)
          .locked,
      ).toBe(true);
      await updateGuestLink(ctx(), record.id, { pin: "4711" });
      expect(((await home(token, { cookie })).body as Home).locked).toBe(true);
    });

    it("ignores the PIN form on a link without PIN", async () => {
      const { token } = await setup();
      const r = await unlock(token, "4711");
      expect(r.res.status).toBe(303);
      expect(cookieOf(r)).toBeUndefined();
    });

    it("limits wrong guesses per link and address, and answers limited", async () => {
      const { token } = await setup({ pin: "4711" });
      for (let i = 0; i < 5; i += 1) {
        expect((await unlock(token, "0000")).body).toMatchObject({
          status: 400,
        });
      }
      const limited = await unlock(token, "4711");
      expect(limited.body).toMatchObject({
        status: 429,
        data: { error: "limited" },
      });
      expect(cookieOf(limited)).toBeUndefined();
      // Another address has its own budget and the right PIN gets in.
      const elsewhere = await unlock(token, "4711", "198.51.100.5");
      expect(elsewhere.res.status).toBe(303);
      expect(cookieOf(elsewhere)).toBeTruthy();
    });

    it("closes the link for good after too many wrong PINs, until a member sets a PIN", async () => {
      const { token, record } = await setup({ pin: "4711" });
      test.db
        .update(guestLinks)
        .set({ pinFailures: MAX_PIN_FAILURES - 1 })
        .run();
      await unlock(token, "0000");
      expect((await home(token)).res.status).toBe(404);
      expect((await unlock(token, "4711", "198.51.100.8")).res.status).toBe(
        404,
      );
      await updateGuestLink(ctx(), record.id, { pin: "4711" });
      expect(((await home(token)).body as Home).locked).toBe(true);
    });
  });

  describe("pages", () => {
    it("serves a shared page with links pointing back into the link", async () => {
      const { token, fx } = await setup();
      const r = await doc(token, fx.pages.howto.slug);
      expect(r.res.status).toBe(200);
      const data = r.body as { page: { title: string; html: string } };
      expect(data.page.title).toBe("Kaffeemaschine");
      expect(data.page.html).toContain(`/g/${token}/docs/hausregeln`);
      expect(data.page.html).toContain(
        `/g/${token}/files/${fx.files.pageShared.id}`,
      );
      expect(data.page.html).not.toContain("{token}");
    });

    it("answers 404 'page' for pages the link does not share, and nothing more", async () => {
      const { token, fx } = await setup();
      for (const slug of [
        fx.pages.hiddenRules.slug,
        fx.pages.hiddenGeneral.slug,
        fx.pages.general.slug,
        "nope",
      ]) {
        const r = await doc(token, slug);
        expect([r.res.status, r.body], slug).toEqual([404, "page"]);
      }
    });

    it("keeps secret blocks out unless the link includes them", async () => {
      const { token, fx, mk } = await setup();
      const plain = await doc(token, fx.pages.emergency.slug);
      expect(JSON.stringify(plain.body)).not.toContain(SECRET_TEXT);
      const open = await mk({ includeSecrets: true });
      const secret = await doc(open.token, fx.pages.emergency.slug);
      expect(JSON.stringify(secret.body)).toContain(SECRET_TEXT);
    });
  });

  describe("files", () => {
    it("serves an image inline with the safe file headers", async () => {
      const { token, fx } = await setup();
      const r = await file(token, fx.files.pageShared.id);
      expect(r.res.status).toBe(200);
      expect(r.res.headers.get("content-type")).toBe("image/png");
      expect(r.res.headers.get("content-disposition")).toMatch(/^inline;/);
      expect(r.res.headers.get("content-security-policy")).toContain(
        "default-src 'none'",
      );
      expect(r.res.headers.get("cross-origin-resource-policy")).toBe(
        "same-origin",
      );
      expect(bytesOf(r)[0]).toBe(0x89);
    });

    it("serves a PDF of a visible hint", async () => {
      const { token, fx } = await setup();
      const r = await file(token, fx.hintFiles.shared.id);
      expect(r.res.status).toBe(200);
      expect(r.res.headers.get("content-type")).toBe("application/pdf");
    });

    it("answers 404 for everything the link does not share", async () => {
      const { token, fx, mk } = await setup();
      const denied = [
        fx.files.pagePrivate.id,
        fx.files.onHiddenPage.id,
        fx.files.onContact.id,
        fx.hintFiles.private.id,
        fx.hintFiles.onPrivateHint.id,
        "nope",
        "../../etc/passwd",
      ];
      for (const id of denied) {
        const r = await file(token, id);
        expect([r.res.status, r.body], id).toEqual([404, "page"]);
      }
      const noDevices = await mk({ sections: ["rules", "howto"] });
      expect(
        (await file(noDevices.token, fx.hintFiles.shared.id)).res.status,
      ).toBe(404);
    });

    it("does not serve what was shared when the page is hidden afterwards", async () => {
      const { token, fx } = await setup();
      test.db.$client.exec(
        `update doc_pages set guest_visible = 0 where id = '${fx.pages.howto.id}'`,
      );
      expect((await file(token, fx.files.pageShared.id)).res.status).toBe(404);
    });
  });

  describe("rate limits", () => {
    it("blocks an address that presents too many unknown tokens, but not other addresses", async () => {
      const { token } = await setup();
      for (let i = 0; i < SHARE_MISSES_PER_WINDOW; i += 1) {
        expect((await home("x".repeat(43))).res.status).toBe(404);
      }
      const blocked = await home(token);
      expect([blocked.res.status, blocked.body]).toEqual([429, "rate"]);
      expect((await home(token, { ip: "198.51.100.9" })).res.status).toBe(200);
    });

    it("expired links do not count as guesses", async () => {
      const { mk } = await setup();
      const old = await mk();
      revokeGuestLink(ctx(), old.record.id);
      for (let i = 0; i < SHARE_MISSES_PER_WINDOW + 5; i += 1) {
        expect((await home(old.token)).res.status).toBe(404);
      }
    });

    it("limits the requests of one address", async () => {
      const { token } = await setup();
      let last = 200;
      for (let i = 0; i < SHARE_REQUESTS_PER_MINUTE + 1; i += 1) {
        last = (await file(token, "nope")).res.status;
      }
      expect(last).toBe(429);
    });
  });
});
