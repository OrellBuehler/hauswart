import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import { createTestUser, loginTestUser } from "$lib/testing/auth";
import { today } from "$lib/testing/dates";
import { useTestDB } from "$lib/testing/db";

type Note = {
  id: string;
  body: string;
  status: string;
  serviceLogId: string | null;
  resolvedBy: string | null;
};
type Entry = { id: string; resolvedNoteIds?: string[] };

describe("resolving notes through the API", () => {
  useTestDB();

  async function setup() {
    const user = await createTestUser({ displayName: "Anna" });
    const call = createCaller({ session: loginTestUser(user).token });
    const asset = (
      await call("POST", "/api/v1/assets", { json: { name: "Kombi" } })
    ).body as { id: string };
    const note = async (body: string, assetId = asset.id) =>
      (
        await call("POST", `/api/v1/assets/${assetId}/notes`, {
          json: { body },
        })
      ).body as Note;
    const notes = async (status = "all", assetId = asset.id) =>
      (
        (await call("GET", `/api/v1/assets/${assetId}/notes?status=${status}`))
          .body as { items: Note[] }
      ).items;
    const task = async (json: object = {}) =>
      (
        await call("POST", "/api/v1/tasks", {
          json: {
            title: "Service",
            assetId: asset.id,
            trigger: { v: 1, type: "one_off", date: today(3) },
            ...json,
          },
        })
      ).body as { id: string; openNoteCount: number };
    return { user, call, asset, note, notes, task };
  }

  describe("service log entries", () => {
    it("create: the notes named become resolved with the entry", async () => {
      const { user, call, asset, note, notes } = await setup();
      const [one, two] = [await note("Eins"), await note("Zwei")];
      const created = await call(
        "POST",
        `/api/v1/assets/${asset.id}/service-log`,
        { json: { title: "Bremsen", resolvedNoteIds: [one.id] } },
      );
      expect(created.res.status).toBe(201);
      const entry = created.body as Entry;
      expect(await notes("resolved")).toMatchObject([
        { id: one.id, serviceLogId: entry.id, resolvedBy: user.id },
      ]);
      expect((await notes("open")).map((n) => n.id)).toEqual([two.id]);
    });

    it("create and update: another asset's note or an unknown id is a 400", async () => {
      const { call, asset, note, notes } = await setup();
      const other = (
        await call("POST", "/api/v1/assets", { json: { name: "Anhänger" } })
      ).body as { id: string };
      const foreign = await note("Fremd", other.id);
      const path = `/api/v1/assets/${asset.id}/service-log`;
      for (const ids of [[foreign.id], ["nope"]]) {
        const r = await call("POST", path, {
          json: { title: "Bremsen", resolvedNoteIds: ids },
        });
        expect([r.res.status, errorCode(r)]).toEqual([400, "invalid_request"]);
        expect(JSON.stringify(r.body)).toContain("resolvedNoteIds");
      }
      expect(
        ((await call("GET", path)).body as { items: unknown[] }).items,
      ).toEqual([]);
      const entry = (await call("POST", path, { json: { title: "Service" } }))
        .body as Entry;
      const r = await call("PATCH", `${path}/${entry.id}`, {
        json: { resolvedNoteIds: [foreign.id] },
      });
      expect(errorCode(r)).toBe("invalid_request");
      for (const json of [
        { title: "x", resolvedNoteIds: "nope" },
        { title: "x", resolvedNoteIds: [1] },
        {
          title: "x",
          resolvedNoteIds: Array.from({ length: 51 }, (_, i) => `n${i}`),
        },
      ]) {
        expect(errorCode(await call("POST", path, { json }))).toBe(
          "invalid_request",
        );
      }
      expect((await notes("open", other.id)).map((n) => n.id)).toEqual([
        foreign.id,
      ]);
    });

    it("update: resolves more notes, also as the only change; deleting the entry reopens them", async () => {
      const { call, asset, note, notes } = await setup();
      const [one, two] = [await note("Eins"), await note("Zwei")];
      const path = `/api/v1/assets/${asset.id}/service-log`;
      const entry = (
        await call("POST", path, {
          json: { title: "Service", resolvedNoteIds: [one.id] },
        })
      ).body as Entry;
      const patched = await call("PATCH", `${path}/${entry.id}`, {
        json: { resolvedNoteIds: [two.id] },
      });
      expect(patched.res.status).toBe(200);
      expect((await notes("resolved")).map((n) => n.serviceLogId)).toEqual([
        entry.id,
        entry.id,
      ]);
      expect((await call("DELETE", `${path}/${entry.id}`)).res.status).toBe(
        204,
      );
      expect((await notes("open")).map((n) => n.status)).toEqual([
        "open",
        "open",
      ]);
    });
  });

  describe("completing a task", () => {
    it("with a service log entry: resolves the notes, and undoing the completion reopens them", async () => {
      const { user, call, note, notes, task } = await setup();
      const [one, two] = [await note("Eins"), await note("Zwei")];
      const t = await task();
      expect((await call("GET", `/api/v1/tasks/${t.id}`)).body).toMatchObject({
        openNoteCount: 2,
      });
      const done = await call("POST", `/api/v1/tasks/${t.id}/complete`, {
        json: { serviceLog: { resolvedNoteIds: [one.id] } },
      });
      expect(done.res.status).toBe(201);
      const body = done.body as {
        completion: { id: string };
        serviceLog: { id: string } | null;
        task: { openNoteCount: number };
      };
      expect(body.serviceLog).not.toBeNull();
      expect(body.task.openNoteCount).toBe(1);
      expect(await notes("resolved")).toMatchObject([
        { id: one.id, serviceLogId: body.serviceLog!.id, resolvedBy: user.id },
      ]);
      expect((await notes("open")).map((n) => n.id)).toEqual([two.id]);

      const undone = await call(
        "DELETE",
        `/api/v1/completions/${body.completion.id}`,
      );
      expect(undone.res.status).toBe(204);
      expect((await notes("open")).map((n) => n.id).sort()).toEqual(
        [one.id, two.id].sort(),
      );
      expect((await call("GET", `/api/v1/tasks/${t.id}`)).body).toMatchObject({
        openNoteCount: 2,
      });
    });

    it("a bad note is a 400 and the task is not completed", async () => {
      const { call, asset, task } = await setup();
      const t = await task();
      const r = await call("POST", `/api/v1/tasks/${t.id}/complete`, {
        json: { serviceLog: { resolvedNoteIds: ["nope"] } },
      });
      expect([r.res.status, errorCode(r)]).toEqual([400, "invalid_request"]);
      expect(
        (
          (await call("GET", "/api/v1/completions")).body as {
            items: unknown[];
          }
        ).items,
      ).toEqual([]);
      expect(
        (
          (await call("GET", `/api/v1/assets/${asset.id}/service-log`))
            .body as {
            items: unknown[];
          }
        ).items,
      ).toEqual([]);
    });

    it("the notes belong in the service log object: next to it they are refused", async () => {
      const { call, note, task } = await setup();
      const n = await note("Eins");
      const t = await task();
      const r = await call("POST", `/api/v1/tasks/${t.id}/complete`, {
        json: { resolvedNoteIds: [n.id] },
      });
      expect(errorCode(r)).toBe("invalid_request");
    });

    it("skipping does not touch notes", async () => {
      const { call, note, notes, task } = await setup();
      await note("Eins");
      const t = await task();
      await call("POST", `/api/v1/tasks/${t.id}/skip`, { json: {} });
      expect((await notes("open")).length).toBe(1);
    });
  });

  describe("the count on tasks and the dashboard", () => {
    it("is on the task, the task list and the dashboard", async () => {
      const { call, asset, note, task } = await setup();
      const t = await task({
        trigger: { v: 1, type: "one_off", date: today(0) },
      });
      const bare = await task({ title: "Ohne Gerät", assetId: null });
      await note("Eins");
      await note("Zwei");
      expect(t.openNoteCount).toBe(0);
      const list = (await call("GET", `/api/v1/tasks?assetId=${asset.id}`))
        .body as {
        items: { id: string; openNoteCount: number }[];
      };
      expect(list.items.map((x) => [x.id, x.openNoteCount])).toEqual([
        [t.id, 2],
      ]);
      expect(
        (await call("GET", `/api/v1/tasks/${bare.id}`)).body,
      ).toMatchObject({ openNoteCount: 0 });
      const dashboard = (await call("GET", "/api/v1/dashboard")).body as {
        upcoming: Record<string, { taskId: string; openNoteCount: number }[]>;
      };
      const entries = Object.values(dashboard.upcoming).flat();
      expect(entries.find((e) => e.taskId === t.id)?.openNoteCount).toBe(2);
      expect(entries.find((e) => e.taskId === bare.id)?.openNoteCount).toBe(0);
    });
  });
});
