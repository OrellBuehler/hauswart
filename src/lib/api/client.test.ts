import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { createApiClient, endpointUrl, type FetchLike } from "./client";
import { ApiError } from "./errors";
import { defineEndpoint, endpoints } from "./registry";
import { paginationQuerySchema } from "./schemas/common";

interface Recorded {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: (req: Recorded) => Response | Promise<Response>): {
  fetch: FetchLike;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  return {
    calls,
    fetch: async (url, init = {}) => {
      const req = { url, init };
      calls.push(req);
      return respond(req);
    },
  };
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const user = {
  id: "u1",
  username: "alice",
  displayName: "Alice",
  role: "member",
  locale: "de",
};

const list = defineEndpoint({
  id: "thingsList",
  method: "GET",
  path: "/api/v1/things",
  summary: "list",
  tags: ["things"],
  auth: "session",
  scopes: [],
  query: paginationQuerySchema.extend({ tags: z.array(z.string()).optional() }),
  response: z.object({ items: z.array(z.string()) }),
});

describe("createApiClient", () => {
  it("calls a bodyless endpoint and returns the parsed response", async () => {
    const { fetch, calls } = fakeFetch(() =>
      jsonResponse({ status: "ok", version: "1" }),
    );
    const api = createApiClient(fetch);
    const result = await api.call(endpoints.health);
    expect(result).toEqual({ status: "ok", version: "1" });
    expectTypeOf(result).toEqualTypeOf<{ status: "ok"; version: string }>();
    expect(calls[0].url).toBe("/api/v1/health");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.body).toBeUndefined();
    expect((calls[0].init.headers as Record<string, string>).accept).toBe(
      "application/json",
    );
  });

  it("sends a JSON body with a content type", async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse({ user }));
    const api = createApiClient(fetch);
    const result = await api.call(endpoints.authLogin, {
      body: { username: "alice", password: "pw" },
    });
    expect(result.user.username).toBe("alice");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe(
      JSON.stringify({ username: "alice", password: "pw" }),
    );
    expect(
      (calls[0].init.headers as Record<string, string>)["content-type"],
    ).toBe("application/json");
  });

  it("substitutes and encodes path parameters, and returns null for 204", async () => {
    const { fetch, calls } = fakeFetch(
      () => new Response(null, { status: 204 }),
    );
    const api = createApiClient(fetch);
    const result = await api.call(endpoints.tokensRevoke, {
      params: { id: "a/b c" },
    });
    expect(result).toBeNull();
    expect(calls[0].url).toBe("/api/v1/tokens/a%2Fb%20c");
    expect(calls[0].init.method).toBe("DELETE");
  });

  it("serialises query strings, repeating arrays and skipping undefined", async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse({ items: [] }));
    const api = createApiClient(fetch);
    await api.call(list, {
      query: { limit: 5, tags: ["a", "b"], cursor: undefined },
    });
    expect(calls[0].url).toBe("/api/v1/things?limit=5&tags=a&tags=b");
    await api.call(list);
    expect(calls[1].url).toBe("/api/v1/things");
  });

  it("throws ApiError with code, status and details from the envelope", async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse(
        {
          error: {
            code: "invalid_request",
            message: "Invalid request",
            details: { body: { fieldErrors: { name: ["required"] } } },
          },
        },
        400,
      ),
    );
    const api = createApiClient(fetch);
    const err = await api
      .call(endpoints.authLogin, { body: { username: "a", password: "b" } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      code: "invalid_request",
      status: 400,
      message: "Invalid request",
      details: { body: { fieldErrors: { name: ["required"] } } },
    });
  });

  it("maps non-envelope failures from proxies to an ApiError", async () => {
    const html = fakeFetch(
      () => new Response("<html>bad gateway</html>", { status: 502 }),
    );
    await expect(
      createApiClient(html.fetch).call(endpoints.health),
    ).rejects.toMatchObject({
      code: "internal",
      status: 502,
    });
    const plain = fakeFetch(() => new Response("", { status: 401 }));
    await expect(
      createApiClient(plain.fetch).call(endpoints.health),
    ).rejects.toMatchObject({
      code: "unauthenticated",
      status: 401,
    });
  });

  it("rejects responses that break the contract", async () => {
    const { fetch } = fakeFetch(() => jsonResponse({ status: "nope" }));
    await expect(
      createApiClient(fetch).call(endpoints.health),
    ).rejects.toMatchObject({
      code: "internal",
      status: 200,
    });
  });

  it("sends a bearer token and honours an absolute base URL", async () => {
    const { fetch, calls } = fakeFetch(() =>
      jsonResponse({ user, auth: "token", scopes: ["read"] }),
    );
    const api = createApiClient(fetch, "https://hauswart.example.org/", {
      token: () => "hw_secret",
    });
    await api.call(endpoints.authMe);
    expect(calls[0].url).toBe("https://hauswart.example.org/api/v1/auth/me");
    expect(
      (calls[0].init.headers as Record<string, string>).authorization,
    ).toBe("Bearer hw_secret");
  });

  it("refuses to build a URL with a missing path parameter", async () => {
    const { fetch, calls } = fakeFetch(
      () => new Response(null, { status: 204 }),
    );
    await expect(
      createApiClient(fetch).call(endpoints.tokensRevoke, {
        params: { id: "" },
      }),
    ).rejects.toThrow(/missing path parameter/);
    expect(calls).toHaveLength(0);
  });

  it("lets network errors through untouched", async () => {
    const api = createApiClient(() => Promise.reject(new TypeError("offline")));
    await expect(api.call(endpoints.health)).rejects.toThrow(TypeError);
  });
});

describe("PDF endpoints", () => {
  it("returns the response itself and asks for application/pdf", async () => {
    const { fetch, calls } = fakeFetch(
      () =>
        new Response(new Uint8Array([37, 80, 68, 70]), {
          headers: { "content-type": "application/pdf" },
        }),
    );
    const res = await createApiClient(fetch).call(endpoints.defectsExport, {
      query: { status: "open" },
    });
    expect(res).toBeInstanceOf(Response);
    expect((await res.arrayBuffer()).byteLength).toBe(4);
    expect(calls[0].url).toBe("/api/v1/defects/export.pdf?status=open");
    expect((calls[0].init.headers as Record<string, string>).accept).toBe(
      "application/pdf",
    );
  });

  it("throws the API error for a failed request", async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse({ error: { code: "forbidden", message: "No" } }, 403),
    );
    await expect(
      createApiClient(fetch).call(endpoints.defectsExport),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
  });

  it("builds the url for a plain download link", () => {
    expect(
      endpointUrl(endpoints.defectsExport, { query: { roomId: "r 1" } }),
    ).toBe("/api/v1/defects/export.pdf?roomId=r+1");
    expect(endpointUrl(endpoints.defectsExport)).toBe(
      "/api/v1/defects/export.pdf",
    );
  });
});
