import { describe, expect, it } from "vitest";
import {
  createCaller,
  createInProcessFetch,
  errorCode,
} from "#lib/testing/api.ts";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "#lib/testing/auth.ts";
import { useTestDB } from "#lib/testing/db.ts";
import { today } from "#lib/testing/dates.ts";
import { plainPng } from "#lib/server/files/test-images.ts";
import { samplePdf, useTestFilesDir } from "#lib/testing/files.ts";
import { createApiClient } from "#lib/api/client.ts";
import { endpoints } from "#lib/api/registry.ts";

type Json = Record<string, unknown>;
interface StepBody {
  id: string;
  position: number;
  title: string;
  body: string;
  images: {
    id: string;
    url: string;
    thumbUrl: string | null;
    ownerId: string;
  }[];
}
interface StepsBody {
  steps: StepBody[];
  stepsSource: Json | null;
  stepCount: number;
}

const interval = (startDate: string) => ({
  v: 1,
  type: "interval",
  every: 30,
  unit: "day",
  anchor: "completion",
  startDate,
});

describe("task steps API", () => {
  useTestDB();
  useTestFilesDir();

  async function member() {
    const user = await createTestUser();
    return { user, call: createCaller({ session: loginTestUser(user).token }) };
  }
  type Call = ReturnType<typeof createCaller>;

  async function newTask(call: Call, title = "Filter wechseln") {
    const r = await call("POST", "/api/v1/tasks", {
      json: { title, trigger: interval(today(5)) },
    });
    return (r.body as { id: string }).id;
  }
  const putSteps = (call: Call, id: string, json: Json) =>
    call("PUT", `/api/v1/tasks/${id}/steps`, { json });
  const form = (owner: Json, bytes: Uint8Array, name = "bild.png") => ({
    file: new File([bytes as BlobPart], name, { type: "image/png" }),
    ...owner,
  });

  it("replaces the steps and answers the steps, the source and the count", async () => {
    const { call } = await member();
    const id = await newTask(call);
    const r = await putSteps(call, id, {
      steps: [
        { title: "Ausschalten", body: "Stecker ziehen." },
        { title: "Abdeckung abnehmen" },
      ],
      source: { label: "Anleitung", url: "https://docs.example.org/filter" },
    });
    expect(r.res.status).toBe(200);
    const body = r.body as StepsBody;
    expect(body).toMatchObject({
      stepCount: 2,
      stepsSource: {
        label: "Anleitung",
        url: "https://docs.example.org/filter",
        attachmentId: null,
        page: null,
        attachment: null,
      },
    });
    expect(
      body.steps.map((s) => [s.position, s.title, s.body, s.images]),
    ).toEqual([
      [0, "Ausschalten", "Stecker ziehen.", []],
      [1, "Abdeckung abnehmen", "", []],
    ]);
    expect(r.res.headers.get("cache-control")).toBe("no-store");
  });

  it("the task detail carries the steps and the source, lists and answers carry only the count", async () => {
    const { call } = await member();
    const id = await newTask(call);
    const other = await newTask(call, "Ohne Schritte");
    await putSteps(call, id, {
      steps: [{ title: "A" }, { title: "B" }],
      source: { label: "Seite" },
    });

    const detail = (await call("GET", `/api/v1/tasks/${id}`)).body as Json;
    expect(detail).toMatchObject({
      stepCount: 2,
      steps: [{ title: "A" }, { title: "B" }],
      stepsSource: { label: "Seite" },
    });
    const bare = (await call("GET", `/api/v1/tasks/${other}`)).body as Json;
    expect(bare).toMatchObject({ stepCount: 0, steps: [], stepsSource: null });

    const list = (await call("GET", "/api/v1/tasks")).body as {
      items: (Json & { id: string })[];
    };
    const row = list.items.find((t) => t.id === id)!;
    expect(row.stepCount).toBe(2);
    expect(row).not.toHaveProperty("steps");
    expect(row).not.toHaveProperty("stepsSource");

    const done = (
      await call("POST", `/api/v1/tasks/${id}/complete`, { json: {} })
    ).body as { task: Json };
    expect(done.task.stepCount).toBe(2);
    const skipped = (
      await call("POST", `/api/v1/tasks/${id}/skip`, { json: {} })
    ).body as { task: Json };
    expect(skipped.task.stepCount).toBe(2);
    const snoozed = (
      await call("POST", `/api/v1/tasks/${id}/snooze`, {
        json: { until: today(3) },
      })
    ).body as Json;
    expect(snoozed.stepCount).toBe(2);

    const dashboard = (await call("GET", "/api/v1/dashboard")).body as {
      upcoming: Record<string, { taskId: string; stepCount: number }[]>;
    };
    const entries = Object.values(dashboard.upcoming).flat();
    expect(entries.find((e) => e.taskId === other)?.stepCount).toBe(0);
  });

  it("hasSteps=true|false filters the list", async () => {
    const { call } = await member();
    const withSteps = await newTask(call, "Mit");
    const without = await newTask(call, "Ohne");
    await putSteps(call, withSteps, { steps: [{ title: "A" }] });
    const ids = async (q: string) =>
      (
        (await call("GET", `/api/v1/tasks${q}`)).body as {
          items: { id: string }[];
        }
      ).items.map((t) => t.id);
    expect(await ids("?hasSteps=true")).toEqual([withSteps]);
    expect(await ids("?hasSteps=false")).toEqual([without]);
    expect(new Set(await ids(""))).toEqual(new Set([withSteps, without]));
    expect((await call("GET", "/api/v1/tasks?hasSteps=maybe")).res.status).toBe(
      400,
    );
  });

  it("keeps the steps whose id is sent, with their pictures, and deletes the others with theirs", async () => {
    const { call } = await member();
    const id = await newTask(call);
    const first = (await putSteps(call, id, {
      steps: [{ title: "A" }, { title: "B" }, { title: "C" }],
    }).then((r) => r.body)) as StepsBody;
    const [a, b, c] = first.steps;
    const onB = (
      await call("POST", "/api/v1/attachments", {
        form: form(
          { ownerType: "task_step", ownerId: b!.id },
          plainPng(30, 20),
        ),
      })
    ).body as { id: string; url: string };
    const onC = (
      await call("POST", "/api/v1/attachments", {
        form: form(
          { ownerType: "task_step", ownerId: c!.id },
          plainPng(31, 20),
        ),
      })
    ).body as { id: string; url: string };

    const r = await putSteps(call, id, {
      steps: [
        { id: b!.id, title: "B neu" },
        { title: "D" },
        { id: a!.id, title: "A" },
      ],
    });
    const body = r.body as StepsBody;
    expect(body.steps.map((s) => [s.id === b!.id, s.title])).toEqual([
      [true, "B neu"],
      [false, "D"],
      [false, "A"],
    ]);
    expect(body.steps[0]!.images.map((i) => i.id)).toEqual([onB.id]);
    expect(body.steps[0]!.images[0]).toMatchObject({
      ownerId: b!.id,
      url: `/api/v1/attachments/${onB.id}/content`,
      thumbUrl: `/api/v1/attachments/${onB.id}/thumb`,
    });
    expect(body.steps[2]!.id).toBe(a!.id);
    expect((await call("GET", onB.url)).res.status).toBe(200);
    expect(
      (await call("GET", `/api/v1/attachments/${onC.id}`)).res.status,
    ).toBe(404);
  });

  it("answers 400 on steps for an id that is no step of the task, and 400 on source for a file that is not there", async () => {
    const { call } = await member();
    const id = await newTask(call);
    const other = await newTask(call, "Anderes");
    const [theirs] = (
      (await putSteps(call, other, { steps: [{ title: "Fremd" }] }))
        .body as StepsBody
    ).steps;
    await putSteps(call, id, { steps: [{ title: "Meins" }] });

    const foreign = await putSteps(call, id, {
      steps: [{ id: theirs!.id, title: "Gestohlen" }],
    });
    expect(foreign.res.status).toBe(400);
    expect(errorCode(foreign)).toBe("invalid_request");
    expect(
      (foreign.body as { error: { details: { body: { fieldErrors: Json } } } })
        .error.details.body.fieldErrors,
    ).toHaveProperty("steps");

    const twice = await putSteps(call, id, {
      steps: [
        { id: theirs!.id, title: "A" },
        { id: theirs!.id, title: "B" },
      ],
    });
    expect(twice.res.status).toBe(400);

    const missing = await putSteps(call, id, {
      steps: [],
      source: { attachmentId: "missing" },
    });
    expect(missing.res.status).toBe(400);
    expect(
      (missing.body as { error: { details: { body: { fieldErrors: Json } } } })
        .error.details.body.fieldErrors,
    ).toHaveProperty("source");

    const kept = (await call("GET", `/api/v1/tasks/${id}`)).body as Json;
    expect(kept.steps).toMatchObject([{ title: "Meins" }]);
    expect(
      ((await call("GET", `/api/v1/tasks/${other}`)).body as Json).steps,
    ).toMatchObject([{ id: theirs!.id, title: "Fremd" }]);
  });

  it.each([
    ["a blank title", { steps: [{ title: " " }] }],
    ["a title with a line break", { steps: [{ title: "a\nb" }] }],
    ["31 steps", { steps: Array.from({ length: 31 }, () => ({ title: "x" })) }],
    ["no steps field", { source: null }],
    ["an empty source", { steps: [], source: {} }],
    ["a page without a file", { steps: [], source: { page: 2 } }],
    [
      "both a url and a file",
      {
        steps: [],
        source: { url: "https://a.example.org", attachmentId: "x" },
      },
    ],
    ["a javascript url", { steps: [], source: { url: "javascript:alert(1)" } }],
    ["a position", { steps: [{ title: "x", position: 2 }] }],
  ])("refuses %s with a 400 and changes nothing", async (_name, json) => {
    const { call } = await member();
    const id = await newTask(call);
    await putSteps(call, id, { steps: [{ title: "Bleibt" }] });
    const r = await putSteps(call, id, json);
    expect([r.res.status, errorCode(r)]).toEqual([400, "invalid_request"]);
    expect(
      ((await call("GET", `/api/v1/tasks/${id}`)).body as Json).steps,
    ).toMatchObject([{ title: "Bleibt" }]);
  });

  it("is a 404 for a missing task", async () => {
    const { call } = await member();
    const r = await putSteps(call, "missing", { steps: [] });
    expect([r.res.status, errorCode(r)]).toEqual([404, "not_found"]);
  });

  it("the source can point at a file of hauswart and resolves it; deleting the file leaves the rest", async () => {
    const { call } = await member();
    const id = await newTask(call);
    const asset = (
      await call("POST", "/api/v1/assets", { json: { name: "Kessel" } })
    ).body as { id: string };
    const manual = (
      await call("POST", "/api/v1/attachments", {
        form: {
          file: new File([samplePdf() as BlobPart], "anleitung.pdf", {
            type: "application/pdf",
          }),
          ownerType: "asset",
          ownerId: asset.id,
        },
      })
    ).body as { id: string };
    const r = await putSteps(call, id, {
      steps: [],
      source: { label: "Handbuch", attachmentId: manual.id, page: 14 },
    });
    expect((r.body as StepsBody).stepsSource).toEqual({
      label: "Handbuch",
      url: null,
      attachmentId: manual.id,
      page: 14,
      attachment: {
        id: manual.id,
        filename: "anleitung.pdf",
        mime: "application/pdf",
        url: `/api/v1/attachments/${manual.id}/content`,
      },
    });

    expect(
      (await call("DELETE", `/api/v1/attachments/${manual.id}`)).res.status,
    ).toBe(204);
    expect(
      ((await call("GET", `/api/v1/tasks/${id}`)).body as Json).stepsSource,
    ).toEqual({
      label: "Handbuch",
      url: null,
      attachmentId: null,
      page: null,
      attachment: null,
    });
  });

  it("does not change the task's updatedAt", async () => {
    const { call } = await member();
    const id = await newTask(call);
    const before = (await call("GET", `/api/v1/tasks/${id}`)).body as Json;
    await new Promise((resolve) => setTimeout(resolve, 15));
    await putSteps(call, id, {
      steps: [{ title: "A" }],
      source: { label: "Seite" },
    });
    const after = (await call("GET", `/api/v1/tasks/${id}`)).body as Json;
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.state).toEqual(before.state);
  });

  it("deleting the task removes its steps and their pictures", async () => {
    const { call } = await member();
    const id = await newTask(call);
    const [step] = (
      (await putSteps(call, id, { steps: [{ title: "A" }] })).body as StepsBody
    ).steps;
    const picture = (
      await call("POST", "/api/v1/attachments", {
        form: form({ ownerType: "task_step", ownerId: step!.id }, plainPng()),
      })
    ).body as { id: string };
    expect((await call("DELETE", `/api/v1/tasks/${id}`)).res.status).toBe(204);
    expect(
      (await call("GET", `/api/v1/attachments/${picture.id}`)).res.status,
    ).toBe(404);
    expect((await call("GET", `/api/v1/tasks/${id}`)).res.status).toBe(404);
    expect((await putSteps(call, id, { steps: [] })).res.status).toBe(404);
  });

  describe("pictures of a step", () => {
    it("are attachments of the owner type task_step: they need write, not docs:write, and a step that exists", async () => {
      const { user, call } = await member();
      const id = await newTask(call);
      const [step] = (
        (await putSteps(call, id, { steps: [{ title: "A" }] }))
          .body as StepsBody
      ).steps;
      const write = createCaller({
        bearer: createTestToken(user, { scopes: ["read", "write"] }).token,
      });
      const ok = await write("POST", "/api/v1/attachments", {
        form: form({ ownerType: "task_step", ownerId: step!.id }, plainPng()),
      });
      expect(ok.res.status).toBe(201);
      expect(ok.body).toMatchObject({
        ownerType: "task_step",
        ownerId: step!.id,
      });

      const unknown = await write("POST", "/api/v1/attachments", {
        form: form({ ownerType: "task_step", ownerId: "missing" }, plainPng()),
      });
      expect([unknown.res.status, errorCode(unknown)]).toEqual([
        400,
        "invalid_request",
      ]);

      const listed = (
        await write(
          "GET",
          `/api/v1/attachments?ownerType=task_step&ownerId=${step!.id}`,
        )
      ).body as { items: unknown[] };
      expect(listed.items).toHaveLength(1);
    });

    it("cannot be shown to a guest or sent to the document system", async () => {
      const { call } = await member();
      const id = await newTask(call);
      const [step] = (
        (await putSteps(call, id, { steps: [{ title: "A" }] }))
          .body as StepsBody
      ).steps;
      const picture = (
        await call("POST", "/api/v1/attachments", {
          form: {
            ...form({ ownerType: "task_step", ownerId: step!.id }, plainPng()),
            guestVisible: "true",
          },
        })
      ).body as { id: string };
      const push = await call(
        "POST",
        `/api/v1/attachments/${picture.id}/push-to-documents`,
        { json: {} },
      );
      expect(push.res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("who may", () => {
    it("write needs the write scope, reading the steps the read scope", async () => {
      const { user, call } = await member();
      const id = await newTask(call);
      const read = createCaller({
        bearer: createTestToken(user, { scopes: ["read"] }).token,
      });
      const write = createCaller({
        bearer: createTestToken(user, { scopes: ["read", "write"] }).token,
      });
      const denied = await putSteps(read, id, { steps: [{ title: "A" }] });
      expect([denied.res.status, errorCode(denied)]).toEqual([
        403,
        "forbidden",
      ]);
      expect(
        (await putSteps(write, id, { steps: [{ title: "A" }] })).res.status,
      ).toBe(200);
      expect((await read("GET", `/api/v1/tasks/${id}`)).res.status).toBe(200);
    });

    it("every member sees and edits the steps: the household shares them", async () => {
      const anna = await member();
      const ben = await member();
      const id = await newTask(anna.call);
      await putSteps(anna.call, id, { steps: [{ title: "Von Anna" }] });
      const seen = (await ben.call("GET", `/api/v1/tasks/${id}`)).body as Json;
      expect(seen.steps).toMatchObject([{ title: "Von Anna" }]);
      const r = await putSteps(ben.call, id, { steps: [{ title: "Von Ben" }] });
      expect((r.body as StepsBody).steps[0]!.title).toBe("Von Ben");
    });

    it("works through the typed client", async () => {
      const { user } = await member();
      const { token } = createTestToken(user, { scopes: ["read", "write"] });
      const api = createApiClient(
        createInProcessFetch({ bearer: token }),
        "http://localhost",
      );
      const task = await api.call(endpoints.tasksCreate, {
        body: {
          title: "Typed",
          trigger: {
            v: 1,
            type: "interval",
            every: 7,
            unit: "day",
            anchor: "completion",
            startDate: today(2),
          },
        },
      });
      const out = await api.call(endpoints.tasksStepsPut, {
        params: { id: task.id },
        body: {
          steps: [{ title: "Eins", body: "" }],
          source: { label: "Quelle" },
        },
      });
      expect(out.stepCount).toBe(1);
      expect(
        (await api.call(endpoints.tasksGet, { params: { id: task.id } })).steps,
      ).toHaveLength(1);
    });
  });
});
