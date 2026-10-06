import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  assetHints,
  assets,
  docPages,
  documentLinks,
  documentUploads,
} from "$lib/server/db";
import {
  createAttachment,
  settleBackgroundWork,
} from "$lib/server/attachments/attachments";
import {
  getConnectionRow,
  resolveConnection,
} from "$lib/server/connections/connections";
import {
  pruneFinishedUploads,
  resumeUploads,
} from "$lib/server/documents/uploads";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { makeAsset } from "$lib/testing/documents";
import { samplePdf, useTestFilesDir } from "$lib/testing/files";
import { paperlessDocumentProvider, uploadPolling } from "./provider";
import { syncAll } from "./sync";
import { TEST_CONFIG, seedTaxonomy, useFakePaperless } from "./testing";

const APP = "https://hauswart.example.org";

describe("pushing attachments to the document system", () => {
  const test = useTestDB();
  useTestFilesDir();
  const { fake, connect } = useFakePaperless();
  const ctx = () => ({ db: test.db, now: Date.now() });
  const body = <T = Record<string, unknown>>(r: { body: unknown }) =>
    r.body as T;

  async function world(config: Record<string, unknown> = TEST_CONFIG) {
    const [a, b] = [await createTestUser(), await createTestUser()];
    fake.addAccount("token-b", { id: 2, username: "second", groups: [50] });
    seedTaxonomy(fake);
    fake.strictPermissions = true;
    connect(a.id, { config: { ...config, appUrl: APP } });
    connect(b.id, { token: "token-b", config: { ...config, appUrl: APP } });
    const as = (u: typeof a) =>
      createCaller({ session: loginTestUser(u).token });
    const asset = makeAsset(ctx(), { name: "Dishwasher" });
    const attachment = await createAttachment(ctx(), {
      bytes: new Uint8Array(samplePdf()),
      filename: "Dishwasher manual.pdf",
      ownerType: "asset",
      ownerId: asset.id,
      uploadedBy: a.id,
    });
    return { a, b, asA: as(a), asB: as(b), asset, attachment };
  }

  const push = (
    as: ReturnType<typeof createCaller>,
    id: string,
    json: Record<string, unknown> = {},
  ) => as("POST", `/api/v1/attachments/${id}/push-to-documents`, { json });

  async function finish(
    as: ReturnType<typeof createCaller>,
    jobId: string,
  ): Promise<Record<string, unknown>> {
    await settleBackgroundWork();
    const r = await as("GET", `/api/v1/documents/uploads/${jobId}`);
    expect(r.res.status).toBe(200);
    return body(r);
  }

  describe("a successful push", () => {
    it("answers 202 with a job, uploads with the configured tags, storage path and correspondent, and links the document", async () => {
      const { a, asA, asset, attachment } = await world();
      const started = await push(asA, attachment.id, { role: "manual" });
      expect(started.res.status).toBe(202);
      expect(body(started)).toMatchObject({
        status: "queued",
        attachmentId: attachment.id,
        ownerType: "asset",
        ownerId: asset.id,
        role: "manual",
        title: "Dishwasher manual",
        externalId: null,
        linkId: null,
        errorCode: null,
      });
      const jobId = body<{ id: string }>(started).id;
      const job = await finish(asA, jobId);
      expect(job).toMatchObject({
        status: "done",
        externalId: 900,
        duplicate: false,
        errorCode: null,
        warning: null,
      });

      expect(fake.uploads).toHaveLength(1);
      expect(fake.uploads[0]).toMatchObject({
        title: "Dishwasher manual",
        fileName: "Dishwasher manual.pdf",
        contentType: "application/pdf",
        tags: ["5"],
        correspondent: "20",
        storagePath: "3",
      });
      const post = fake.requestsTo("/post_document/", "POST")[0];
      expect(post.headers.get("authorization")).toBe(`Token ${fake.token}`);

      // The link exists and points at the new document.
      const links = await asA(
        "GET",
        `/api/v1/document-links?ownerType=asset&ownerId=${asset.id}`,
      );
      expect(body<{ items: unknown[] }>(links).items).toMatchObject([
        {
          id: job.linkId,
          externalId: 900,
          role: "manual",
          available: true,
          createdBy: a.id,
          document: { title: "Dishwasher manual" },
        },
      ]);
    });

    it("sets the owner and the groups, so the rest of the household can read it", async () => {
      const { asA, asB, attachment } = await world();
      const jobId = body<{ id: string }>(await push(asA, attachment.id)).id;
      await finish(asA, jobId);
      const patch = fake.requestsTo("/api/documents/900/", "PATCH");
      expect(patch).toHaveLength(1);
      expect(patch[0].headers.get("authorization")).toBe(`Token ${fake.token}`);
      expect(patch[0].json).toEqual({
        owner: 1,
        set_permissions: {
          view: { users: [], groups: [50] },
          change: { users: [], groups: [50] },
        },
      });
      expect(fake.docs.get(900)).toMatchObject({
        owner: 1,
        permissions: {
          view: { groups: [50] },
          change: { groups: [50] },
        },
      });
      // The other member (in the group) reads it with their own account.
      expect(
        (await asB("GET", "/api/v1/documents/paperless/900")).res.status,
      ).toBe(200);
    });

    it("without groups in the settings the document stays private to its owner", async () => {
      const { asA, asB, attachment } = await world({
        ...TEST_CONFIG,
        shareGroupIds: [],
      });
      const jobId = body<{ id: string }>(await push(asA, attachment.id)).id;
      expect((await finish(asA, jobId)).status).toBe("done");
      expect(fake.requestsTo("/api/documents/900/", "PATCH")).toEqual([]);
      expect(
        (await asB("GET", "/api/v1/documents/paperless/900")).res.status,
      ).toBe(404);
    });

    it("uses the given title and label, and a plain upload without tags when none are configured", async () => {
      const { asA, attachment } = await world({ sharedTagIds: [1] });
      const jobId = body<{ id: string }>(
        await push(asA, attachment.id, {
          title: "Dishwasher: instructions",
          label: "Chapter 2",
          role: "datasheet",
        }),
      ).id;
      expect((await finish(asA, jobId)).status).toBe("done");
      expect(fake.uploads[0]).toMatchObject({
        title: "Dishwasher: instructions",
        tags: [],
        correspondent: null,
        storagePath: null,
      });
      expect(test.db.select().from(documentLinks).get()).toMatchObject({
        label: "Chapter 2",
        role: "datasheet",
      });
    });

    it("fills the warranty of the asset when the pushed file is a receipt", async () => {
      const { asA, asset, attachment } = await world();
      fake.docDefaults = {
        custom_fields: [{ field: 7, value: "2029-01-01" }],
      };
      const jobId = body<{ id: string }>(
        await push(asA, attachment.id, { role: "receipt" }),
      ).id;
      await finish(asA, jobId);
      expect(
        test.db.select().from(assets).where(eq(assets.id, asset.id)).get(),
      ).toMatchObject({
        warrantyUntil: "2029-01-01",
        warrantySource: "document",
      });
    });

    it("works with the v10 task shape of newer Paperless releases", async () => {
      const { asA, attachment } = await world();
      fake.taskShape = "v10";
      fake.taskSteps = ["pending", "started", "success"];
      const jobId = body<{ id: string }>(await push(asA, attachment.id)).id;
      expect((await finish(asA, jobId)).status).toBe("done");
    });
  });

  describe("notes with the hauswart link", () => {
    const notes = (id: number) => fake.docs.get(id)!.notes.map((n) => n.note);

    it("leaves one on a pushed document when the connection asks for it", async () => {
      const { asA, asset, attachment } = await world({
        ...TEST_CONFIG,
        writeBackNotes: true,
      });
      const jobId = body<{ id: string }>(await push(asA, attachment.id)).id;
      await finish(asA, jobId);
      expect(notes(900)).toEqual([
        `Verknüpft in hauswart: ${APP}/assets/${asset.id}`,
      ]);
    });

    it("leaves none by default", async () => {
      const { asA, attachment } = await world();
      const jobId = body<{ id: string }>(await push(asA, attachment.id)).id;
      await finish(asA, jobId);
      expect(notes(900)).toEqual([]);
      expect(fake.requestsTo("/notes/")).toEqual([]);
    });

    it("is added on a plain link too, once, however often and with whatever role the document is linked there", async () => {
      const { asA, asset } = await world({
        ...TEST_CONFIG,
        writeBackNotes: true,
      });
      fake.addDoc({ id: 10, title: "Lease" });
      for (const role of ["manual", "receipt", "other"]) {
        const r = await asA("POST", "/api/v1/document-links", {
          json: { externalId: 10, ownerType: "asset", ownerId: asset.id, role },
        });
        expect(r.res.status).toBe(201);
      }
      await settleBackgroundWork();
      expect(notes(10)).toEqual([
        `Verknüpft in hauswart: ${APP}/assets/${asset.id}`,
      ]);
      // Another owner is another note.
      const other = makeAsset(ctx(), { name: "Boiler" });
      await asA("POST", "/api/v1/document-links", {
        json: { externalId: 10, ownerType: "asset", ownerId: other.id },
      });
      await settleBackgroundWork();
      expect(notes(10)).toEqual([
        `Verknüpft in hauswart: ${APP}/assets/${asset.id}`,
        `Verknüpft in hauswart: ${APP}/assets/${other.id}`,
      ]);
    });

    it("links made at the same moment still leave one note", async () => {
      const { asA, asset } = await world({
        ...TEST_CONFIG,
        writeBackNotes: true,
      });
      fake.addDoc({ id: 10 });
      await Promise.all(
        ["manual", "receipt", "datasheet", "invoice"].map((role) =>
          asA("POST", "/api/v1/document-links", {
            json: {
              externalId: 10,
              ownerType: "asset",
              ownerId: asset.id,
              role,
            },
          }),
        ),
      );
      await settleBackgroundWork();
      expect(notes(10)).toHaveLength(1);
    });

    it("uses the server's ORIGIN when the settings name no address", async () => {
      const previous = process.env.ORIGIN;
      process.env.ORIGIN = "https://origin.example.org/";
      try {
        const [a] = [await createTestUser()];
        seedTaxonomy(fake);
        connect(a.id, { config: { writeBackNotes: true } });
        const asset = makeAsset(ctx());
        fake.addDoc({ id: 10 });
        await createCaller({ session: loginTestUser(a).token })(
          "POST",
          "/api/v1/document-links",
          { json: { externalId: 10, ownerType: "asset", ownerId: asset.id } },
        );
        await settleBackgroundWork();
        expect(notes(10)).toEqual([
          `Verknüpft in hauswart: https://origin.example.org/assets/${asset.id}`,
        ]);
      } finally {
        if (previous === undefined) delete process.env.ORIGIN;
        else process.env.ORIGIN = previous;
      }
    });

    it("never fails the link when the note cannot be written", async () => {
      const { asA, asset } = await world({
        ...TEST_CONFIG,
        writeBackNotes: true,
      });
      const log = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      fake.addDoc({ id: 10 });
      fake.failNext("/notes/", 500, { times: 2 });
      const r = await asA("POST", "/api/v1/document-links", {
        json: { externalId: 10, ownerType: "asset", ownerId: asset.id },
      });
      expect(r.res.status).toBe(201);
      await settleBackgroundWork();
      expect(notes(10)).toEqual([]);
      expect(JSON.stringify(log.mock.calls)).toContain("documents.note_failed");
      log.mockRestore();
    });

    it("reads the notes with the account of the person who linked", async () => {
      const { asB, asset } = await world({
        ...TEST_CONFIG,
        writeBackNotes: true,
      });
      fake.addDoc({ id: 10 });
      await asB("POST", "/api/v1/document-links", {
        json: { externalId: 10, ownerType: "asset", ownerId: asset.id },
      });
      await settleBackgroundWork();
      expect(
        fake.requestsTo("/notes/").map((r) => r.headers.get("authorization")),
      ).toEqual(["Token token-b", "Token token-b"]);
      expect(fake.docs.get(10)!.notes[0].user).toBe(2);
    });
  });

  describe("failures", () => {
    const failed = async (
      as: ReturnType<typeof createCaller>,
      attachmentId: string,
    ) => {
      const jobId = body<{ id: string }>(await push(as, attachmentId)).id;
      return finish(as, jobId);
    };

    it("a refused upload fails the job with the code and links nothing", async () => {
      const { asA, attachment } = await world();
      const log = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      fake.uploadStatus = 500;
      expect(await failed(asA, attachment.id)).toMatchObject({
        status: "failed",
        errorCode: "server",
        externalId: null,
        linkId: null,
      });
      expect(test.db.select().from(documentLinks).all()).toEqual([]);
      log.mockRestore();
    });

    it("a wrong token fails with unauthorized, and the file is never sent", async () => {
      const { asA, attachment } = await world();
      const log = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      fake.token = "rotated";
      expect(await failed(asA, attachment.id)).toMatchObject({
        status: "failed",
        errorCode: "unauthorized",
      });
      expect(fake.uploads).toEqual([]);
      log.mockRestore();
    });

    it("a file Paperless could not consume fails the job", async () => {
      const { asA, attachment } = await world();
      const log = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      fake.taskSteps = ["pending", "started", "failure"];
      expect(await failed(asA, attachment.id)).toMatchObject({
        status: "failed",
        errorCode: "consume_failed",
        linkId: null,
      });
      log.mockRestore();
    });

    it("a consumption that takes too long fails with timeout, keeping the task id", async () => {
      const { asA, attachment } = await world();
      const log = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      uploadPolling.timeoutMs = 30;
      uploadPolling.pollMs = 5;
      fake.taskSteps = ["pending"];
      const job = await failed(asA, attachment.id);
      expect(job).toMatchObject({ status: "failed", errorCode: "timeout" });
      expect(
        test.db.select().from(documentUploads).get()!.taskId,
      ).not.toBeNull();
      log.mockRestore();
    });

    it("a file Paperless already holds is linked as it is, without touching its permissions", async () => {
      const { asA, asset, attachment } = await world();
      fake.addDoc({ id: 7, title: "Existing manual", owner: null });
      fake.taskSteps = ["duplicate"];
      fake.duplicateOf = 7;
      const job = await failed(asA, attachment.id);
      expect(job).toMatchObject({
        status: "done",
        duplicate: true,
        externalId: 7,
        errorCode: null,
      });
      expect(fake.requestsTo("/api/documents/7/", "PATCH")).toEqual([]);
      expect(test.db.select().from(documentLinks).get()).toMatchObject({
        externalId: 7,
        ownerId: asset.id,
      });
    });

    it("a duplicate the account cannot read fails as duplicate and leaks nothing about it", async () => {
      const { asA, attachment } = await world();
      const log = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      fake.addDoc({ id: 7, title: "Somebody's private file", owner: 2 });
      fake.taskSteps = ["duplicate"];
      fake.duplicateOf = 7;
      const job = await failed(asA, attachment.id);
      expect(job).toMatchObject({
        status: "failed",
        errorCode: "duplicate",
        externalId: null,
        linkId: null,
      });
      expect(JSON.stringify(job)).not.toContain("private file");
      log.mockRestore();
    });

    it("pushing a file that is already linked there reuses the link", async () => {
      const { asA, attachment } = await world();
      const first = await failed(asA, attachment.id);
      expect(first.status).toBe("done");
      fake.taskSteps = ["duplicate"];
      fake.duplicateOf = 900;
      const again = await failed(asA, attachment.id);
      expect(again).toMatchObject({
        status: "done",
        duplicate: true,
        linkId: first.linkId,
      });
      expect(test.db.select().from(documentLinks).all()).toHaveLength(1);
    });

    it("a failed share keeps the document and the link and says so", async () => {
      const { asA, attachment } = await world();
      const log = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      fake.failNext("/api/documents/900/", 403, { method: "PATCH" });
      const job = await failed(asA, attachment.id);
      expect(job).toMatchObject({
        status: "done",
        externalId: 900,
        warning: "permissions_failed",
        errorCode: null,
      });
      expect(job.linkId).not.toBeNull();
      log.mockRestore();
    });

    it("never logs the token or anything from the document system", async () => {
      const { asA, attachment } = await world();
      const log = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      fake.uploadStatus = 500;
      await failed(asA, attachment.id);
      const logged = JSON.stringify(log.mock.calls);
      expect(logged).toContain("documents.upload_failed");
      expect(logged).not.toContain(fake.token);
      expect(logged).not.toContain("rejected");
      log.mockRestore();
    });
  });

  describe("who may push and see", () => {
    it("a repeated push of a file that is still being handled returns the same job", async () => {
      const { asA, attachment } = await world();
      uploadPolling.pollMs = 40;
      fake.taskSteps = ["pending", "pending", "pending", "success"];
      const first = await push(asA, attachment.id);
      const second = await push(asA, attachment.id);
      expect(body<{ id: string }>(second).id).toBe(
        body<{ id: string }>(first).id,
      );
      await settleBackgroundWork();
      expect(fake.uploads).toHaveLength(1);
      expect(test.db.select().from(documentUploads).all()).toHaveLength(1);
    });

    it("a job belongs to the person who started it", async () => {
      const { asA, asB, attachment } = await world();
      const jobId = body<{ id: string }>(await push(asA, attachment.id)).id;
      await settleBackgroundWork();
      const other = await asB("GET", `/api/v1/documents/uploads/${jobId}`);
      expect([other.res.status, errorCode(other)]).toEqual([404, "not_found"]);
      expect(
        (await asA("GET", `/api/v1/documents/uploads/${jobId}`)).res.status,
      ).toBe(200);
      expect(
        (await asA("GET", "/api/v1/documents/uploads/unknown")).res.status,
      ).toBe(404);
    });

    it("each person pushes into their own account, with their own token and as their own owner", async () => {
      const { asB, attachment } = await world();
      const jobId = body<{ id: string }>(await push(asB, attachment.id)).id;
      expect((await finish(asB, jobId)).status).toBe("done");
      expect(
        fake
          .requestsTo("/post_document/")
          .map((r) => r.headers.get("authorization")),
      ).toEqual(["Token token-b"]);
      expect(fake.docs.get(900)!.owner).toBe(2);
      expect(
        fake.requestsTo("/api/documents/900/", "PATCH")[0].json,
      ).toMatchObject({
        owner: 2,
      });
    });

    it("needs a connection of one's own, an existing attachment, and an owner a document can be linked to", async () => {
      const { asA, asset, attachment } = await world();
      const loner = await createTestUser();
      const asLoner = createCaller({ session: loginTestUser(loner).token });
      expect((await push(asLoner, attachment.id)).res.status).toBe(404);
      expect((await push(asA, "missing")).res.status).toBe(404);
      const hint = test.db
        .insert(assetHints)
        .values({ assetId: asset.id, title: "Tip" })
        .returning()
        .get();
      const onHint = await createAttachment(ctx(), {
        bytes: new Uint8Array(samplePdf()),
        filename: "hint.pdf",
        ownerType: "asset_hint",
        ownerId: hint.id,
        uploadedBy: null,
      });
      const r = await push(asA, onHint.id);
      expect([r.res.status, errorCode(r)]).toEqual([400, "invalid_request"]);
      expect(fake.uploads).toEqual([]);
    });

    it("a file of a documentation page needs the documentation scope", async () => {
      const { a } = await world();
      const page = test.db
        .insert(docPages)
        .values({ slug: "rules", title: "Rules", bodyMd: "x" })
        .returning()
        .get();
      const onPage = await createAttachment(ctx(), {
        bytes: new Uint8Array(samplePdf()),
        filename: "rules.pdf",
        ownerType: "page",
        ownerId: page.id,
        uploadedBy: a.id,
      });
      const writer = createCaller({
        bearer: createTestToken(a, { scopes: ["read", "write"], kind: "mcp" })
          .token,
      });
      const docs = createCaller({
        bearer: createTestToken(a, {
          scopes: ["read", "write", "docs:write"],
          kind: "mcp",
        }).token,
      });
      expect((await push(writer, onPage.id)).res.status).toBe(403);
      expect((await push(docs, onPage.id)).res.status).toBe(202);
      await settleBackgroundWork();
    });

    it.each([
      ["an empty title", { title: "" }],
      ["a title that is too long", { title: "x".repeat(129) }],
      ["an unknown role", { role: "photo" }],
      ["an unknown provider", { provider: "elsewhere" }],
      ["an unknown field", { tags: [1] }],
    ])("rejects %s", async (_name, json) => {
      const { asA, attachment } = await world();
      expect((await push(asA, attachment.id, json)).res.status).toBe(400);
      expect(fake.uploads).toEqual([]);
    });
  });

  describe("after a restart", () => {
    async function interrupted(status: "queued" | "uploading" | "processing") {
      const { a, asA, asset, attachment } = await world();
      const row = getConnectionRow(ctx(), "paperless", a.id)!;
      let taskId: string | null = null;
      if (status === "processing") {
        taskId = await paperlessDocumentProvider.startUpload(
          resolveConnection(row),
          {
            bytes: new Uint8Array(samplePdf()),
            filename: "Dishwasher manual.pdf",
            contentType: "application/pdf",
            title: "Dishwasher manual",
          },
        );
      }
      const job = test.db
        .insert(documentUploads)
        .values({
          provider: "paperless",
          connectionId: row.id,
          userId: a.id,
          attachmentId: attachment.id,
          ownerType: "asset",
          ownerId: asset.id,
          role: "manual",
          title: "Dishwasher manual",
          status,
          taskId,
        })
        .returning()
        .get();
      return { asA, job };
    }

    it("a job that was waiting for Paperless is picked up where it was", async () => {
      const { asA, job } = await interrupted("processing");
      resumeUploads();
      const done = await finish(asA, job.id);
      expect(done).toMatchObject({ status: "done", externalId: 900 });
      expect(fake.uploads).toHaveLength(1);
      expect(fake.requestsTo("/post_document/")).toHaveLength(1);
    });

    it.each(["queued", "uploading"] as const)(
      "a job that had not handed over its file is failed as interrupted (%s)",
      async (status) => {
        const { asA, job } = await interrupted(status);
        resumeUploads();
        expect(await finish(asA, job.id)).toMatchObject({
          status: "failed",
          errorCode: "interrupted",
        });
        expect(fake.uploads).toEqual([]);
      },
    );

    it("finished jobs stay as they are", async () => {
      const { asA, attachment } = await world();
      const jobId = body<{ id: string }>(await push(asA, attachment.id)).id;
      const done = await finish(asA, jobId);
      resumeUploads();
      await settleBackgroundWork();
      expect(await finish(asA, jobId)).toEqual(done);
      expect(fake.uploads).toHaveLength(1);
    });
  });

  it("finished jobs are forgotten after a month, running ones never", async () => {
    const { a, asset, attachment } = await world();
    const row = getConnectionRow(ctx(), "paperless", a.id)!;
    const job = (status: "done" | "failed" | "processing", ageDays: number) =>
      test.db
        .insert(documentUploads)
        .values({
          provider: "paperless",
          connectionId: row.id,
          userId: a.id,
          attachmentId: attachment.id,
          ownerType: "asset",
          ownerId: asset.id,
          role: "other",
          title: status,
          status,
          updatedAt: new Date(Date.now() - ageDays * 86_400_000),
        })
        .run();
    job("done", 40);
    job("failed", 31);
    job("processing", 40);
    job("done", 5);
    expect(pruneFinishedUploads(ctx())).toBe(2);
    expect(
      test.db
        .select()
        .from(documentUploads)
        .all()
        .map((j) => [j.status, j.title])
        .sort(),
    ).toEqual([
      ["done", "done"],
      ["processing", "processing"],
    ]);
  });

  it("syncing after a push keeps the pushed document in the person's list", async () => {
    const { asA, attachment } = await world();
    const jobId = body<{ id: string }>(await push(asA, attachment.id)).id;
    await finish(asA, jobId);
    await syncAll(ctx());
    const list = await asA("GET", "/api/v1/documents");
    expect(
      body<{ items: Array<{ externalId: number; linkedTo: unknown[] }> }>(
        list,
      ).items.map((d) => [d.externalId, d.linkedTo.length]),
    ).toEqual([[900, 1]]);
  });
});
