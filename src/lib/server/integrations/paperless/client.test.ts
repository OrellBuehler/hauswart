import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  PaperlessClient,
  PaperlessError,
  customFieldDate,
  describeError,
  errorCode,
  filenameFromDisposition,
  messageForCode,
  normalizeBaseUrl,
  sanitizeFilename,
} from "./index";
import { startFakePaperless } from "./fake-server";

const fake = startFakePaperless();
afterAll(() => fake.stop());
beforeEach(() => fake.reset());

const client = (
  over: Partial<ConstructorParameters<typeof PaperlessClient>[0]> = {},
) =>
  new PaperlessClient({ baseUrl: fake.baseUrl, token: "test-token", ...over });

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof PaperlessError) return err.code;
    throw err;
  }
  return "none";
}

const idList = z.object({ id: z.number() });
const list = z.object({ results: z.array(idList) });

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

describe("normalizeBaseUrl", () => {
  it("keeps origin and path prefix, drops trailing slashes, query and fragment", () => {
    expect(normalizeBaseUrl(" https://paperless.example.org/ ")).toBe(
      "https://paperless.example.org",
    );
    expect(normalizeBaseUrl("http://10.0.0.5:8000/paperless//")).toBe(
      "http://10.0.0.5:8000/paperless",
    );
    expect(normalizeBaseUrl("https://p.example.org/sub?x=1#y")).toBe(
      "https://p.example.org/sub",
    );
  });

  it("allows private and loopback addresses (admin-configured, LAN)", () => {
    expect(normalizeBaseUrl("http://192.168.1.10:8000")).toBe(
      "http://192.168.1.10:8000",
    );
    expect(normalizeBaseUrl("http://localhost:8000")).toBe(
      "http://localhost:8000",
    );
  });

  it("rejects other schemes, credentials and garbage", () => {
    for (const bad of [
      "ftp://p.example.org",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://user:pw@p.example.org",
      "https://user@p.example.org",
      "not a url",
      "",
    ]) {
      expect(() => normalizeBaseUrl(bad), bad).toThrow(PaperlessError);
    }
  });
});

