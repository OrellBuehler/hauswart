import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadImage } from "@napi-rs/canvas";
import { endpoints } from "$lib/api/registry";
import type { AiTask } from "$lib/api/schemas/ai-tasks";
import type { Scope } from "$lib/api/scopes";
import {
  createCaller,
  createInProcessFetch,
  errorCode,
} from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
  type TestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { sampleHeic, samplePdf, useTestFilesDir } from "$lib/testing/files";
import { createApiClient } from "$lib/api/client";
import { plainPng } from "$lib/server/files/test-images";

interface CostBody {
  id: string;
  reviewNeeded: boolean;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
}

describe("receipt queue API", () => {
  useTestDB();
  const files = useTestFilesDir();

  async function world() {
    const anna = await createTestUser({ displayName: "Anna", role: "admin" });
    const ben = await createTestUser({ displayName: "Ben" });
    const callAs = (user: TestUser) =>
      createCaller({ session: loginTestUser(user).token });
    const withScopes = (user: TestUser, scopes: Scope[]) =>
      createCaller({
        bearer: createTestToken(user, { kind: "mcp", scopes }).token,
      });
    const asAnna = callAs(anna);
    const asBen = callAs(ben);

    const form = (
      over: Record<string, unknown> = {},
      bytes: Uint8Array = plainPng(64, 48),
      name = "beleg.png",
      type = "image/png",
    ) => ({
      file: new File([bytes as BlobPart], name, { type }),
      ...over,
    });
    const upload = async (
      call: ReturnType<typeof createCaller> = asAnna,
      over: Record<string, unknown> = {},
    ) => {
      const r = await call("POST", "/api/v1/ai-tasks", { form: form(over) });
      expect(r.res.status).toBe(201);
      return r.body as AiTask;
    };
    const cost = async (
      call: ReturnType<typeof createCaller> = asAnna,
      over: Record<string, unknown> = {},
    ) => {
      const r = await call("POST", "/api/v1/costs", {
        json: {
          title: "Einkauf",
          amountMinor: 2340,
          category: "groceries",
          date: "2026-06-10",
          ...over,
        },
      });
      expect(r.res.status).toBe(201);
      return r.body as CostBody;
    };
    return { anna, ben, asAnna, asBen, withScopes, form, upload, cost };
  }

  describe("POST /ai-tasks", () => {
    it("queues an image for the caller, shared and pending, and answers with the task", async () => {
      const { anna, asAnna, form } = await world();
      const book = (
        await asAnna("POST", "/api/v1/cost-books", { json: { name: "Reise" } })
      ).body as { id: string };
      const asset = (
        await asAnna("POST", "/api/v1/assets", { json: { name: "Backofen" } })
      ).body as { id: string };
      const r = await asAnna("POST", "/api/v1/ai-tasks", {
        form: form({
          note: "  Wocheneinkauf  ",
          bookId: book.id,
          assetId: asset.id,
        }),
      });
      expect(r.res.status).toBe(201);
      expect(r.res.headers.get("cache-control")).toBe("no-store");
      const task = r.body as AiTask;
      expect(task).toMatchObject({
        kind: "receipt",
        status: "pending",
        note: "Wocheneinkauf",
        createdByUserId: anna.id,
        createdByName: "Anna",
        bookId: book.id,
        bookName: "Reise",
        assetId: asset.id,
        assetName: "Backofen",
        result: null,
        dismissReason: null,
        completedAt: null,
        completedVia: null,
        attachment: {
          ownerType: "ai_task",
          ownerId: task.id,
          mime: "image/png",
          width: 64,
          height: 48,
          url: expect.stringMatching(/^\/api\/v1\/attachments\/.+\/content$/),
          thumbUrl: expect.stringMatching(
            /^\/api\/v1\/attachments\/.+\/thumb$/,
          ),
        },
      });
    });

    it("takes a PDF and works with a token that holds costs:write", async () => {
      const { withScopes, ben, form } = await world();
      const call = withScopes(ben, ["read", "costs:write"]);
      const r = await call("POST", "/api/v1/ai-tasks", {
        form: form({}, samplePdf(), "rechnung.pdf", "application/pdf"),
      });
      expect(r.res.status).toBe(201);
      expect(r.body).toMatchObject({
        createdByUserId: ben.id,
        attachment: { mime: "application/pdf", thumbUrl: null },
      });
    });

    it("needs costs:write: a token with only write or read is refused", async () => {
      const { withScopes, ben, form } = await world();
      for (const scopes of [["read"], ["read", "write"]] as Scope[][]) {
        const r = await withScopes(ben, scopes)("POST", "/api/v1/ai-tasks", {
          form: form(),
        });
        expect([scopes, r.res.status, errorCode(r)]).toEqual([
          scopes,
          403,
          "forbidden",
        ]);
      }
      expect(await readdir(files.dir)).toEqual([]);
    });

    it.each([
      ["a note longer than 1000 characters", { note: "x".repeat(1001) }],
      ["a kind that cannot be queued yet", { kind: "fuel_receipt" }],
      ["a kind nobody knows", { kind: "recipe" }],
      ["a field the contract does not have", { status: "done" }],
      ["an empty book id", { bookId: "" }],
    ])("rejects %s with 400", async (_name, over) => {
      const { asAnna, form } = await world();
      const r = await asAnna("POST", "/api/v1/ai-tasks", { form: form(over) });
      expect(r.res.status).toBe(400);
      expect(errorCode(r)).toBe("invalid_request");
      expect(await readdir(files.dir)).toEqual([]);
    });

    it("rejects a request without a file", async () => {
      const { asAnna } = await world();
      const r = await asAnna("POST", "/api/v1/ai-tasks", {
        form: { note: "ohne Datei" },
      });
      expect(r.res.status).toBe(400);
      expect(errorCode(r)).toBe("invalid_request");
    });

    it("rejects a JSON body: the endpoint takes multipart", async () => {
      const { asAnna, ben, withScopes } = await world();
      const viaToken = await withScopes(ben, ["read", "costs:write"])(
        "POST",
        "/api/v1/ai-tasks",
        { json: { note: "x" } },
      );
      expect(viaToken.res.status).toBe(415);
      const viaSession = await asAnna("POST", "/api/v1/ai-tasks", {
        json: { note: "x" },
      });
      expect([viaSession.res.status, errorCode(viaSession)]).toEqual([
        403,
        "csrf_failed",
      ]);
    });

    it("names a book or a device that does not exist, and an archived book, on their fields", async () => {
      const { asAnna, form } = await world();
      const archived = (
        await asAnna("POST", "/api/v1/cost-books", { json: { name: "Alt" } })
      ).body as { id: string };
      await asAnna("POST", "/api/v1/cost-books", { json: { name: "Neu" } });
      await asAnna("PATCH", `/api/v1/cost-books/${archived.id}`, {
        json: { archived: true },
      });
      for (const [over, field] of [
        [{ bookId: "missing" }, "bookId"],
        [{ bookId: archived.id }, "bookId"],
        [{ assetId: "missing" }, "assetId"],
      ] as const) {
        const r = await asAnna("POST", "/api/v1/ai-tasks", {
          form: form(over),
        });
        expect(r.res.status).toBe(400);
        expect(
          (
            r.body as {
              error: { details: { body: { fieldErrors: object } } };
            }
          ).error.details.body.fieldErrors,
        ).toHaveProperty(field);
      }
      expect(await readdir(files.dir)).toEqual([]);
    });

    it.each([
      [
        "heic",
        () => sampleHeic(),
        "x.heic",
        "image/heic",
        415,
        "unsupported_heic",
      ],
      [
        "plain text",
        () => Buffer.from("hello"),
        "x.txt",
        "text/plain",
        415,
        "unsupported_type",
      ],
      ["empty", () => Buffer.alloc(0), "x.png", "image/png", 400, "empty"],
    ])(
      "rejects %s with %i and leaves nothing behind",
      async (_name, make, filename, type, status, code) => {
        const { asAnna, form } = await world();
        const r = await asAnna("POST", "/api/v1/ai-tasks", {
          form: form({}, make(), filename, type),
        });
        expect(r.res.status).toBe(status);
        expect(
          (r.body as { error: { details: { code: string } } }).error.details,
        ).toEqual({ code });
        expect(
          ((await asAnna("GET", "/api/v1/ai-tasks")).body as { items: [] })
            .items,
        ).toEqual([]);
        expect(await readdir(files.dir)).toEqual([]);
      },
    );
  });

  describe("reading", () => {
    it("shows every member every task, newest first, with filters", async () => {
      const { asAnna, asBen, upload, cost } = await world();
      const mine = await upload(asAnna);
      const theirs = await upload(asBen);
      const closed = await upload(asAnna);
      await asAnna("POST", `/api/v1/ai-tasks/${closed.id}/dismiss`, {
        json: {},
      });
      const body = async (query: string, call = asBen) =>
        (
          (await call("GET", `/api/v1/ai-tasks${query}`)).body as {
            items: AiTask[];
          }
        ).items.map((t) => t.id);
      expect(await body("")).toEqual([closed.id, theirs.id, mine.id]);
      expect(await body("?status=pending")).toEqual([theirs.id, mine.id]);
      expect(await body("?status=dismissed")).toEqual([closed.id]);
      expect(await body("?status=done")).toEqual([]);
      expect(await body("?kind=receipt")).toHaveLength(3);
      expect(await body("?kind=fuel_receipt")).toEqual([]);
      expect(await body("", asAnna)).toEqual([closed.id, theirs.id, mine.id]);
      const read = await asBen("GET", `/api/v1/ai-tasks/${mine.id}`);
      expect(read.res.status).toBe(200);
      expect(read.body).toMatchObject({ id: mine.id, createdByName: "Anna" });
      void cost;
    });

    it("pages with a cursor and refuses a forged one", async () => {
      const { asAnna, upload } = await world();
      const ids = [
        (await upload()).id,
        (await upload()).id,
        (await upload()).id,
      ];
      const first = (await asAnna("GET", "/api/v1/ai-tasks?limit=2")).body as {
        items: AiTask[];
        nextCursor: string;
      };
      const second = (
        await asAnna(
          "GET",
          `/api/v1/ai-tasks?limit=2&cursor=${first.nextCursor}`,
        )
      ).body as { items: AiTask[]; nextCursor: string | null };
      expect([...first.items, ...second.items].map((t) => t.id).sort()).toEqual(
        [...ids].sort(),
      );
      expect(second.nextCursor).toBeNull();
      const forged = await asAnna("GET", "/api/v1/ai-tasks?cursor=nonsense");
      expect(forged.res.status).toBe(400);
    });

    it("answers 404 for a task that does not exist and 400 for a status nobody knows", async () => {
      const { asAnna } = await world();
      expect((await asAnna("GET", "/api/v1/ai-tasks/missing")).res.status).toBe(
        404,
      );
      expect(
        (await asAnna("GET", "/api/v1/ai-tasks?status=waiting")).res.status,
      ).toBe(400);
    });

    it("lets a read-only token list and read, but not change", async () => {
      const { withScopes, anna, upload, asAnna } = await world();
      const task = await upload(asAnna);
      const reader = withScopes(anna, ["read"]);
      expect((await reader("GET", "/api/v1/ai-tasks")).res.status).toBe(200);
      expect(
        (await reader("GET", `/api/v1/ai-tasks/${task.id}`)).res.status,
      ).toBe(200);
      expect(
        (await reader("GET", `/api/v1/ai-tasks/${task.id}/preview`)).res.status,
      ).toBe(200);
      for (const [method, path, json] of [
        [
          "POST",
          `/api/v1/ai-tasks/${task.id}/complete`,
          { createdCostIds: ["x"] },
        ],
        ["POST", `/api/v1/ai-tasks/${task.id}/dismiss`, {}],
        ["DELETE", `/api/v1/ai-tasks/${task.id}`, undefined],
      ] as const) {
        const r = await reader(method, path, json ? { json } : {});
        expect([method, r.res.status]).toEqual([method, 403]);
      }
    });
  });

  describe("completing", () => {
    it("books the receipt onto the cost entry for review and the whole household sees the result", async () => {
      const { anna, asAnna, asBen, upload, cost } = await world();
      const task = await upload(asAnna);
      const entry = await cost(asBen, { title: "Migros Beispiel" });
      const r = await asBen("POST", `/api/v1/ai-tasks/${task.id}/complete`, {
        json: { createdCostIds: [entry.id], note: "Datum geschätzt" },
      });
      expect(r.res.status).toBe(200);
      expect(r.body).toMatchObject({
        id: task.id,
        status: "done",
        completedVia: "session",
        completedAt: expect.any(String),
        createdByUserId: anna.id,
        attachment: {
          id: task.attachment?.id,
          ownerType: "cost",
          ownerId: entry.id,
        },
        result: {
          createdCostIds: [entry.id],
          createdFuelLogIds: [],
          note: "Datum geschätzt",
          costs: [
            {
              id: entry.id,
              title: "Migros Beispiel",
              amountMinor: 2340,
              currency: "CHF",
              date: "2026-06-10",
              reviewNeeded: true,
            },
          ],
        },
      });
      const costNow = (await asAnna("GET", `/api/v1/costs/${entry.id}`))
        .body as CostBody;
      expect(costNow).toMatchObject({ reviewNeeded: true, reviewedAt: null });
      const receipts = (
        await asAnna(
          "GET",
          `/api/v1/attachments?ownerType=cost&ownerId=${entry.id}`,
        )
      ).body as { items: { id: string }[] };
      expect(receipts.items.map((a) => a.id)).toEqual([task.attachment?.id]);
      const file = await asAnna("GET", task.attachment!.url);
      expect(file.res.status).toBe(200);
      expect(file.res.headers.get("content-type")).toBe("image/png");
    });

    it("attributes a token by its kind", async () => {
      const { ben, asAnna, upload, cost, withScopes } = await world();
      const task = await upload(asAnna);
      const entry = await cost();
      const r = await withScopes(ben, ["read", "costs:write"])(
        "POST",
        `/api/v1/ai-tasks/${task.id}/complete`,
        { json: { createdCostIds: [entry.id] } },
      );
      expect(r.res.status).toBe(200);
      expect((r.body as AiTask).completedVia).toBe("mcp");
    });

    it("can report fuel log entries; the receipt goes to the cost entry each booked", async () => {
      const { asAnna, upload } = await world();
      const car = (
        await asAnna("POST", "/api/v1/assets", {
          json: { name: "Auto", kind: "vehicle" },
        })
      ).body as { id: string };
      const task = await upload(asAnna);
      const fill = (
        await asAnna("POST", `/api/v1/assets/${car.id}/fuel-logs`, {
          json: {
            date: "2026-06-01",
            odometer: 1000,
            quantity: 30,
            amountMinor: 5400,
          },
        })
      ).body as { id: string; costEntryId: string };
      const r = await asAnna("POST", `/api/v1/ai-tasks/${task.id}/complete`, {
        json: { createdFuelLogIds: [fill.id] },
      });
      expect(r.res.status).toBe(200);
      expect(r.body).toMatchObject({
        status: "done",
        result: {
          createdCostIds: [],
          createdFuelLogIds: [fill.id],
          costs: [{ id: fill.costEntryId, reviewNeeded: true }],
        },
        attachment: { ownerType: "cost", ownerId: fill.costEntryId },
      });
    });

    it("is idempotent: the same entries answer 200 again, other entries and a dismissed task 409", async () => {
      const { asAnna, upload, cost } = await world();
      const task = await upload(asAnna);
      const a = await cost(asAnna, { title: "A" });
      const b = await cost(asAnna, { title: "B" });
      const path = `/api/v1/ai-tasks/${task.id}/complete`;
      const first = await asAnna("POST", path, {
        json: { createdCostIds: [a.id, b.id] },
      });
      const again = await asAnna("POST", path, {
        json: { createdCostIds: [b.id, a.id], note: "ignored" },
      });
      expect([first.res.status, again.res.status]).toEqual([200, 200]);
      expect(again.body).toEqual(first.body);
      const other = await asAnna("POST", path, {
        json: { createdCostIds: [a.id] },
      });
      expect(other.res.status).toBe(409);
      expect(errorCode(other)).toBe("conflict");
      const dismissed = await upload(asAnna);
      await asAnna("POST", `/api/v1/ai-tasks/${dismissed.id}/dismiss`, {
        json: {},
      });
      const after = await asAnna(
        "POST",
        `/api/v1/ai-tasks/${dismissed.id}/complete`,
        { json: { createdCostIds: [a.id] } },
      );
      expect(after.res.status).toBe(409);
    });

    it.each([
      ["no entry at all", {}],
      ["empty lists", { createdCostIds: [], createdFuelLogIds: [] }],
      [
        "a field the contract does not have",
        { createdCostIds: ["x"], cost: 1 },
      ],
      [
        "more than 20 entries",
        { createdCostIds: Array.from({ length: 21 }, (_, i) => `c${i}`) },
      ],
      [
        "a note that is too long",
        { createdCostIds: ["x"], note: "x".repeat(2001) },
      ],
    ])("rejects %s with 400 and changes nothing", async (_name, json) => {
      const { asAnna, upload } = await world();
      const task = await upload(asAnna);
      const r = await asAnna("POST", `/api/v1/ai-tasks/${task.id}/complete`, {
        json,
      });
      expect(r.res.status).toBe(400);
      expect(errorCode(r)).toBe("invalid_request");
      expect(
        ((await asAnna("GET", `/api/v1/ai-tasks/${task.id}`)).body as AiTask)
          .status,
      ).toBe("pending");
    });

    it("names entries that do not exist and changes nothing", async () => {
      const { asAnna, upload, cost } = await world();
      const task = await upload(asAnna);
      const real = await cost();
      const r = await asAnna("POST", `/api/v1/ai-tasks/${task.id}/complete`, {
        json: {
          createdCostIds: [real.id, "ghost"],
          createdFuelLogIds: ["ghost-fuel"],
        },
      });
      expect(r.res.status).toBe(400);
      expect(
        (
          r.body as {
            error: {
              details: { body: { fieldErrors: Record<string, string[]> } };
            };
          }
        ).error.details.body.fieldErrors.createdCostIds[0],
      ).toContain("ghost");
      expect(
        ((await asAnna("GET", `/api/v1/costs/${real.id}`)).body as CostBody)
          .reviewNeeded,
      ).toBe(false);
      expect(
        ((await asAnna("GET", `/api/v1/ai-tasks/${task.id}`)).body as AiTask)
          .attachment?.ownerType,
      ).toBe("ai_task");
    });

    it("is a 404 for a task that does not exist", async () => {
      const { asAnna } = await world();
      const r = await asAnna("POST", "/api/v1/ai-tasks/missing/complete", {
        json: { createdCostIds: ["x"] },
      });
      expect(r.res.status).toBe(404);
    });
  });

  describe("dismissing", () => {
    it("closes the task with the reason; a repeat answers the same", async () => {
      const { asAnna, asBen, upload } = await world();
      const task = await upload(asAnna);
      const path = `/api/v1/ai-tasks/${task.id}/dismiss`;
      const first = await asBen("POST", path, {
        json: { reason: "Kein Beleg" },
      });
      expect(first.res.status).toBe(200);
      expect(first.body).toMatchObject({
        status: "dismissed",
        dismissReason: "Kein Beleg",
        completedVia: "session",
        result: null,
        attachment: { ownerType: "ai_task" },
      });
      const again = await asAnna("POST", path, { json: { reason: "Anders" } });
      expect(again.res.status).toBe(200);
      expect(again.body).toEqual(first.body);
    });

    it("takes `{}`, needs a JSON body, and refuses a reason that is too long or another field", async () => {
      const { asAnna, upload } = await world();
      const task = await upload(asAnna);
      const path = `/api/v1/ai-tasks/${task.id}/dismiss`;
      expect((await asAnna("POST", path, { json: {} })).res.status).toBe(200);
      const t2 = await upload(asAnna);
      const p2 = `/api/v1/ai-tasks/${t2.id}/dismiss`;
      expect((await asAnna("POST", p2, { rawBody: "" })).res.status).toBe(400);
      expect(
        (await asAnna("POST", p2, { json: { reason: "x".repeat(501) } })).res
          .status,
      ).toBe(400);
      expect(
        (await asAnna("POST", p2, { json: { why: "x" } })).res.status,
      ).toBe(400);
    });

    it("is a 409 for a task that is done, and a 404 for one that does not exist", async () => {
      const { asAnna, upload, cost } = await world();
      const task = await upload(asAnna);
      await asAnna("POST", `/api/v1/ai-tasks/${task.id}/complete`, {
        json: { createdCostIds: [(await cost()).id] },
      });
      expect(
        (
          await asAnna("POST", `/api/v1/ai-tasks/${task.id}/dismiss`, {
            json: {},
          })
        ).res.status,
      ).toBe(409);
      expect(
        (await asAnna("POST", "/api/v1/ai-tasks/missing/dismiss", { json: {} }))
          .res.status,
      ).toBe(404);
    });
  });

  describe("DELETE /ai-tasks/{id}", () => {
    it("lets the uploader delete, takes the file with the task and answers 204", async () => {
      const { asBen, upload } = await world();
      const task = await upload(asBen);
      const r = await asBen("DELETE", `/api/v1/ai-tasks/${task.id}`);
      expect(r.res.status).toBe(204);
      expect(
        (await asBen("GET", `/api/v1/ai-tasks/${task.id}`)).res.status,
      ).toBe(404);
      expect((await asBen("GET", task.attachment!.url)).res.status).toBe(404);
      expect(
        (await asBen("DELETE", `/api/v1/ai-tasks/${task.id}`)).res.status,
      ).toBe(404);
    });

    it("lets an administrator delete another person's task, and refuses another member with 403", async () => {
      const { asAnna, asBen, upload } = await world();
      const bens = await upload(asBen);
      const annas = await upload(asAnna);
      const refused = await asBen("DELETE", `/api/v1/ai-tasks/${annas.id}`);
      expect(refused.res.status).toBe(403);
      expect(errorCode(refused)).toBe("forbidden");
      expect(
        (await asAnna("DELETE", `/api/v1/ai-tasks/${bens.id}`)).res.status,
      ).toBe(204);
      expect(
        (await asAnna("GET", `/api/v1/ai-tasks/${annas.id}`)).res.status,
      ).toBe(200);
    });

    it("keeps the receipt on the cost entry when a done task is deleted", async () => {
      const { asAnna, upload, cost } = await world();
      const task = await upload(asAnna);
      const entry = await cost();
      await asAnna("POST", `/api/v1/ai-tasks/${task.id}/complete`, {
        json: { createdCostIds: [entry.id] },
      });
      expect(
        (await asAnna("DELETE", `/api/v1/ai-tasks/${task.id}`)).res.status,
      ).toBe(204);
      const receipts = (
        await asAnna(
          "GET",
          `/api/v1/attachments?ownerType=cost&ownerId=${entry.id}`,
        )
      ).body as { items: unknown[] };
      expect(receipts.items).toHaveLength(1);
      expect((await asAnna("GET", task.attachment!.url)).res.status).toBe(200);
    });
  });

  describe("the file of a task through the generic attachment endpoints", () => {
    it("cannot be added to or removed from there", async () => {
      const { asAnna, upload } = await world();
      const task = await upload(asAnna);
      const more = await asAnna("POST", "/api/v1/attachments", {
        form: {
          file: new File([plainPng() as BlobPart], "x.png", {
            type: "image/png",
          }),
          ownerType: "ai_task",
          ownerId: task.id,
        },
      });
      expect(more.res.status).toBe(400);
      expect(
        JSON.stringify(
          (more.body as { error: { details: unknown } }).error.details,
        ),
      ).toContain("ownerType");
      const remove = await asAnna(
        "DELETE",
        `/api/v1/attachments/${task.attachment!.id}`,
      );
      expect(remove.res.status).toBe(409);
      expect(errorCode(remove)).toBe("conflict");
      expect((await asAnna("GET", task.attachment!.url)).res.status).toBe(200);
    });

    it("needs costs:write like the receipts of a cost entry", async () => {
      const { ben, asAnna, upload, withScopes } = await world();
      const task = await upload(asAnna);
      const writer = withScopes(ben, ["read", "write"]);
      const r = await writer(
        "DELETE",
        `/api/v1/attachments/${task.attachment!.id}`,
      );
      expect(r.res.status).toBe(403);
    });
  });

  describe("GET /ai-tasks/{id}/preview", () => {
    it("sends a small image as it was stored", async () => {
      const { asAnna, upload } = await world();
      const task = await upload(asAnna);
      const stored = await asAnna("GET", task.attachment!.url);
      const r = await asAnna("GET", `/api/v1/ai-tasks/${task.id}/preview`);
      expect(r.res.status).toBe(200);
      expect(r.res.headers.get("content-type")).toBe("image/png");
      expect(r.res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.res.headers.get("cache-control")).toContain("private");
      expect(
        Buffer.from(r.body as Uint8Array).equals(
          Buffer.from(stored.body as Uint8Array),
        ),
      ).toBe(true);
    });

    it("scales a large image down to a JPEG of at most 1600 px", async () => {
      const { asAnna, form } = await world();
      const r0 = await asAnna("POST", "/api/v1/ai-tasks", {
        form: form({}, plainPng(3000, 2000)),
      });
      const task = r0.body as AiTask;
      expect(task.attachment).toMatchObject({ width: 3000, height: 2000 });
      const r = await asAnna("GET", `/api/v1/ai-tasks/${task.id}/preview`);
      expect(r.res.status).toBe(200);
      expect(r.res.headers.get("content-type")).toBe("image/jpeg");
      const image = await loadImage(Buffer.from(r.body as Uint8Array));
      expect([image.width, image.height]).toEqual([1600, 1067]);
      expect((r.body as Uint8Array).byteLength).toBeLessThan(1_500_000);
      expect(r.res.headers.get("content-disposition")).toContain(".jpg");
    });

    it("answers 304 to a matching If-None-Match", async () => {
      const { asAnna, upload } = await world();
      const task = await upload(asAnna);
      const first = await asAnna("GET", `/api/v1/ai-tasks/${task.id}/preview`);
      const etag = first.res.headers.get("etag")!;
      expect(etag).toBeTruthy();
      const second = await asAnna(
        "GET",
        `/api/v1/ai-tasks/${task.id}/preview`,
        {
          headers: { "if-none-match": etag },
        },
      );
      expect(second.res.status).toBe(304);
    });

    it("sends a PDF as stored", async () => {
      const { asAnna, form } = await world();
      const task = (
        await asAnna("POST", "/api/v1/ai-tasks", {
          form: form({}, samplePdf(), "rechnung.pdf", "application/pdf"),
        })
      ).body as AiTask;
      const r = await asAnna("GET", `/api/v1/ai-tasks/${task.id}/preview`);
      expect(r.res.headers.get("content-type")).toBe("application/pdf");
      expect(Buffer.from(r.body as Uint8Array).equals(samplePdf())).toBe(true);
    });

    it("is a 404 for a task without a file and for one that does not exist", async () => {
      const { asAnna, upload } = await world();
      const task = await upload(asAnna);
      // Done, and the entry that held the receipt was deleted.
      const entry = (
        await asAnna("POST", "/api/v1/costs", {
          json: { title: "x", amountMinor: 100, category: "other" },
        })
      ).body as CostBody;
      await asAnna("POST", `/api/v1/ai-tasks/${task.id}/complete`, {
        json: { createdCostIds: [entry.id] },
      });
      await asAnna("DELETE", `/api/v1/costs/${entry.id}`);
      expect(
        (await asAnna("GET", `/api/v1/ai-tasks/${task.id}/preview`)).res.status,
      ).toBe(404);
      expect(
        (await asAnna("GET", "/api/v1/ai-tasks/missing/preview")).res.status,
      ).toBe(404);
    });
  });

  describe("the typed client", () => {
    it("uploads with a bearer token and reads the preview as a Response", async () => {
      const { ben } = await world();
      const { token } = createTestToken(ben, {
        kind: "mcp",
        scopes: ["read", "costs:write"],
      });
      const api = createApiClient(createInProcessFetch(), "http://localhost", {
        token,
      });
      const task = await api.call(endpoints.aiTasksCreate, {
        body: {
          file: new File([plainPng() as BlobPart], "b.png", {
            type: "image/png",
          }),
          kind: "receipt",
          note: "Notiz",
        },
      });
      expect(task).toMatchObject({ status: "pending", note: "Notiz" });
      const preview = await api.call(endpoints.aiTasksPreview, {
        params: { id: task.id },
      });
      expect(preview.headers.get("content-type")).toBe("image/png");
      const done = await api.call(endpoints.aiTasksDismiss, {
        params: { id: task.id },
        body: {},
      });
      expect(done.completedVia).toBe("mcp");
    });
  });

  describe("reviewing what came out of it", () => {
    it("lists the flagged entries, counts them in the summary and the dashboard, and clears them with a review", async () => {
      const { anna, ben, asAnna, asBen, upload, cost } = await world();
      const task = await upload(asAnna);
      const flagged = await cost(asAnna, { title: "Vom Beleg" });
      const plain = await cost(asAnna, { title: "Von Hand" });
      await asBen("POST", `/api/v1/ai-tasks/${task.id}/complete`, {
        json: { createdCostIds: [flagged.id] },
      });
      const titles = async (query: string) =>
        (
          (await asAnna("GET", `/api/v1/costs${query}`)).body as {
            items: { title: string }[];
          }
        ).items.map((c) => c.title);
      expect(await titles("?reviewNeeded=true")).toEqual(["Vom Beleg"]);
      expect(await titles("?reviewNeeded=false")).toEqual(["Von Hand"]);
      expect(await titles("")).toHaveLength(2);
      expect(
        (await asAnna("GET", "/api/v1/costs?reviewNeeded=maybe")).res.status,
      ).toBe(400);
      const summary = (await asAnna("GET", "/api/v1/costs/summary?year=2026"))
        .body as { reviewNeededCount: number };
      expect(summary.reviewNeededCount).toBe(1);
      const dashboard = (await asAnna("GET", "/api/v1/dashboard")).body as {
        reviewNeededCount: number;
      };
      expect(dashboard.reviewNeededCount).toBe(1);

      const reviewed = await asBen(
        "POST",
        `/api/v1/costs/${flagged.id}/review`,
      );
      expect(reviewed.res.status).toBe(200);
      expect(reviewed.body).toMatchObject({
        id: flagged.id,
        reviewNeeded: false,
        reviewedByUserId: ben.id,
        reviewedAt: expect.any(String),
      });
      const again = await asAnna("POST", `/api/v1/costs/${flagged.id}/review`);
      expect(again.res.status).toBe(200);
      expect((again.body as CostBody).reviewedByUserId).toBe(ben.id);
      expect(await titles("?reviewNeeded=true")).toEqual([]);
      expect(
        (
          (await asAnna("GET", "/api/v1/dashboard")).body as {
            reviewNeededCount: number;
          }
        ).reviewNeededCount,
      ).toBe(0);
      expect(anna.id).not.toBe(ben.id);
      expect(
        (await asAnna("POST", `/api/v1/costs/${plain.id}/review`)).res.status,
      ).toBe(200);
    });

    it("needs costs:write and a cost entry that exists", async () => {
      const { ben, asAnna, cost, withScopes } = await world();
      const entry = await cost();
      const reader = withScopes(ben, ["read", "write"]);
      expect(
        (await reader("POST", `/api/v1/costs/${entry.id}/review`)).res.status,
      ).toBe(403);
      expect(
        (await asAnna("POST", "/api/v1/costs/missing/review")).res.status,
      ).toBe(404);
    });
  });
});
