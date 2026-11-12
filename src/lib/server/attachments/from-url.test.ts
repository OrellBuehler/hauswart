import { readdir } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "$lib/api/errors";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { createAsset } from "$lib/server/assets/assets";
import { attachments } from "$lib/server/db";
import { FileError } from "$lib/server/files/errors";
import {
  plainJpeg,
  plainPng,
  withExif,
  SECRET_MAKE,
} from "$lib/server/files/test-images";
import {
  setHostResolver,
  setLenientHostPolicy,
} from "$lib/server/net/host-policy";
import { APP_VERSION } from "$lib/server/version";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt } from "$lib/testing/domain";
import { useFakeWeb } from "$lib/testing/fake-web";
import {
  sampleHeic,
  sampleHtml,
  samplePdf,
  sampleSvg,
  useTestFilesDir,
} from "$lib/testing/files";
import { fieldErrors } from "$lib/testing/vehicles";
import { attachFromUrl, type AttachFromUrl } from "./from-url";
import { unregisterAttachmentOwner } from "./owners";

const image = (bytes: Uint8Array, type = "image/png") =>
  new Response(bytes as BlobPart, { headers: { "content-type": type } });

describe("attaching a file from an address", () => {
  const test = useTestDB();
  const files = useTestFilesDir();
  const web = useFakeWeb();
  const ctx = () => ctxAt(test.db);

  afterEach(() => {
    setHostResolver(null);
    setLenientHostPolicy(true);
    vi.restoreAllMocks();
  });

  const asset = () =>
    createAsset(ctx(), createAssetRequestSchema.parse({ name: "Boiler" }));
  async function attach(
    url: string,
    over: Partial<AttachFromUrl> = {},
    options?: Parameters<typeof attachFromUrl>[2],
  ) {
    const owner = over.ownerId ? undefined : asset();
    return attachFromUrl(
      ctx(),
      {
        ownerType: "asset",
        ownerId: owner?.id ?? "",
        url,
        uploadedBy: null,
        ...over,
      },
      options,
    );
  }
  async function failure(promise: Promise<unknown>): Promise<ApiError> {
    try {
      await promise;
    } catch (err) {
      if (err instanceof ApiError) return err;
      throw err;
    }
    throw new Error("expected the call to fail");
  }
  async function fileFailure(promise: Promise<unknown>): Promise<FileError> {
    try {
      await promise;
    } catch (err) {
      if (err instanceof FileError) return err;
      throw err;
    }
    throw new Error("expected the store to refuse the file");
  }
  const detailsOf = (err: ApiError) => err.details as Record<string, unknown>;
  const stored = async () =>
    (await readdir(files.dir, { recursive: true })).filter((f) =>
      /[0-9a-f]{64}/.test(f),
    );

  describe("a download that works", () => {
    it("stores an image like an upload: re-encoded, without its metadata, named after the address", async () => {
      const site = web.serve(() =>
        image(withExif(plainJpeg(64, 32), 6), "image/jpeg"),
      );
      const user = await createTestUser();
      const row = await attach(
        `${site.origin}/media/Schritt%201.jpg?size=big`,
        {
          caption: "Filter ausbauen",
          guestVisible: true,
          uploadedBy: user.id,
        },
      );
      expect(row).toMatchObject({
        ownerType: "asset",
        mime: "image/jpeg",
        filename: "Schritt 1.jpg",
        caption: "Filter ausbauen",
        guestVisible: true,
        uploadedBy: user.id,
      });
      expect(row.width).not.toBeNull();
      expect(row.thumbPath).not.toBeNull();
      const bytes = await Bun.file(`${files.dir}/${row.path}`).bytes();
      expect(Buffer.from(bytes).includes(Buffer.from(SECRET_MAKE))).toBe(false);
    });

    it("stores a PDF as it is and takes the extension from what it is, not from the address", async () => {
      const site = web.serve(
        () =>
          new Response(samplePdf() as BlobPart, {
            headers: { "content-type": "application/octet-stream" },
          }),
      );
      const row = await attach(`${site.origin}/download?id=5`);
      expect(row).toMatchObject({
        mime: "application/pdf",
        filename: "download.pdf",
        thumbPath: null,
      });
      const bytes = await Bun.file(`${files.dir}/${row.path}`).bytes();
      expect(Buffer.from(bytes).equals(samplePdf())).toBe(true);
    });

    it("names a file from an address without a path 'download'", async () => {
      const site = web.serve(() => image(plainPng()));
      expect((await attach(`${site.origin}`)).filename).toBe("download.png");
    });

    it("takes the name from the address a redirect led to", async () => {
      const site = web.serve((request) =>
        new URL(request.url).pathname === "/short"
          ? Response.redirect("/files/handbuch.png", 302)
          : image(plainPng()),
      );
      expect((await attach(`${site.origin}/short`)).filename).toBe(
        "handbuch.png",
      );
    });

    it("tells the server who it is and nothing else", async () => {
      const site = web.serve(() => image(plainPng()));
      await attach(`${site.origin}/a.png`);
      const headers = site.requests[0]!.headers;
      expect(headers.get("user-agent")).toBe(`hauswart/${APP_VERSION}`);
      expect(headers.get("accept")).toMatch(/image\/png/);
      expect(headers.get("accept")).toMatch(/application\/pdf/);
      for (const name of ["cookie", "authorization", "referer", "origin"]) {
        expect(headers.get(name), name).toBeNull();
      }
    });
  });

  describe("what is refused", () => {
    it("checks the owner before fetching anything", async () => {
      const site = web.serve(() => image(plainPng()));
      const missing = await failure(
        attach(`${site.origin}/a.png`, { ownerId: "missing" }),
      );
      expect(fieldErrors(missing, "ownerId")).toHaveLength(1);

      const restore = unregisterAttachmentOwner("contact");
      try {
        const unsupported = await failure(
          attach(`${site.origin}/a.png`, {
            ownerType: "contact",
            ownerId: "x",
          }),
        );
        expect(fieldErrors(unsupported, "ownerType")).toHaveLength(1);
      } finally {
        restore();
      }
      expect(site.requests).toEqual([]);
    });

    it("the files of the store keep their own codes", async () => {
      const cases: [string, Uint8Array, string][] = [
        ["html", sampleHtml(), "unsupported_type"],
        ["svg", sampleSvg(), "unsupported_type"],
        ["heic", sampleHeic(), "unsupported_heic"],
        ["text", new TextEncoder().encode("just words"), "unsupported_type"],
        ["empty", new Uint8Array(0), "empty"],
        [
          "a broken image",
          Buffer.concat([plainPng().subarray(0, 40), Buffer.alloc(20)]),
          "corrupt_image",
        ],
      ];
      for (const [name, bytes, code] of cases) {
        const site = web.serve(() => new Response(bytes as BlobPart));
        const err = await fileFailure(attach(`${site.origin}/x`));
        expect([name, err.code]).toEqual([name, code]);
      }
      expect(await stored()).toEqual([]);
    });

    it("a page of the web is not a picture, however it is served", async () => {
      const site = web.serve(
        () =>
          new Response(sampleHtml() as BlobPart, {
            headers: { "content-type": "image/png" },
          }),
      );
      expect((await fileFailure(attach(`${site.origin}/fake.png`))).code).toBe(
        "unsupported_type",
      );
    });

    it.each([
      ["a private address", "http://192.168.1.20/a.png"],
      ["the metadata address", "http://169.254.169.254/latest/meta-data/"],
      ["a unique local address", "http://[fd00::1]/a.png"],
    ])(
      "refuses %s as blocked_host on url, without any connection",
      async (_name, url) => {
        const err = await failure(attach(url));
        expect(err.code).toBe("invalid_request");
        expect(detailsOf(err).code).toBe("blocked_host");
        expect(fieldErrors(err, "url")).toHaveLength(1);
        expect(detailsOf(err)).not.toHaveProperty("status");
      },
    );

    it("refuses what the policy refuses once the lenient mode of the tests is off: the standard ports, names that resolve inside", async () => {
      setLenientHostPolicy(false);
      setHostResolver(async (host) =>
        host === "intranet.example.org" ? ["10.1.2.3"] : ["93.184.216.34"],
      );
      const original = globalThis.fetch;
      const spy = vi.fn(async () => image(plainPng()));
      globalThis.fetch = spy as unknown as typeof fetch;
      try {
        for (const url of [
          "https://intranet.example.org/a.png",
          "https://docs.example.org:8443/a.png",
          "http://127.0.0.1/a.png",
        ]) {
          expect(detailsOf(await failure(attach(url))).code, url).toBe(
            "blocked_host",
          );
        }
        expect(spy).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = original;
      }
    });

    it("reports the status of an error answer", async () => {
      const site = web.serve(() => new Response("gone", { status: 404 }));
      const err = await failure(attach(`${site.origin}/a.png`));
      expect(err.code).toBe("invalid_request");
      expect(detailsOf(err)).toMatchObject({
        code: "upstream_status",
        status: 404,
      });
      expect(fieldErrors(err, "url")).toHaveLength(1);
    });

    it("reports a redirect loop, a file that is too large and a server that does not answer", async () => {
      const loop = web.serve(() => Response.redirect("/", 302));
      expect(detailsOf(await failure(attach(`${loop.origin}/`))).code).toBe(
        "too_many_redirects",
      );

      const big = web.serve(() => new Response(new Uint8Array(2048)));
      expect(
        detailsOf(
          await failure(attach(`${big.origin}/`, {}, { maxBytes: 1024 })),
        ).code,
      ).toBe("too_large");

      const slow = web.serve(async () => {
        await Bun.sleep(1000);
        return image(plainPng());
      });
      expect(
        detailsOf(
          await failure(attach(`${slow.origin}/`, {}, { timeoutMs: 100 })),
        ).code,
      ).toBe("unreachable");

      const port = await web.closedPort();
      expect(
        detailsOf(await failure(attach(`http://127.0.0.1:${port}/`))).code,
      ).toBe("unreachable");
    });

    it("stores nothing when anything fails", async () => {
      const bad = web.serve(() => new Response("no", { status: 500 }));
      await failure(attach(`${bad.origin}/`));
      expect(test.db.select().from(attachments).all()).toEqual([]);
      expect(await stored()).toEqual([]);
    });

    it("logs the code and nothing of the address", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const site = web.serve(() => new Response("no", { status: 502 }));
      await failure(attach(`${site.origin}/geheim/handbuch.png?token=abc123`));
      const lines = warn.mock.calls.map((call) => String(call[0]));
      expect(lines).toEqual([
        JSON.stringify({
          event: "attachments.from_url_failed",
          code: "upstream_status",
          status: 502,
        }),
      ]);
      expect(lines.join("")).not.toMatch(/geheim|abc123|127\.0\.0\.1/);
    });
  });
});