describe("requests", () => {
  it("sends the token and asks for API version 9 first", async () => {
    await client().json("documents", list);
    const req = fake.requests[0]!;
    expect(req.headers.get("authorization")).toBe("Token test-token");
    expect(req.headers.get("accept")).toBe("application/json; version=9");
  });

  it("retries once with version 10 after a 406 and remembers it", async () => {
    fake.accepted = [10];
    const c = client();
    await c.json("documents", list);
    expect(fake.requests.map((r) => r.headers.get("accept"))).toEqual([
      "application/json; version=9",
      "application/json; version=10",
    ]);
    expect(c.apiVersion).toBe(10);
    fake.requests = [];
    await c.json("documents", list);
    expect(fake.requests).toHaveLength(1);
  });

  it("reports version when neither API version works", async () => {
    fake.accepted = [];
    expect(await codeOf(client().json("documents", list))).toBe("version");
  });

  it("always requests URLs with a trailing slash and supports a path prefix", async () => {
    const c = client();
    expect(c.url("documents")).toBe(`${fake.baseUrl}/api/documents/`);
    expect(c.url("/documents/5/download/", { original: "true" })).toBe(
      `${fake.baseUrl}/api/documents/5/download/?original=true`,
    );
    fake.prefix = "/paperless";
    await client().json("documents", list);
    expect(fake.requests.at(-1)!.path).toBe("/paperless/api/documents/");
    expect(fake.requests.every((r) => r.path.endsWith("/"))).toBe(true);
  });

  it("refuses redirects instead of following them", async () => {
    fake.redirectAll = true;
    expect(await codeOf(client().json("documents", list))).toBe("redirect");
    expect(fake.requests).toHaveLength(1);
  });

  it("times out slow servers with a timeout error", async () => {
    fake.delayMs = 400;
    expect(
      await codeOf(client({ timeoutMs: 50 }).json("documents", list)),
    ).toBe("timeout");
  });

  it("maps 401, 403, 404 and 500 and never leaks the token into messages", async () => {
    fake.token = "other";
    const unauthorized = client().json("documents", z.unknown());
    await expect(unauthorized).rejects.toMatchObject({ code: "unauthorized" });
    await unauthorized.catch((e: Error) => {
      expect(e.message).not.toContain("test-token");
    });
    fake.token = "test-token";
    fake.failNext("custom_fields", 403);
    expect(await codeOf(client().listCustomFields())).toBe("forbidden");
    expect(await codeOf(client().getDocument(999))).toBe("not_found");
    fake.failNext("tags", 500);
    expect(await codeOf(client().listTags())).toBe("server");
    fake.failNext("tags", 400);
    expect(await codeOf(client().listTags())).toBe("bad_request");
  });

  it("maps an unreachable server to network", async () => {
    const probe = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response("x"),
    });
    const closedPort = probe.port;
    await probe.stop(true);
    expect(
      await codeOf(
        new PaperlessClient({
          baseUrl: `http://127.0.0.1:${closedPort}`,
          token: "x",
          timeoutMs: 2000,
        }).json("documents", z.unknown()),
      ),
    ).toBe("network");
  });

  it("rejects unexpected response shapes without echoing them", async () => {
    const err = await client()
      .json("documents", z.object({ nothing: z.string() }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaperlessError);
    expect((err as PaperlessError).code).toBe("invalid_response");
  });

  it("caps JSON bodies", async () => {
    fake.addDoc({ id: 1 });
    expect(
      await codeOf(client({ maxJsonBytes: 20 }).json("documents", z.unknown())),
    ).toBe("too_large");
  });

  it("never disables certificate verification unless the connection allows it", async () => {
    const seen: Array<unknown> = [];
    const real = globalThis.fetch;
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        seen.push((init as { tls?: unknown } | undefined)?.tls);
        return real(input, init);
      });
    try {
      await client().json("documents", z.unknown());
      await client({ allowInsecureTls: false }).json("documents", z.unknown());
      expect(seen).toEqual([undefined, undefined]);
      await client({ allowInsecureTls: true }).json("documents", z.unknown());
      // nosemgrep: problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification -- test-only: asserts the opt-in insecure path
      expect(seen[2]).toEqual({ rejectUnauthorized: false });
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects tokens that could break the header without quoting them", () => {
    for (const token of ["", "a b", "x\r\nHost: evil", "tok\u0000"]) {
      const err = (() => {
        try {
          client({ token });
        } catch (e) {
          return e as PaperlessError;
        }
      })();
      expect(err).toBeInstanceOf(PaperlessError);
      expect(err!.code).toBe("unauthorized");
      expect(err!.message).not.toContain("evil");
    }
  });

  it("has a message for every stored code", () => {
    expect(messageForCode("tls")).toMatch(/certificate/);
    expect(messageForCode("version")).toMatch(/2\.16/);
    expect(messageForCode("whatever")).toBe("An unexpected error occurred.");
    expect(errorCode(new PaperlessError("timeout"))).toBe("timeout");
    expect(describeError(new PaperlessError("forbidden"))).toMatch(
      /permission/,
    );
  });
});

describe("pagination", () => {
  it("walks all pages and never contacts the host named in `next`", async () => {
    for (let i = 1; i <= 5; i++) fake.addDoc({ id: i });
    fake.pageSize = 2;
    fake.wrongHostNext = true;
    const ids: number[] = [];
    for await (const page of client().pages(
      "documents",
      { page_size: 2 },
      idList,
    )) {
      ids.push(...page.map((d) => d.id));
    }
    expect(ids).toEqual([1, 2, 3, 4, 5]);
    expect(fake.requests).toHaveLength(3);
  });

  it("fails on a next link that does not advance", async () => {
    for (let i = 1; i <= 3; i++) fake.addDoc({ id: i });
    fake.pageSize = 1;
    const c = client();
    const original = c.json.bind(c);
    c.json = (async (path: string, schema: z.ZodType, options: unknown) => {
      const page = (await original(path, schema, options as never)) as {
        next?: string | null;
      };
      page.next = `${fake.origin}/api/documents/?page_size=1`;
      return page;
    }) as never;
    const walk = async () => {
      for await (const page of c.pages("documents", { page_size: 1 }, idList)) {
        void page;
      }
    };
    expect(await codeOf(walk())).toBe("invalid_response");
  });
});

