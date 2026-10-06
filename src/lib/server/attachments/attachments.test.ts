import { createHash } from "node:crypto";
import { readdir, utimes, writeFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "$lib/api/errors";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import {
  createAsset,
  deleteAsset,
  updateAsset,
} from "$lib/server/assets/assets";
import { assets, attachments } from "$lib/server/db";
import { FileError } from "$lib/server/files/errors";
import { plainJpeg, plainPng, plainWebp } from "$lib/server/files/test-images";
import { createRoom, deleteRoom } from "$lib/server/rooms/rooms";
import { deleteTask } from "$lib/server/tasks/tasks";
import { createTestUser } from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { ctxAt, makeTask } from "$lib/testing/domain";
import {
  sampleHeic,
  sampleHtml,
  samplePdf,
  sampleSvg,
  useTestFilesDir,
} from "$lib/testing/files";
import {
  assertAssetPhoto,
  attachmentsById,
  createAttachment,
  deleteAttachment,
  getAttachment,
  listAttachments,
  onAttachmentsChanged,
  openAttachmentFile,
  removeOwnedAttachments,
  settleBackgroundWork,
  sweepOrphanFiles,
  updateAttachment,
  type NewAttachment,
} from "./attachments";
import {
  isOwnerTypeSupported,
  ownerExists,
  registerAttachmentOwner,
} from "./owners";

const HOUR = 60 * 60 * 1000;
const present = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

describe("attachments", () => {
  const test = useTestDB();
  const files = useTestFilesDir();
  /** Far enough ahead that files written a moment ago count as old enough to sweep. */
  const later = () => ctxAt(test.db, Date.now() + HOUR);
  const ctx = () => ctxAt(test.db, Date.now());
  const asset = (name = "Pflanze") =>
    createAsset(ctx(), createAssetRequestSchema.parse({ name }));

  async function upload(
    owner: { ownerType: NewAttachment["ownerType"]; ownerId: string },
    bytes: Uint8Array = plainPng(),
    extra: Partial<NewAttachment> = {},
  ) {
    const user = await createTestUser();
    return createAttachment(ctx(), {
      bytes,
      filename: "datei.png",
      uploadedBy: user.id,
      ...owner,
      ...extra,
    });
  }
  const codeOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (err) {
      if (err instanceof FileError) return err.code;
      if (err instanceof ApiError) return err.code;
      throw err;
    }
    return null;
  };
  const fieldOf = (err: unknown) =>
    Object.keys(
      ((err as ApiError).details as { body: { fieldErrors: object } }).body
        .fieldErrors,
    );

  describe("upload", () => {
    it("stores png, jpeg, webp and pdf with their metadata", async () => {
      const a = asset();
      const owner = { ownerType: "asset", ownerId: a.id } as const;
      const png = await upload(owner, plainPng(64, 32), {
        filename: "Bild.PNG",
        caption: "Vorne",
      });
      expect(png).toMatchObject({
        mime: "image/png",
        width: 64,
        height: 32,
        filename: "Bild.PNG",
        caption: "Vorne",
        guestVisible: false,
        ownerType: "asset",
        ownerId: a.id,
      });
      expect(png.path).toBe(`${png.sha256.slice(0, 2)}/${png.sha256}`);
      expect(png.thumbPath).toBe(`${png.path}.thumb.webp`);
      const onDisk = await Bun.file(join(files.dir, png.path)).bytes();
      expect(createHash("sha256").update(onDisk).digest("hex")).toBe(
        png.sha256,
      );
      expect(onDisk.byteLength).toBe(png.size);

      const jpeg = await upload(owner, plainJpeg(), { filename: "foto.jpeg" });
      expect(jpeg).toMatchObject({ mime: "image/jpeg", filename: "foto.jpeg" });
      const webp = await upload(owner, plainWebp(), { filename: "foto.webp" });
      expect(webp.mime).toBe("image/webp");
      const pdf = await upload(owner, samplePdf(), {
        filename: "Anleitung.pdf",
      });
      expect(pdf).toMatchObject({
        mime: "application/pdf",
        thumbPath: null,
        width: null,
        height: null,
        filename: "Anleitung.pdf",
      });
    });

    it("renames to the detected type and sanitizes the name", async () => {
      const a = asset();
      const row = await upload(
        { ownerType: "asset", ownerId: a.id },
        plainPng(),
        {
          filename: "../../etc/passwd.html",
        },
      );
      expect(row.filename).toBe("passwd.png");
      expect(row.filename).not.toContain("/");
    });

    it("rejects svg, html, heic, gif and empty uploads without leaving a row or a file", async () => {
      const a = asset();
      const owner = { ownerType: "asset", ownerId: a.id } as const;
      expect(
        await codeOf(upload(owner, sampleSvg(), { filename: "x.png" })),
      ).toBe("unsupported_type");
      expect(
        await codeOf(upload(owner, sampleHtml(), { filename: "x.pdf" })),
      ).toBe("unsupported_type");
      expect(
        await codeOf(upload(owner, sampleHeic(), { filename: "x.heic" })),
      ).toBe("unsupported_heic");
      expect(
        await codeOf(
          upload(owner, Buffer.from("GIF89a\x01\x00\x01\x00"), {
            filename: "x.gif",
          }),
        ),
      ).toBe("unsupported_type");
      expect(await codeOf(upload(owner, new Uint8Array(), {}))).toBe("empty");
      expect(
        await codeOf(
          upload(owner, Buffer.concat([plainPng().subarray(0, 40)]), {}),
        ),
      ).toBe("corrupt_image");
      expect(test.db.select().from(attachments).all()).toHaveLength(0);
      expect(await readdir(files.dir)).toEqual([]);
    });

    it("refuses files above 25 MiB", async () => {
      const a = asset();
      const big = Buffer.concat([
        Buffer.from("%PDF-1.4\n"),
        Buffer.alloc(25 * 1024 * 1024),
      ]);
      expect(
        await codeOf(upload({ ownerType: "asset", ownerId: a.id }, big)),
      ).toBe("too_large");
      expect(test.db.select().from(attachments).all()).toHaveLength(0);
    });

    it("stores identical content once but gives every upload its own row", async () => {
      const a = asset();
      const b = asset("Zweite");
      const one = await upload({ ownerType: "asset", ownerId: a.id });
      const two = await upload({ ownerType: "asset", ownerId: b.id });
      expect(one.id).not.toBe(two.id);
      expect(one.sha256).toBe(two.sha256);
      const shard = await readdir(join(files.dir, one.sha256.slice(0, 2)));
      expect(shard.sort()).toEqual(
        [one.sha256, `${one.sha256}.thumb.webp`].sort(),
      );
    });

    it("stores caption and guest visibility, turning an empty caption into null", async () => {
      const a = asset();
      const row = await upload(
        { ownerType: "asset", ownerId: a.id },
        plainPng(),
        {
          caption: "",
          guestVisible: true,
        },
      );
      expect(row).toMatchObject({ caption: null, guestVisible: true });
    });
  });

  describe("owners", () => {
    it("accepts asset, room, page and task owners and refuses ones that do not exist", async () => {
      const room = createRoom(ctx(), { name: "Bad" });
      const task = await makeTask(ctx());
      const a = asset();
      for (const owner of [
        { ownerType: "asset", ownerId: a.id },
        { ownerType: "room", ownerId: room.id },
        { ownerType: "task", ownerId: task.id },
      ] as const) {
        expect((await upload(owner)).ownerType).toBe(owner.ownerType);
      }
      for (const ownerType of ["asset", "room", "page", "task"] as const) {
        const err = await upload({ ownerType, ownerId: "missing" }).catch(
          (e) => e,
        );
        expect(err).toBeInstanceOf(ApiError);
        expect(fieldOf(err)).toEqual(["ownerId"]);
      }
    });

    it("refuses an owner type nobody registered, then accepts it once registered", async () => {
      expect(isOwnerTypeSupported("defect")).toBe(false);
      const err = await upload({ ownerType: "defect", ownerId: "d1" }).catch(
        (e) => e,
      );
      expect(fieldOf(err)).toEqual(["ownerType"]);

      const unregister = registerAttachmentOwner(
        "defect",
        (_ctx, id) => id === "d1",
      );
      try {
        expect(ownerExists(ctx(), "defect", "d1")).toBe(true);
        expect(ownerExists(ctx(), "defect", "d2")).toBe(false);
        expect(
          (await upload({ ownerType: "defect", ownerId: "d1" })).ownerType,
        ).toBe("defect");
        expect(
          fieldOf(
            await upload({ ownerType: "defect", ownerId: "d2" }).catch(
              (e) => e,
            ),
          ),
        ).toEqual(["ownerId"]);
      } finally {
        unregister();
      }
      expect(isOwnerTypeSupported("defect")).toBe(false);
    });

    it("keeps the built-in checks when a registration is undone", () => {
      const unregister = registerAttachmentOwner("asset", () => true);
      expect(ownerExists(ctx(), "asset", "anything")).toBe(true);
      unregister();
      expect(ownerExists(ctx(), "asset", "anything")).toBe(false);
    });
  });

  describe("read and update", () => {
    it("lists by owner, oldest first, with a cursor", async () => {
      const a = asset();
      const b = asset("Andere");
      const first = await upload({ ownerType: "asset", ownerId: a.id });
      await new Promise((r) => setTimeout(r, 5));
      const second = await upload(
        { ownerType: "asset", ownerId: a.id },
        plainJpeg(),
      );
      await upload({ ownerType: "asset", ownerId: b.id });
      const page = listAttachments(
        ctx(),
        { ownerType: "asset", ownerId: a.id },
        { limit: 1 },
      );
      expect(page.items.map((r) => r.id)).toEqual([first.id]);
      const next = listAttachments(
        ctx(),
        { ownerType: "asset", ownerId: a.id },
        { limit: 1, cursor: page.nextCursor! },
      );
      expect(next.items.map((r) => r.id)).toEqual([second.id]);
      expect(next.nextCursor).toBeNull();
      expect(
        listAttachments(
          ctx(),
          { ownerType: "room", ownerId: a.id },
          { limit: 5 },
        ).items,
      ).toEqual([]);
    });

    it("updates caption and guest visibility and tells listeners only about visibility changes", async () => {
      const a = asset();
      const row = await upload({ ownerType: "asset", ownerId: a.id });
      const seen: string[][] = [];
      const stop = onAttachmentsChanged((ids) => seen.push(ids));
      try {
        expect(
          updateAttachment(ctx(), row.id, { caption: "Neu" }),
        ).toMatchObject({ caption: "Neu", guestVisible: false });
        expect(seen).toEqual([]);
        expect(
          updateAttachment(ctx(), row.id, { guestVisible: true }).guestVisible,
        ).toBe(true);
        expect(seen).toEqual([[row.id]]);
        expect(
          updateAttachment(ctx(), row.id, { guestVisible: true }).guestVisible,
        ).toBe(true);
        expect(seen).toHaveLength(1);
        expect(
          updateAttachment(ctx(), row.id, { caption: null }).caption,
        ).toBeNull();
      } finally {
        stop();
      }
      expect(() =>
        updateAttachment(ctx(), "missing", { caption: "x" }),
      ).toThrow(ApiError);
    });

    it("looks up several attachments at once", async () => {
      const a = asset();
      const row = await upload({ ownerType: "asset", ownerId: a.id });
      expect([...attachmentsById(ctx(), [row.id, "nope"]).keys()]).toEqual([
        row.id,
      ]);
      expect(attachmentsById(ctx(), []).size).toBe(0);
    });

    it("opens the stored file and the thumbnail, and nothing for a pdf thumbnail", async () => {
      const a = asset();
      const image = await upload({ ownerType: "asset", ownerId: a.id });
      const pdf = await upload(
        { ownerType: "asset", ownerId: a.id },
        samplePdf(),
      );
      expect((await openAttachmentFile(image, "content"))!.size).toBe(
        image.size,
      );
      expect(await openAttachmentFile(image, "thumb")).not.toBeNull();
      expect(await openAttachmentFile(pdf, "thumb")).toBeNull();
    });

    it("never opens a path outside the store, whatever a row says", async () => {
      const a = asset();
      const row = await upload({ ownerType: "asset", ownerId: a.id });
      for (const path of [
        "../../etc/passwd",
        "/etc/passwd",
        "ab/../../x",
        `${row.path}/../x`,
      ]) {
        await expect(
          openAttachmentFile({ ...row, path }, "content"),
        ).rejects.toBeInstanceOf(FileError);
      }
    });
  });

  describe("delete", () => {
    it("removes the row and the file when nothing else uses it", async () => {
      const a = asset();
      const row = await upload({ ownerType: "asset", ownerId: a.id });
      await deleteAttachment(later(), row.id);
      expect(() => getAttachment(ctx(), row.id)).toThrow(ApiError);
      expect(await present(join(files.dir, row.path))).toBe(false);
      expect(await present(join(files.dir, `${row.path}.thumb.webp`))).toBe(
        false,
      );
    });

    it("keeps the file while another row uses it", async () => {
      const a = asset();
      const one = await upload({ ownerType: "asset", ownerId: a.id });
      const two = await upload({ ownerType: "asset", ownerId: a.id });
      await deleteAttachment(later(), one.id);
      expect(await present(join(files.dir, two.path))).toBe(true);
      await deleteAttachment(later(), two.id);
      expect(await present(join(files.dir, two.path))).toBe(false);
    });

    it("keeps a file younger than a minute (a concurrent re-upload may be about to use it)", async () => {
      const a = asset();
      const row = await upload({ ownerType: "asset", ownerId: a.id });
      await deleteAttachment(ctx(), row.id);
      expect(await present(join(files.dir, row.path))).toBe(true);
      const swept = await sweepOrphanFiles(later());
      expect(swept.files).toBe(1);
      expect(await present(join(files.dir, row.path))).toBe(false);
    });

    it("clears the asset photo that pointed at it", async () => {
      const a = asset();
      const row = await upload({ ownerType: "asset", ownerId: a.id });
      updateAsset(ctx(), a.id, { photoAttachmentId: row.id });
      await deleteAttachment(later(), row.id);
      expect(
        test.db.select().from(assets).where(eq(assets.id, a.id)).get()!
          .photoAttachmentId,
      ).toBeNull();
    });

    it("tells listeners which attachment went", async () => {
      const a = asset();
      const row = await upload({ ownerType: "asset", ownerId: a.id });
      const listener = vi.fn();
      const stop = onAttachmentsChanged(listener);
      try {
        await deleteAttachment(ctx(), row.id);
      } finally {
        stop();
      }
      expect(listener).toHaveBeenCalledWith([row.id]);
    });

    it("an unknown id is a 404", async () => {
      await expect(deleteAttachment(ctx(), "missing")).rejects.toMatchObject({
        code: "not_found",
      });
    });
  });

  describe("when an owner is deleted", () => {
    async function sweepNow() {
      await settleBackgroundWork();
    }

    it("deleting an asset, room or task removes its attachments", async () => {
      const a = asset();
      const room = createRoom(ctx(), { name: "Bad" });
      const task = await makeTask(ctx());
      const unrelated = asset("Bleibt");
      const mine = [
        await upload({ ownerType: "asset", ownerId: a.id }),
        await upload({ ownerType: "room", ownerId: room.id }, plainJpeg()),
        await upload({ ownerType: "task", ownerId: task.id }, plainWebp()),
      ];
      const kept = await upload(
        { ownerType: "asset", ownerId: unrelated.id },
        samplePdf(),
      );
      deleteAsset(ctx(), a.id);
      deleteRoom(ctx(), room.id);
      deleteTask(ctx(), task.id);
      await sweepNow();
      for (const row of mine) {
        expect(
          test.db
            .select()
            .from(attachments)
            .where(eq(attachments.id, row.id))
            .all(),
        ).toHaveLength(0);
      }
      expect(getAttachment(ctx(), kept.id).id).toBe(kept.id);
    });

    it("removes the stored files once they are old enough, keeps shared ones", async () => {
      const a = asset();
      const b = asset("Zweite");
      const mine = await upload(
        { ownerType: "asset", ownerId: a.id },
        plainPng(),
      );
      const shared = await upload(
        { ownerType: "asset", ownerId: a.id },
        plainJpeg(),
      );
      await upload({ ownerType: "asset", ownerId: b.id }, plainJpeg());
      for (const row of [mine, shared]) {
        const old = new Date(Date.now() - HOUR);
        await utimes(join(files.dir, row.path), old, old);
      }
      removeOwnedAttachments(ctx(), "asset", a.id);
      await settleBackgroundWork();
      expect(await present(join(files.dir, mine.path))).toBe(false);
      expect(await present(join(files.dir, shared.path))).toBe(true);
    });

    it("does nothing for an owner without attachments", () => {
      expect(() =>
        removeOwnedAttachments(ctx(), "asset", "none"),
      ).not.toThrow();
    });
  });

  describe("asset photo", () => {
    it("must be an image attachment of the asset itself", async () => {
      const a = asset();
      const other = asset("Andere");
      const mine = await upload({ ownerType: "asset", ownerId: a.id });
      const theirs = await upload({ ownerType: "asset", ownerId: other.id });
      const pdf = await upload(
        { ownerType: "asset", ownerId: a.id },
        samplePdf(),
      );
      const room = createRoom(ctx(), { name: "Bad" });
      const onRoom = await upload({ ownerType: "room", ownerId: room.id });

      expect(
        updateAsset(ctx(), a.id, { photoAttachmentId: mine.id })
          .photoAttachmentId,
      ).toBe(mine.id);
      for (const bad of [theirs.id, pdf.id, onRoom.id, "missing"]) {
        const err = (() => {
          try {
            updateAsset(ctx(), a.id, { photoAttachmentId: bad });
          } catch (e) {
            return e as ApiError;
          }
        })();
        expect(err, bad).toBeInstanceOf(ApiError);
        expect(fieldOf(err)).toEqual(["photoAttachmentId"]);
      }
      expect(() => assertAssetPhoto(ctx(), a.id, mine.id)).not.toThrow();
      expect(
        updateAsset(ctx(), a.id, { photoAttachmentId: null }).photoAttachmentId,
      ).toBeNull();
    });

    it("cannot be set while creating the asset", () => {
      expect(() =>
        createAsset(
          ctx(),
          createAssetRequestSchema.parse({
            name: "X",
            photoAttachmentId: "some-id",
          }),
        ),
      ).toThrow(ApiError);
    });
  });

  describe("orphan sweep", () => {
    it("deletes unreferenced stored files, keeps referenced ones, drops stale temp files", async () => {
      const a = asset();
      const kept = await upload(
        { ownerType: "asset", ownerId: a.id },
        plainPng(),
      );
      const orphan = await upload(
        { ownerType: "asset", ownerId: a.id },
        plainJpeg(),
      );
      test.db.delete(attachments).where(eq(attachments.id, orphan.id)).run();
      const shard = join(files.dir, "ab");
      await mkdir(shard, { recursive: true });
      const tmp = join(shard, `${"a".repeat(64)}.1234.tmp`);
      await writeFile(tmp, "partial");
      const old = new Date(Date.now() - 2 * 24 * HOUR);
      await utimes(tmp, old, old);
      const fresh = join(shard, `${"b".repeat(64)}.5678.tmp`);
      await writeFile(fresh, "partial");
      await writeFile(join(shard, "notes.txt"), "ignored");

      const result = await sweepOrphanFiles({
        db: test.db,
        now: Date.now() + HOUR,
      });
      expect(result).toEqual({ files: 1, temps: 1 });
      expect(await present(join(files.dir, orphan.path))).toBe(false);
      expect(await present(join(files.dir, `${orphan.path}.thumb.webp`))).toBe(
        false,
      );
      expect(await present(join(files.dir, kept.path))).toBe(true);
      expect(await present(tmp)).toBe(false);
      expect(await present(fresh)).toBe(true);
      expect(await present(join(shard, "notes.txt"))).toBe(true);
    });

    it("leaves recent files alone and copes with a missing directory", async () => {
      const a = asset();
      const row = await upload({ ownerType: "asset", ownerId: a.id });
      test.db.delete(attachments).where(eq(attachments.id, row.id)).run();
      expect((await sweepOrphanFiles(ctx())).files).toBe(0);
      expect(await present(join(files.dir, row.path))).toBe(true);
      expect(await sweepOrphanFiles(ctx(), join(files.dir, "missing"))).toEqual(
        { files: 0, temps: 0 },
      );
    });
  });
});
