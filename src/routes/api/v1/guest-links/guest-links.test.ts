import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";

type Link = {
  id: string;
  label: string;
  status: string;
  url?: string;
  hasPin: boolean;
  pinLocked: boolean;
  includeSecrets: boolean;
  sections: string[];
  pageIds: string[];
  createdByName: string | null;
  expiresAt: string;
  viewCount: number;
  [key: string]: unknown;
};

const URL_PATTERN = /^http:\/\/localhost\/g\/([A-Za-z0-9_-]{43})$/;
const DAY = 86_400_000;
const inDays = (days: number) =>
  new Date(Date.now() + days * DAY).toISOString();

describe("guest links API", () => {
  useTestDB();
  async function member(displayName: string | null = null) {
    const user = await createTestUser({ displayName });
    return { user, call: createCaller({ session: loginTestUser(user).token }) };
  }
  const create = (
    call: Awaited<ReturnType<typeof member>>["call"],
    json: Record<string, unknown> = {},
  ) =>
    call("POST", "/api/v1/guest-links", {
      json: { label: "Wochenende", expiresAt: inDays(7), ...json },
    });

  it("creates a link and shows its address exactly once", async () => {
    const { call } = await member("Anna");
    const r = await create(call, { pin: "4711", includeSecrets: true });
    expect(r.res.status).toBe(201);
    const link = r.body as Link;
    expect(link.url).toMatch(URL_PATTERN);
    expect(link).toMatchObject({
      label: "Wochenende",
      status: "active",
      hasPin: true,
      pinLocked: false,
      includeSecrets: true,
      createdByName: "Anna",
      viewCount: 0,
      sections: ["emergency", "rules", "contacts", "devices", "howto"],
      pageIds: [],
    });
    expect(r.res.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(r.body)).not.toContain("4711");
    const list = (await call("GET", "/api/v1/guest-links")).body as {
      items: Link[];
    };
    expect(list.items).toHaveLength(1);
    expect(list.items[0].id).toBe(link.id);
    expect("url" in list.items[0]).toBe(false);
    expect(JSON.stringify(list)).not.toContain(link.url!.slice(-43));
    expect(JSON.stringify(list)).not.toContain("pinHash");
    expect(JSON.stringify(list)).not.toContain("tokenHash");
  });

  it("validates the body", async () => {
    const { call } = await member();
    const bad = async (json: Record<string, unknown>) =>
      errorCode(await create(call, json));
    expect(await bad({ expiresAt: undefined })).toBe("invalid_request");
    expect(await bad({ label: "" })).toBe("invalid_request");
    expect(await bad({ pin: "12" })).toBe("invalid_request");
    expect(await bad({ pin: "1234567890" })).toBe("invalid_request");
    expect(await bad({ sections: ["everything"] })).toBe("invalid_request");
    expect(await bad({ unknown: 1 })).toBe("invalid_request");
    expect(await bad({ expiresAt: "tomorrow" })).toBe("invalid_request");
  });

  it("enforces the window: future expiry, at most 90 days, start before expiry", async () => {
    const { call } = await member();
    const fields = async (json: Record<string, unknown>) => {
      const r = await create(call, json);
      expect(r.res.status).toBe(400);
      return Object.keys(
        (r.body as { error: { details: { body: { fieldErrors: object } } } })
          .error.details.body.fieldErrors,
      );
    };
    expect(await fields({ expiresAt: inDays(-1) })).toEqual(["expiresAt"]);
    expect(await fields({ expiresAt: inDays(91) })).toEqual(["expiresAt"]);
    expect(await fields({ startsAt: inDays(8), expiresAt: inDays(7) })).toEqual(
      ["startsAt"],
    );
    expect((await create(call, { expiresAt: inDays(89) })).res.status).toBe(
      201,
    );
  });

  it("refuses unknown page ids", async () => {
    const { call } = await member();
    expect(errorCode(await create(call, { pageIds: ["nope"] }))).toBe(
      "invalid_request",
    );
  });

  it("lets any member see and manage every link", async () => {
    const [anna, ben] = [await member("Anna"), await member("Ben")];
    const link = (await create(anna.call)).body as Link;
    const seen = (await ben.call("GET", "/api/v1/guest-links")).body as {
      items: Link[];
    };
    expect(seen.items.map((l) => [l.id, l.createdByName])).toEqual([
      [link.id, "Anna"],
    ]);
    const patched = await ben.call("PATCH", `/api/v1/guest-links/${link.id}`, {
      json: { label: "Von Ben bearbeitet", sections: ["rules"] },
    });
    expect(patched.body).toMatchObject({
      label: "Von Ben bearbeitet",
      sections: ["rules"],
    });
    expect("url" in (patched.body as object)).toBe(false);
    const rotated = await ben.call(
      "POST",
      `/api/v1/guest-links/${link.id}/rotate`,
    );
    expect((rotated.body as Link).url).toMatch(URL_PATTERN);
    expect(
      (await ben.call("DELETE", `/api/v1/guest-links/${link.id}`)).res.status,
    ).toBe(204);
  });

  it("changes a link: PIN, window, secrets, locale", async () => {
    const { call } = await member();
    const link = (await create(call)).body as Link;
    const r = await call("PATCH", `/api/v1/guest-links/${link.id}`, {
      json: {
        pin: "123456",
        includeSecrets: true,
        locale: "en",
        startsAt: inDays(1),
        expiresAt: inDays(30),
      },
    });
    expect(r.body).toMatchObject({
      hasPin: true,
      includeSecrets: true,
      locale: "en",
      status: "scheduled",
    });
    const removed = await call("PATCH", `/api/v1/guest-links/${link.id}`, {
      json: { pin: null, startsAt: null },
    });
    expect(removed.body).toMatchObject({ hasPin: false, status: "active" });
    expect(
      errorCode(
        await call("PATCH", `/api/v1/guest-links/${link.id}`, {
          json: { expiresAt: inDays(120) },
        }),
      ),
    ).toBe("invalid_request");
    expect(
      errorCode(
        await call("PATCH", `/api/v1/guest-links/${link.id}`, { json: {} }),
      ),
    ).toBe("invalid_request");
  });

  it("revokes a link: it stays listed as revoked and can no longer be changed or rotated", async () => {
    const { call } = await member();
    const link = (await create(call)).body as Link;
    expect(
      (await call("DELETE", `/api/v1/guest-links/${link.id}`)).res.status,
    ).toBe(204);
    expect(
      (await call("DELETE", `/api/v1/guest-links/${link.id}`)).res.status,
    ).toBe(204);
    const list = (await call("GET", "/api/v1/guest-links")).body as {
      items: Link[];
    };
    expect(list.items[0]).toMatchObject({ id: link.id, status: "revoked" });
    expect(
      errorCode(
        await call("PATCH", `/api/v1/guest-links/${link.id}`, {
          json: { label: "x" },
        }),
      ),
    ).toBe("conflict");
    expect(
      errorCode(await call("POST", `/api/v1/guest-links/${link.id}/rotate`)),
    ).toBe("conflict");
  });

  it("answers 404 for an unknown link", async () => {
    const { call } = await member();
    expect(
      errorCode(
        await call("PATCH", "/api/v1/guest-links/nope", {
          json: { label: "x" },
        }),
      ),
    ).toBe("not_found");
    expect(errorCode(await call("DELETE", "/api/v1/guest-links/nope"))).toBe(
      "not_found",
    );
    expect(
      errorCode(await call("POST", "/api/v1/guest-links/nope/rotate")),
    ).toBe("not_found");
  });

  it("is for browser sessions only", async () => {
    const user = await createTestUser({ role: "admin" });
    const call = createCaller({
      bearer: createTestToken(user, {
        kind: "mcp",
        scopes: ["read", "write", "docs:write", "admin"],
      }).token,
    });
    expect(errorCode(await call("GET", "/api/v1/guest-links"))).toBe(
      "forbidden",
    );
    expect(
      errorCode(
        await call("POST", "/api/v1/guest-links", {
          json: { label: "x", expiresAt: inDays(1) },
        }),
      ),
    ).toBe("forbidden");
  });
});