describe("serverInfo", () => {
  it("reports versions and the token user", async () => {
    fake.user = { id: 4, username: "svc", is_superuser: true };
    const c = client();
    expect(await c.serverInfo()).toEqual({
      serverVersion: "2.20.3",
      maxApiVersion: 10,
      apiVersion: 9,
      user: { id: 4, username: "svc", isSuperuser: true },
    });
  });

  it("fails on a bad token", async () => {
    fake.token = "other";
    expect(await codeOf(client().serverInfo())).toBe("unauthorized");
  });
});

describe("documents", () => {
  beforeEach(() => {
    fake.customFields = [
      { id: 1, name: "Warranty until", data_type: "date" },
      { id: 2, name: "Model", data_type: "string" },
    ];
    fake.addDoc({
      id: 1,
      title: "Washer invoice",
      tags: [10, 11],
      correspondent: 5,
      created: "2026-02-01",
      custom_fields: [
        { field: 1, value: "2028-02-01" },
        { field: 2, value: "WX-1" },
      ],
      owner: 1,
      notes: [{ id: 1, note: "hi", created: "2026-02-02T00:00:00Z", user: 1 }],
    });
    fake.addDoc({
      id: 2,
      title: "Boiler service",
      tags: [10],
      correspondent: 6,
      created: "2025-06-01",
      custom_fields: [{ field: 1, value: "2026-06-01" }],
    });
    fake.addDoc({ id: 3, title: "Lease", tags: [12], created: "2024-01-01" });
  });

  it("lists with filters, ordering and paging, without OCR content", async () => {
    const page = await client().listDocuments({
      tagsAll: [10],
      ordering: "-created",
      pageSize: 10,
    });
    expect(page.results.map((d) => d.id)).toEqual([1, 2]);
    expect(page.count).toBe(2);
    expect(page.hasNext).toBe(false);
    expect(page.results[0]).toMatchObject({
      title: "Washer invoice",
      createdDate: "2026-02-01",
      correspondent: 5,
      tags: [10, 11],
      noteCount: 1,
      content: null,
      searchHit: null,
    });
    const req = fake.requests[0]!;
    expect(req.query.get("tags__id__all")).toBe("10");
    expect(req.query.get("ordering")).toBe("-created");
    expect(req.query.get("fields")).not.toContain("content");
  });

  it("filters by correspondent, tags none/any, ids and modification time", async () => {
    const c = client();
    expect(
      (await c.listDocuments({ correspondentId: 6 })).results.map((d) => d.id),
    ).toEqual([2]);
    expect(
      (await c.listDocuments({ tagsNone: [10] })).results.map((d) => d.id),
    ).toEqual([3]);
    expect(
      (await c.listDocuments({ tagsAny: [11, 12] })).results.map((d) => d.id),
    ).toEqual([1, 3]);
    expect(
      (await c.listDocuments({ idIn: [2, 3] })).results.map((d) => d.id),
    ).toEqual([2, 3]);
    expect(
      (await c.listDocuments({ modifiedAfter: "2030-01-01T00:00:00Z" }))
        .results,
    ).toEqual([]);
  });

  it("pages through results and reports hasNext", async () => {
    const c = client();
    const first = await c.listDocuments({ pageSize: 2 });
    expect(first.hasNext).toBe(true);
    expect(first.count).toBe(3);
    const second = await c.listDocuments({ pageSize: 2, page: 2 });
    expect(second.results.map((d) => d.id)).toEqual([3]);
    const all: number[] = [];
    for await (const chunk of c.iterateDocuments({ pageSize: 1 })) {
      all.push(...chunk.map((d) => d.id));
    }
    expect(all).toEqual([1, 2, 3]);
  });

  it("filters with custom_field_query by field name", async () => {
    const c = client();
    const due = await c.listDocuments({
      customFieldQuery: [
        "Warranty until",
        "range",
        ["2026-01-01", "2026-12-31"],
      ],
    });
    expect(due.results.map((d) => d.id)).toEqual([2]);
    expect(fake.requests.at(-1)!.query.get("custom_field_query")).toBe(
      '["Warranty until","range",["2026-01-01","2026-12-31"]]',
    );
    const either = await c.listDocuments({
      customFieldQuery: [
        "OR",
        [
          ["Model", "exact", "WX-1"],
          ["Warranty until", "lt", "2027-01-01"],
        ],
      ],
    });
    expect(either.results.map((d) => d.id)).toEqual([1, 2]);
    const missing = await c.listDocuments({
      customFieldQuery: ["Warranty until", "exists", false],
    });
    expect(missing.results.map((d) => d.id)).toEqual([3]);
  });

  it("full-text search returns hits with highlights stripped of markup", async () => {
    const page = await client().listDocuments({ query: "washer" });
    expect(page.results.map((d) => d.id)).toEqual([1]);
    const hit = page.results[0]!.searchHit!;
    expect(hit.rank).toBe(0);
    expect(hit.highlights).toBe("text washer x text");
    expect(hit.highlights).not.toMatch(/[<>]/);
  });

  it("validates list parameters before sending anything", async () => {
    const c = client();
    for (const bad of [
      { ordering: "id; drop" },
      { ordering: "../x" },
      { pageSize: 0 },
      { pageSize: 101 },
      { tagsAll: [0] },
      { tagsAll: [1.5] },
      { correspondentId: -1 },
      { modifiedAfter: "yesterday" },
      { query: "x".repeat(501) },
      { page: 0 },
    ]) {
      expect(await codeOf(c.listDocuments(bad)), JSON.stringify(bad)).toBe(
        "invalid_input",
      );
    }
    expect(fake.requests).toHaveLength(0);
  });

  it("gets one document with content, custom fields and note count", async () => {
    const doc = await client().getDocument(1);
    expect(doc.content).toMatch(/Synthetic OCR/);
    expect(doc.customFields).toEqual([
      { field: 1, value: "2028-02-01" },
      { field: 2, value: "WX-1" },
    ]);
    expect(doc.noteCount).toBe(1);
    expect(customFieldDate(doc, 1)).toBe("2028-02-01");
    expect(customFieldDate(doc, 2)).toBeNull();
    expect(customFieldDate(doc, 99)).toBeNull();
    expect(await codeOf(client().getDocument(404))).toBe("not_found");
    expect(await codeOf(client().getDocument(0))).toBe("invalid_input");
  });

  it("reads datetime created values as dates", async () => {
    fake.addDoc({ id: 7, created: "2024-03-05T00:00:00+01:00" });
    expect((await client().getDocument(7)).createdDate).toBe("2024-03-05");
  });

  it("reads and adds notes", async () => {
    const c = client();
    expect(await c.getDocumentNotes(1)).toEqual([
      { id: 1, note: "hi", created: "2026-02-02T00:00:00Z", userId: 1 },
    ]);
    const after = await c.addDocumentNote(2, "  Serviced on site  ");
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ note: "Serviced on site", userId: 1 });
    expect(fake.requestsTo("/documents/2/notes/", "POST")[0]!.json).toEqual({
      note: "Serviced on site",
    });
    expect((await c.getDocument(2)).noteCount).toBe(1);
    expect(await codeOf(c.addDocumentNote(2, "   "))).toBe("invalid_input");
    expect(await codeOf(c.addDocumentNote(2, "x".repeat(10_001)))).toBe(
      "invalid_input",
    );
    expect(await codeOf(c.getDocumentNotes(999))).toBe("not_found");
  });

  it("builds the web UI url from a validated id", () => {
    expect(client().documentUrl(42)).toBe(
      `${fake.baseUrl}/documents/42/details`,
    );
    expect(() => client().documentUrl(NaN)).toThrow(PaperlessError);
  });

  it("updates documents with PATCH and validates the patch", async () => {
    const c = client();
    const updated = await c.updateDocument(3, {
      title: "Lease 2024",
      tags: [12, 13],
      correspondent: null,
      customFields: [{ field: 1, value: "2030-01-01" }],
    });
    expect(updated).toMatchObject({ title: "Lease 2024", tags: [12, 13] });
    expect(fake.requestsTo("/documents/3/", "PATCH")[0]!.json).toEqual({
      title: "Lease 2024",
      tags: [12, 13],
      correspondent: null,
      custom_fields: [{ field: 1, value: "2030-01-01" }],
    });
    expect(await codeOf(c.updateDocument(3, {}))).toBe("invalid_input");
    expect(await codeOf(c.updateDocument(3, { tags: [-1] }))).toBe(
      "invalid_input",
    );
  });
});

