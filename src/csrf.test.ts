import { isActionFailure, isRedirect, type RequestEvent } from "@sveltejs/kit";
import { describe, expect, it } from "vitest";
import { createGuestLinkRequestSchema } from "$lib/api/schemas/share";
import { GUEST_COOKIE } from "$lib/server/share/guest-access";
import { createGuestLink } from "$lib/server/share/guest-links";
import { plainPng } from "$lib/server/files/test-images";
import { createCaller } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt } from "$lib/testing/domain";
import { useTestFilesDir } from "$lib/testing/files";
import { callRoute } from "$lib/testing/route";
import config from "../svelte.config.js";
import { POST as upload } from "./routes/api/v1/attachments/+server";
import { POST as createToken } from "./routes/api/v1/tokens/+server";
import * as guestHome from "./routes/g/[token]/+page.server";

const DAY = 86_400_000;
const PIN = "4821";
const EVIL = "https://evil.example";

describe("SvelteKit's own origin check", () => {
  it("is off: hooks.server.ts refuses cross-site writes instead", () => {
    // It would reject bearer uploads (multipart) that carry no Origin before bind() runs, and it
    // cannot tell them from cookie requests. The deprecated `checkOrigin` is not used.
    expect(config.kit?.csrf?.trustedOrigins).toEqual(["*"]);
    expect(config.kit?.csrf).not.toHaveProperty("checkOrigin");
  });
});

