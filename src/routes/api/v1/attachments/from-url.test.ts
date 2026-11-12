import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { useFakeWeb } from "$lib/testing/fake-web";
import { samplePdf, sampleHtml, useTestFilesDir } from "$lib/testing/files";
import { plainPng } from "$lib/server/files/test-images";

interface ErrorBody {
  error: {
    code: string;
    details?: {
      code?: string;
      status?: number;
      body?: { fieldErrors: Record<string, string[]> };
    };
  };
}
type Call = ReturnType<typeof createCaller>;

describe("POST /attachments/from-url", () => {
  useTestDB();
  useTestFilesDir();
  const web = useFakeWeb();

  async function setup() {
    const user = await createTestUser();
    const call = createCaller({ session: loginTestUser(user).token });
    const asset = (
      await call("POST", "/api/v1/assets", { json: { name: "Kessel" } })
    ).body as { id: string };
    return { user, call, asset };
  }
  const png = () => web.serve(() => new Response(plainPng(40, 30) as BlobPart));
  const post = (call: Call, json: Record<string, unknown>) =>
    call("POST", "/api/v1/attachments/from-url", { json });

  it("downloads the file and answers the attachment, as an upload does", async () => {
    const { user, call, asset } = await setup();
    const site = png();
    const r = await post(call, {
      ownerType: "asset",
      ownerId: asset.id,
      url: `${site.origin}/bilder/filter.png`,
      caption: "Der Filter",
    });
    expect(r.res.status).toBe(201);
    const body = r.body as { id: string };
    expect(r.body).toMatchObject({
      ownerType: "asset",
      ownerId: asset.id,
      filename: "filter.png",
      mime: "image/png",
      width: 40,
      height: 30,
      caption: "Der Filter",
      guestVisible: false,
      uploadedBy: user.id,
      url: `/api/v1/attachments/${body.id}/content`,
      thumbUrl: `/api/v1/attachments/${body.id}/thumb`,
    });
    expect(r.res.headers.get("cache-control")).toBe("no-store");
    const served = await call("GET", `/api/v1/attachments/${body.id}/content`);
    expect(served.res.status).toBe(200);
    expect(served.res.headers.get("content-type")).toBe("image/png");
    const list = (
      await call(
        "GET",
        `/api/v1/attachments?ownerType=asset&ownerId=${asset.id}`,
      )
    ).body as { items: unknown[] };
    expect(list.items).toHaveLength(1);
  });

  it("stores a PDF as it is", async () => {
    const { call, asset } = await setup();
    const site = web.serve(() => new Response(samplePdf() as BlobPart));
    const r = await post(call, {
      ownerType: "asset",
      ownerId: asset.id,
      url: `${site.origin}/handbuch.pdf`,
    });
    expect(r.res.status).toBe(201);
    expect(r.body).toMatchObject({
      mime: "application/pdf",
      filename: "handbuch.pdf",
      thumbUrl: null,
    });
  });

  it("can hang a picture on a step of a task", async () => {
    const { call } = await setup();
    const task = (
      await call("POST", "/api/v1/tasks", {
        json: {
          title: "Filter wechseln",
          trigger: { v: 1, type: "one_off", date: "2030-01-01" },
        },
      })
    ).body as { id: string };
    const step = (
      (
        await call("PUT", `/api/v1/tasks/${task.id}/steps`, {
          json: { steps: [{ title: "Abdeckung abnehmen" }] },
        })
      ).body as { steps: { id: string }[] }
    ).steps[0]!;
    const site = png();
    const r = await post(call, {
      ownerType: "task_step",
      ownerId: step.id,
      url: `${site.origin}/a.png`,
    });
    expect(r.res.status).toBe(201);
    const detail = (await call("GET", `/api/v1/tasks/${task.id}`)).body as {
      steps: { images: { ownerType: string }[] }[];
    };
    expect(detail.steps[0]!.images.map((i) => i.ownerType)).toEqual([
      "task_step",
    ]);
  });

  describe("what goes wrong is a 400 on url that says why", () => {
    it("blocked_host for an address that is not public", async () => {
      const { call, asset } = await setup();
      const r = await post(call, {
        ownerType: "asset",
        ownerId: asset.id,
        url: "http://169.254.169.254/latest/meta-data/",
      });
      const body = r.body as ErrorBody;
      expect([r.res.status, body.error.code]).toEqual([400, "invalid_request"]);
      expect(body.error.details?.code).toBe("blocked_host");
      expect(body.error.details?.body?.fieldErrors).toHaveProperty("url");
    });

    it("upstream_status with the status", async () => {
      const { call, asset } = await setup();
      const site = web.serve(() => new Response("no", { status: 404 }));
      const r = await post(call, {
        ownerType: "asset",
        ownerId: asset.id,
        url: `${site.origin}/gone.png`,
      });
      expect((r.body as ErrorBody).error.details).toMatchObject({
        code: "upstream_status",
        status: 404,
      });
    });

    it("too_many_redirects and unreachable", async () => {
      const { call, asset } = await setup();
      const loop = web.serve(() => Response.redirect("/", 302));
      const looped = await post(call, {
        ownerType: "asset",
        ownerId: asset.id,
        url: `${loop.origin}/`,
      });
      expect((looped.body as ErrorBody).error.details?.code).toBe(
        "too_many_redirects",
      );
      const closed = await post(call, {
        ownerType: "asset",
        ownerId: asset.id,
        url: `http://127.0.0.1:${await web.closedPort()}/`,
      });
      expect((closed.body as ErrorBody).error.details?.code).toBe(
        "unreachable",
      );
    });

    it("the store's own codes for what is not a picture or a PDF", async () => {
      const { call, asset } = await setup();
      const site = web.serve(
        () =>
          new Response(sampleHtml() as BlobPart, {
            headers: { "content-type": "image/png" },
          }),
      );
      const r = await post(call, {
        ownerType: "asset",
        ownerId: asset.id,
        url: `${site.origin}/page`,
      });
      expect([r.res.status, errorCode(r)]).toEqual([415, "invalid_request"]);
      expect((r.body as ErrorBody).error.details?.code).toBe(
        "unsupported_type",
      );
    });

    it("nothing is fetched for an owner that does not exist", async () => {
      const { call } = await setup();
      const site = png();
      const r = await post(call, {
        ownerType: "asset",
        ownerId: "missing",
        url: `${site.origin}/a.png`,
      });
      expect(r.res.status).toBe(400);
      expect(
        (r.body as ErrorBody).error.details?.body?.fieldErrors,
      ).toHaveProperty("ownerId");
      expect(site.requests).toEqual([]);
    });
  });

  it.each([
    ["an ftp address", { url: "ftp://files.example.org/a.png" }],
    ["a file address", { url: "file:///etc/passwd" }],
    [
      "credentials in the address",
      { url: "https://user:pw@example.org/a.png" },
    ],
    ["no address", {}],
    ["a relative address", { url: "/a.png" }],
    [
      "an address of 2001 characters",
      { url: `https://example.org/${"a".repeat(1981)}` },
    ],
    [
      "a caption over 500 characters",
      { url: "https://example.org/a.png", caption: "x".repeat(501) },
    ],
    [
      "an unknown field",
      { url: "https://example.org/a.png", filename: "x.png" },
    ],
    [
      "guestVisible as a string",
      { url: "https://example.org/a.png", guestVisible: "true" },
    ],
  ])("refuses %s before anything is fetched", async (_name, extra) => {
    const { call, asset } = await setup();
    const r = await post(call, {
      ownerType: "asset",
      ownerId: asset.id,
      ...extra,
    });
    expect([r.res.status, errorCode(r)]).toEqual([400, "invalid_request"]);
    expect((r.body as ErrorBody).error.details?.code).toBeUndefined();
  });

  describe("scopes", () => {
    it("needs the write scope", async () => {
      const { user, asset } = await setup();
      const read = createCaller({
        bearer: createTestToken(user, { scopes: ["read"] }).token,
      });
      const site = png();
      const r = await post(read, {
        ownerType: "asset",
        ownerId: asset.id,
        url: `${site.origin}/a.png`,
      });
      expect([r.res.status, errorCode(r)]).toEqual([403, "forbidden"]);
      expect(site.requests).toEqual([]);
    });

    it("a page needs docs:write like the upload does, a cost entry costs:write, and the receipt queue is refused", async () => {
      const { user, call } = await setup();
      const page = (
        await call("POST", "/api/v1/pages", {
          json: { title: "Notfall", bodyMd: "x" },
        })
      ).body as { id: string };
      const write = createCaller({
        bearer: createTestToken(user, { scopes: ["read", "write"] }).token,
      });
      const docs = createCaller({
        bearer: createTestToken(user, {
          scopes: ["read", "write", "docs:write"],
        }).token,
      });
      const site = png();
      const target = {
        ownerType: "page",
        ownerId: page.id,
        url: `${site.origin}/a.png`,
      };
      expect(errorCode(await post(write, target))).toBe("forbidden");
      expect(site.requests).toEqual([]);
      expect((await post(docs, target)).res.status).toBe(201);

      const cost = await post(write, {
        ownerType: "cost",
        ownerId: "x",
        url: `${site.origin}/a.png`,
      });
      expect(errorCode(cost)).toBe("forbidden");
      const queue = await post(call, {
        ownerType: "ai_task",
        ownerId: "x",
        url: `${site.origin}/a.png`,
      });
      expect(queue.res.status).toBe(400);
      expect(
        (queue.body as ErrorBody).error.details?.body?.fieldErrors,
      ).toHaveProperty("ownerType");
    });
  });
});