describe("files", () => {
  const pdf = new TextEncoder().encode("%PDF-1.4\nsynthetic\n%%EOF");

  it("streams preview, thumbnail and download with type and file name", async () => {
    fake.addDoc({
      id: 1,
      original: pdf,
      original_file_name: "invoice.pdf",
    });
    const c = client();
    const preview = await c.openDocumentFile(1, "preview");
    expect(preview).toMatchObject({
      contentType: "application/pdf",
      inlineSafe: true,
      filename: "invoice.pdf",
      size: pdf.byteLength,
    });
    expect(await readAll(preview.stream)).toBe(new TextDecoder().decode(pdf));
    const thumb = await c.openDocumentFile(1, "thumb");
    expect(thumb.contentType).toBe("image/webp");
    expect(thumb.inlineSafe).toBe(true);
    await readAll(thumb.stream);
    const dl = await c.openDocumentFile(1, "download", { original: true });
    expect(await readAll(dl.stream)).toBe(new TextDecoder().decode(pdf));
    expect(fake.requests.at(-1)!.query.get("original")).toBe("true");
  });

  it("never lets an unsafe content type through as inline", async () => {
    fake.addDoc({
      id: 1,
      original: pdf,
      contentType: "text/html; charset=utf-8",
    });
    fake.addDoc({ id: 2, original: pdf, contentType: "image/svg+xml" });
    const c = client();
    for (const id of [1, 2]) {
      const f = await c.openDocumentFile(id, "preview");
      expect(f.contentType).toBe("application/octet-stream");
      expect(f.inlineSafe).toBe(false);
      await readAll(f.stream);
    }
  });

  it("sanitises the file name from the server", async () => {
    fake.addDoc({
      id: 1,
      original: pdf,
      disposition: `attachment; filename="../../etc/pass\\"wd.pdf"`,
    });
    fake.addDoc({
      id: 2,
      original: pdf,
      disposition: "attachment; filename*=UTF-8''Rechnung%20K%C3%BCche.pdf",
    });
    fake.addDoc({ id: 3, original: pdf, disposition: "attachment" });
    const c = client();
    const a = await c.openDocumentFile(1, "download");
    expect(a.filename).not.toMatch(/[/\\\r\n"]/);
    await readAll(a.stream);
    const b = await c.openDocumentFile(2, "download");
    expect(b.filename).toBe("Rechnung Küche.pdf");
    await readAll(b.stream);
    const d = await c.openDocumentFile(3, "download");
    expect(d.filename).toBe("document-3");
    await readAll(d.stream);
  });

  it("enforces the size cap from content-length before reading", async () => {
    fake.addDoc({ id: 1, original: pdf });
    expect(
      await codeOf(
        client({ maxDownloadBytes: 10 }).openDocumentFile(1, "download"),
      ),
    ).toBe("too_large");
  });

  it("enforces the size cap on streams without content-length", async () => {
    fake.addDoc({ id: 1, original: new Uint8Array(400) });
    fake.downloadMode = "chunked";
    const file = await client({ maxDownloadBytes: 250 }).openDocumentFile(
      1,
      "download",
    );
    expect(file.size).toBeNull();
    await expect(readAll(file.stream)).rejects.toMatchObject({
      code: "too_large",
    });
  });

  it("times out a stalled download", async () => {
    fake.addDoc({ id: 1, original: new Uint8Array(400) });
    fake.downloadMode = "stall";
    const file = await client({ downloadTimeoutMs: 150 }).openDocumentFile(
      1,
      "download",
    );
    await expect(readAll(file.stream)).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it("maps a missing document or file and refuses redirects", async () => {
    expect(await codeOf(client().openDocumentFile(42, "preview"))).toBe(
      "not_found",
    );
    fake.addDoc({ id: 1 });
    expect(await codeOf(client().openDocumentFile(1, "preview"))).toBe(
      "not_found",
    );
    fake.redirectAll = true;
    expect(await codeOf(client().openDocumentFile(1, "preview"))).toBe(
      "redirect",
    );
    expect(await codeOf(client().openDocumentFile(0, "preview"))).toBe(
      "invalid_input",
    );
  });

  it("enforces the size cap on whole-file downloads without content-length", async () => {
    fake.addDoc({ id: 1, original: new Uint8Array(400) });
    fake.downloadMode = "chunked";
    expect(
      await codeOf(
        client({ maxDownloadBytes: 250 }).download("documents/1/download", {
          original: "true",
        }),
      ),
    ).toBe("too_large");
  });

  it("downloads whole files with a type check", async () => {
    fake.addDoc({ id: 1, original: pdf });
    fake.addDoc({ id: 2, original: pdf, contentType: "text/html" });
    const c = client();
    const bytes = await c.download("documents/1/download", {
      original: "true",
    });
    expect(Array.from(bytes)).toEqual(Array.from(pdf));
    expect(await codeOf(c.download("documents/2/download"))).toBe("wrong_type");
    expect(
      await codeOf(
        client({ maxDownloadBytes: 10 }).download("documents/1/download"),
      ),
    ).toBe("too_large");
  });

  it("sanitises file names", () => {
    expect(sanitizeFilename("a/b\\c.pdf", "x")).toBe("a_b_c.pdf");
    expect(sanitizeFilename("..", "x")).toBe("x");
    expect(sanitizeFilename("   ", "x")).toBe("x");
    expect(sanitizeFilename("a".repeat(500), "x")).toHaveLength(200);
    expect(filenameFromDisposition(null, "fb")).toBe("fb");
    expect(filenameFromDisposition("inline; filename=plain.pdf", "fb")).toBe(
      "plain.pdf",
    );
    expect(
      filenameFromDisposition("attachment; filename*=UTF-8''%E0%A4%A", "fb"),
    ).toBe("fb");
  });
});

describe("upload and tasks", () => {
  const bytes = new TextEncoder().encode("%PDF-1.4 synthetic");

  it("uploads with metadata and returns the task id", async () => {
    const taskId = await client().postDocument({
      file: bytes,
      filename: "scan.pdf",
      contentType: "application/pdf",
      title: "Washer manual",
      created: "2026-03-04",
      tags: [3, 4],
      correspondent: 5,
      documentType: 6,
      storagePath: 7,
      customFields: [1, 2],
    });
    expect(taskId).toMatch(/^b3f1c0de-/);
    expect(fake.uploads).toHaveLength(1);
    expect(fake.uploads[0]).toMatchObject({
      title: "Washer manual",
      created: "2026-03-04",
      fileName: "scan.pdf",
      size: bytes.byteLength,
      contentType: "application/pdf",
      tags: ["3", "4"],
      correspondent: "5",
      documentType: "6",
      storagePath: "7",
      customFields: ["1", "2"],
    });
  });

  it("sends custom field values as one JSON field", async () => {
    await client().postDocument({
      file: bytes,
      filename: "scan.pdf",
      customFields: { 1: "2030-01-01" },
    });
    expect(fake.uploads[0]!.customFields).toEqual(['{"1":"2030-01-01"}']);
  });

  it("sanitises the upload file name and validates the input", async () => {
    const c = client();
    await c.postDocument({ file: bytes, filename: "../../x/y.pdf" });
    expect(fake.uploads[0]!.fileName).toBe("_.._x_y.pdf");
    expect(
      await codeOf(c.postDocument({ file: new Uint8Array(), filename: "a" })),
    ).toBe("invalid_input");
    expect(
      await codeOf(
        c.postDocument({ file: bytes, filename: "a", created: "last week" }),
      ),
    ).toBe("invalid_input");
    expect(
      await codeOf(c.postDocument({ file: bytes, filename: "a", tags: [0] })),
    ).toBe("invalid_input");
    expect(
      await codeOf(
        c.postDocument({
          file: bytes,
          filename: "a",
          customFields: { x: 1 } as unknown as Record<number, unknown>,
        }),
      ),
    ).toBe("invalid_input");
    expect(fake.uploads).toHaveLength(1);
  });

  it("refuses an oversized upload before sending it", async () => {
    expect(
      await codeOf(
        client({ maxUploadBytes: 5 }).postDocument({
          file: bytes,
          filename: "a.pdf",
        }),
      ),
    ).toBe("too_large");
    expect(fake.requests).toHaveLength(0);
  });

  it("maps a rejected upload", async () => {
    fake.uploadStatus = 400;
    expect(
      await codeOf(client().postDocument({ file: bytes, filename: "a.pdf" })),
    ).toBe("bad_request");
  });

  for (const shape of ["v9", "v10"] as const) {
    describe(`task shape ${shape}`, () => {
      beforeEach(() => {
        fake.taskShape = shape;
      });

      it("walks pending, started, success and creates the document", async () => {
        fake.taskSteps = ["missing", "pending", "started", "success"];
        const c = client();
        const id = await c.postDocument({
          file: bytes,
          filename: "a.pdf",
          title: "T",
        });
        expect(await c.getTask(id)).toBeNull();
        expect(await c.getTask(id)).toMatchObject({ status: "pending" });
        expect(await c.getTask(id)).toMatchObject({ status: "started" });
        expect(await c.getTask(id)).toEqual({
          status: "success",
          documentId: 900,
          duplicateOf: null,
        });
        expect((await c.getDocument(900)).title).toBe("T");
      });

      it("reports duplicates and failures", async () => {
        fake.taskSteps = ["duplicate"];
        const c = client();
        const dup = await c.postDocument({ file: bytes, filename: "a.pdf" });
        expect(await c.getTask(dup)).toEqual({
          status: "failure",
          documentId: null,
          duplicateOf: 7,
        });
        fake.taskSteps = ["failure"];
        const bad = await c.postDocument({ file: bytes, filename: "b.pdf" });
        expect(await c.getTask(bad)).toEqual({
          status: "failure",
          documentId: null,
          duplicateOf: null,
        });
      });

      it("waits for a task to finish", async () => {
        fake.taskSteps = ["pending", "started", "success"];
        const c = client();
        const id = await c.postDocument({ file: bytes, filename: "a.pdf" });
        const sleeps: number[] = [];
        const done = await c.waitForTask(id, {
          pollMs: 5,
          sleep: async (ms) => void sleeps.push(ms),
        });
        expect(done.status).toBe("success");
        expect(sleeps).toHaveLength(2);
      });
    });
  }

  it("times out waiting for a task that never finishes", async () => {
    fake.taskSteps = ["pending"];
    const c = client();
    const id = await c.postDocument({ file: bytes, filename: "a.pdf" });
    expect(await codeOf(c.waitForTask(id, { timeoutMs: 30, pollMs: 10 }))).toBe(
      "timeout",
    );
  });

  it("rejects malformed task ids and unknown tasks", async () => {
    const c = client();
    expect(await codeOf(c.getTask("../../x"))).toBe("invalid_input");
    expect(await c.getTask("00000000-0000-4000-8000-00000000dead")).toBeNull();
  });
});

describe("permissions", () => {
  beforeEach(() => {
    fake.addDoc({ id: 1, owner: 1 });
  });

  it("PATCHes owner and set_permissions in the documented shape", async () => {
    const doc = await client().setPermissions(1, {
      owner: 1,
      viewGroups: [2, 3],
      changeGroups: [2],
    });
    expect(fake.requestsTo("/documents/1/", "PATCH")[0]!.json).toEqual({
      set_permissions: {
        view: { users: [], groups: [2, 3] },
        change: { users: [], groups: [2] },
      },
      owner: 1,
    });
    expect(doc.permissions).toEqual({
      view: { users: [], groups: [2, 3] },
      change: { users: [], groups: [2] },
    });
    expect(doc.owner).toBe(1);
  });

  it("leaves the owner alone when omitted, clears it with null, keeps listed users", async () => {
    const c = client();
    await c.setPermissions(1, {
      viewUsers: [9],
      viewGroups: [],
      changeUsers: [9],
      changeGroups: [],
    });
    expect(fake.requestsTo("/documents/1/", "PATCH")[0]!.json).toEqual({
      set_permissions: {
        view: { users: [9], groups: [] },
        change: { users: [9], groups: [] },
      },
    });
    await c.setPermissions(1, {
      owner: null,
      viewGroups: [],
      changeGroups: [],
    });
    expect(
      (fake.requestsTo("/documents/1/", "PATCH")[1]!.json as { owner: null })
        .owner,
    ).toBeNull();
  });

  it("surfaces forbidden when the token user does not own the document", async () => {
    fake.addDoc({ id: 2, owner: 8 });
    expect(
      await codeOf(
        client().setPermissions(2, { viewGroups: [], changeGroups: [] }),
      ),
    ).toBe("forbidden");
    fake.user = { id: 1, username: "root", is_superuser: true };
    await client().setPermissions(2, { viewGroups: [], changeGroups: [] });
  });

  it("validates ids", async () => {
    const c = client();
    for (const input of [
      { viewGroups: [0], changeGroups: [] },
      { viewGroups: [], changeGroups: [1.2] },
      { viewGroups: [], changeGroups: [], owner: 0 },
      { viewGroups: "1" as unknown as number[], changeGroups: [] },
    ]) {
      expect(await codeOf(c.setPermissions(1, input))).toBe("invalid_input");
    }
    expect(fake.requestsTo("PATCH")).toHaveLength(0);
  });

  it("reads permissions back with fullPerms", async () => {
    const doc = await client().getDocument(1, { fullPerms: true });
    expect(doc.permissions).toEqual({
      view: { users: [], groups: [] },
      change: { users: [], groups: [] },
    });
    const page = await client().listDocuments({ fullPerms: true });
    expect(page.results[0]!.permissions).not.toBeNull();
    expect((await client().getDocument(1)).permissions).toBeNull();
  });
});

describe("taxonomy", () => {
  it("lists tags, correspondents, custom fields, groups and users across pages", async () => {
    fake.tags = Array.from({ length: 130 }, (_, i) => ({
      id: i + 1,
      name: `Tag ${i + 1}`,
      color: "#aabbcc",
      is_inbox_tag: i === 0,
      document_count: i,
      owner: null,
    }));
    fake.correspondents = [
      { id: 1, name: "Example Supplier", document_count: 3 },
      { id: 2, name: "Example Utility" },
    ];
    fake.customFields = [
      { id: 1, name: "Warranty until", data_type: "date" },
      {
        id: 2,
        name: "Kind",
        data_type: "select",
        extra_data: { select_options: [{ id: "a1", label: "Big" }, "Small"] },
      },
    ];
    fake.groups = [{ id: 1, name: "household" }];
    fake.users = [{ id: 1, username: "admin" }];
    const c = client();
    const tags = await c.listTags();
    expect(tags).toHaveLength(130);
    expect(tags[0]).toEqual({
      id: 1,
      name: "Tag 1",
      color: "#aabbcc",
      isInboxTag: true,
      documentCount: 0,
      owner: null,
    });
    expect(fake.requestsTo("/api/tags/")).toHaveLength(2);
    expect(await c.listCorrespondents()).toEqual([
      { id: 1, name: "Example Supplier", documentCount: 3, owner: null },
      { id: 2, name: "Example Utility", documentCount: null, owner: null },
    ]);
    expect(await c.listCustomFields()).toEqual([
      { id: 1, name: "Warranty until", dataType: "date", selectOptions: [] },
      {
        id: 2,
        name: "Kind",
        dataType: "select",
        selectOptions: [
          { id: "a1", label: "Big" },
          { id: null, label: "Small" },
        ],
      },
    ]);
    expect(await c.listGroups()).toEqual([{ id: 1, name: "household" }]);
    expect(await c.listUsers()).toEqual([{ id: 1, username: "admin" }]);
  });

  it("gets single correspondents and tags", async () => {
    fake.correspondents = [{ id: 5, name: "Example Supplier" }];
    fake.tags = [{ id: 2, name: "Inbox" }];
    const c = client();
    expect((await c.getCorrespondent(5)).name).toBe("Example Supplier");
    expect((await c.getTag(2)).name).toBe("Inbox");
    expect(await codeOf(c.getCorrespondent(6))).toBe("not_found");
    expect(await codeOf(c.getCorrespondent(-1))).toBe("invalid_input");
  });

  it("reports forbidden when the token cannot list groups", async () => {
    fake.failNext("groups", 403);
    expect(await codeOf(client().listGroups())).toBe("forbidden");
  });

  it("rejects malformed taxonomy payloads", async () => {
    fake.tags = [{ id: 1 } as never];
    expect(await codeOf(client().listTags())).toBe("invalid_response");
  });
});