describe("cross-site writes", () => {
  const test = useTestDB();
  useTestFilesDir();

  async function setup() {
    const user = await createTestUser();
    const { token } = await createGuestLink(
      ctxAt(test.db, Date.now()),
      user.id,
      "de",
      createGuestLinkRequestSchema.parse({
        label: "Gäste",
        expiresAt: new Date(Date.now() + 7 * DAY).toISOString(),
        pin: PIN,
      }),
    );
    return { user, token };
  }

  /** The PIN form of a guest page (a SvelteKit form action), run the way the framework would. */
  function pinForm() {
    const state = { reached: false };
    const handler = async (event: RequestEvent): Promise<Response> => {
      state.reached = true;
      try {
        const out = await guestHome.actions.default(event as never);
        return new Response(null, {
          status: isActionFailure(out) ? out.status : 200,
        });
      } catch (err) {
        if (!isRedirect(err)) throw err;
        return new Response(null, {
          status: err.status,
          headers: { location: err.location },
        });
      }
    };
    return { state, handler };
  }

  const urlEncoded = { "content-type": "application/x-www-form-urlencoded" };

  describe("to a form action outside the API (the guest PIN form)", () => {
    it.each([
      ["another origin", EVIL],
      ["no Origin header", null],
      ["a null origin", "null"],
      ["another port", "http://localhost:3000"],
      ["another scheme", "https://localhost"],
      ["a look-alike host", "http://localhost.evil.example"],
    ])(
      "refuses a post with the right PIN from %s and never runs the action",
      async (_name, origin) => {
        const { token } = await setup();
        const { state, handler } = pinForm();
        const r = await callRoute(handler, {
          url: `http://localhost/g/${token}`,
          params: { token },
          headers: urlEncoded,
          rawBody: `pin=${PIN}`,
          origin,
        });
        expect(r.res.status).toBe(403);
        expect(state.reached).toBe(false);
        expect(r.cookies.get(GUEST_COOKIE)).toBeUndefined();
      },
    );

    it.each([
      ["urlencoded", urlEncoded],
      ["plain text", { "content-type": "text/plain" }],
      ["json", { "content-type": "application/json" }],
      ["no content type", {}],
    ])("refuses a %s post from another origin", async (_name, headers) => {
      const { token } = await setup();
      const { state, handler } = pinForm();
      const r = await callRoute(handler, {
        url: `http://localhost/g/${token}`,
        params: { token },
        headers,
        rawBody: `pin=${PIN}`,
        origin: EVIL,
      });
      expect(r.res.status).toBe(403);
      expect(state.reached).toBe(false);
    });

    it("refuses a multipart post from another origin", async () => {
      const { token } = await setup();
      const { state, handler } = pinForm();
      const r = await callRoute(handler, {
        url: `http://localhost/g/${token}`,
        params: { token },
        form: { pin: PIN },
        origin: EVIL,
      });
      expect(r.res.status).toBe(403);
      expect(state.reached).toBe(false);
    });

    it.each(["PUT", "PATCH", "DELETE"])(
      "refuses %s from another origin",
      async (method) => {
        const { token } = await setup();
        const { state, handler } = pinForm();
        const r = await callRoute(handler, {
          url: `http://localhost/g/${token}`,
          method,
          params: { token },
          headers: urlEncoded,
          rawBody: `pin=${PIN}`,
          origin: EVIL,
        });
        expect(r.res.status).toBe(403);
        expect(state.reached).toBe(false);
      },
    );

    it("keeps the usual response headers on the refusal", async () => {
      const { token } = await setup();
      const r = await callRoute(pinForm().handler, {
        url: `http://localhost/g/${token}`,
        params: { token },
        form: { pin: PIN },
        origin: EVIL,
      });
      expect(r.res.status).toBe(403);
      expect(r.res.headers.get("x-frame-options")).toBe("DENY");
      expect(r.res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.res.headers.get("cache-control")).toBe("no-store");
      expect(r.res.headers.get("x-robots-tag")).toContain("noindex");
      expect(r.res.headers.get("set-cookie")).toBeNull();
    });

    it("takes the form from the guest page itself even though that page sends Origin: null", async () => {
      // The guest pages are served with Referrer-Policy: no-referrer, so browsers post their own
      // form with `Origin: null`; the browser's Sec-Fetch-Site says it was same-origin.
      const { token } = await setup();
      const fromPage = pinForm();
      const unlocked = await callRoute(fromPage.handler, {
        url: `http://localhost/g/${token}`,
        params: { token },
        headers: { ...urlEncoded, "sec-fetch-site": "same-origin" },
        rawBody: `pin=${PIN}`,
        origin: "null",
      });
      expect(fromPage.state.reached).toBe(true);
      expect(unlocked.res.status).toBe(303);
      expect(unlocked.cookies.get(GUEST_COOKIE)).toBeTruthy();

      for (const site of ["cross-site", "same-site", "none"]) {
        const forged = pinForm();
        const r = await callRoute(forged.handler, {
          url: `http://localhost/g/${token}`,
          params: { token },
          headers: { ...urlEncoded, "sec-fetch-site": site },
          rawBody: `pin=${PIN}`,
          origin: "null",
        });
        expect([site, r.res.status, forged.state.reached]).toEqual([
          site,
          403,
          false,
        ]);
      }
    });

    it("still takes the form from the page itself: same origin, right PIN unlocks, wrong PIN fails", async () => {
      const { token } = await setup();
      const right = pinForm();
      const unlocked = await callRoute(right.handler, {
        url: `http://localhost/g/${token}`,
        params: { token },
        headers: urlEncoded,
        rawBody: `pin=${PIN}`,
      });
      expect(right.state.reached).toBe(true);
      expect(unlocked.res.status).toBe(303);
      expect(unlocked.cookies.get(GUEST_COOKIE)).toBeTruthy();

      const wrong = pinForm();
      const refused = await callRoute(wrong.handler, {
        url: `http://localhost/g/${token}`,
        params: { token },
        form: { pin: "0000" },
      });
      expect(wrong.state.reached).toBe(true);
      expect(refused.res.status).toBe(400);
      expect(refused.cookies.get(GUEST_COOKIE)).toBeUndefined();
    });
  });

  describe("to other pages and routes outside /api/v1", () => {
    it.each([
      "/login",
      "/setup",
      "/settings/account",
      "/g/whatever/docs/page",
      "/api/health",
      "/api/public/cal/whatever.ics",
      "/api/v10/tokens",
      "/anything/else",
    ])(
      "refuses a cookie-authenticated post to %s from another origin",
      async (path) => {
        const user = await createTestUser();
        let reached = false;
        const r = await callRoute(
          () => {
            reached = true;
            return new Response("ok");
          },
          {
            url: `http://localhost${path}`,
            method: "POST",
            session: loginTestUser(user).token,
            form: { a: "b" },
            origin: EVIL,
          },
        );
        expect(r.res.status).toBe(403);
        expect(reached).toBe(false);
      },
    );

    it("answers with the error envelope under /api and plain text elsewhere", async () => {
      const page = await callRoute(() => new Response("ok"), {
        url: "http://localhost/login",
        method: "POST",
        form: { a: "b" },
        origin: EVIL,
      });
      expect(page.res.headers.get("content-type")).toContain("text/plain");
      const api = await callRoute(() => new Response("ok"), {
        url: "http://localhost/api/health",
        method: "POST",
        form: { a: "b" },
        origin: EVIL,
      });
      expect(api.body).toEqual({
        error: {
          code: "csrf_failed",
          message: "Cross-origin request rejected",
        },
      });
    });

    it("lets reads from any origin through", async () => {
      for (const method of ["GET", "HEAD"]) {
        let reached = false;
        const r = await callRoute(
          () => {
            reached = true;
            return new Response("ok");
          },
          {
            url: "http://localhost/g/whatever",
            method,
            origin: EVIL,
          },
        );
        expect([method, r.res.status, reached]).toEqual([method, 200, true]);
      }
    });
  });

  describe("to /api/v1, where bind decides", () => {
    async function withAsset() {
      const user = await createTestUser();
      const call = createCaller({ session: loginTestUser(user).token });
      const asset = (
        await call("POST", "/api/v1/assets", { json: { name: "Kessel" } })
      ).body as { id: string };
      return { user, asset };
    }

    const png = () =>
      new File([plainPng() as BlobPart], "a.png", { type: "image/png" });

    it("accepts a bearer upload without an Origin header", async () => {
      const { user, asset } = await withAsset();
      const { token } = createTestToken(user, { scopes: ["read", "write"] });
      const r = await callRoute(upload, {
        url: "http://localhost/api/v1/attachments",
        bearer: token,
        origin: null,
        form: { file: png(), ownerType: "asset", ownerId: asset.id },
      });
      expect(r.res.status).toBe(201);
    });

    it("accepts a bearer upload from any origin: a token is not a cookie", async () => {
      const { user, asset } = await withAsset();
      const { token } = createTestToken(user, { scopes: ["read", "write"] });
      const r = await callRoute(upload, {
        url: "http://localhost/api/v1/attachments",
        bearer: token,
        origin: EVIL,
        form: { file: png(), ownerType: "asset", ownerId: asset.id },
      });
      expect(r.res.status).toBe(201);
    });

    it.each([
      ["another origin", EVIL],
      ["no Origin header", null],
    ])("still refuses a cookie upload from %s", async (_name, origin) => {
      const { user, asset } = await withAsset();
      const r = await callRoute(upload, {
        url: "http://localhost/api/v1/attachments",
        session: loginTestUser(user).token,
        origin,
        form: { file: png(), ownerType: "asset", ownerId: asset.id },
      });
      expect([
        r.res.status,
        (r.body as { error: { code: string } }).error.code,
      ]).toEqual([403, "csrf_failed"]);
    });

    it("still refuses a cookie form post to a JSON endpoint from another origin", async () => {
      const user = await createTestUser();
      const r = await callRoute(createToken, {
        url: "http://localhost/api/v1/tokens",
        session: loginTestUser(user).token,
        origin: EVIL,
        headers: urlEncoded,
        rawBody: "name=forged&kind=integration&scopes=read",
      });
      expect([
        r.res.status,
        (r.body as { error: { code: string } }).error.code,
      ]).toEqual([403, "csrf_failed"]);
    });
  });
});
