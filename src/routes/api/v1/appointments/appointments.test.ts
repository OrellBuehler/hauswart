import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { today } from "$lib/testing/dates";
import { useTestDB } from "$lib/testing/db";
import { samplePdf, useTestFilesDir } from "$lib/testing/files";
import { addDays } from "$lib/dates";

type Appointment = {
  id: string;
  title: string;
  notes: string | null;
  location: string | null;
  allDay: boolean;
  startsAt: string | null;
  endsAt: string | null;
  startDate: string | null;
  endDate: string | null;
  taskId: string | null;
  taskTitle: string | null;
  occurrenceKey: string | null;
  assetId: string | null;
  assetName: string | null;
  contactId: string | null;
  contactName: string | null;
  status: string;
  commentCount: number;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};
type List = { items: Appointment[]; nextCursor: string | null };
type Task = {
  id: string;
  nextAppointment: {
    id: string;
    allDay: boolean;
    startsAt: string | null;
    startDate: string | null;
  } | null;
  state: { occurrenceKey: string; status: string } | null;
};
type Completed = {
  appointment: Appointment;
  completion: { id: string; source: string; taskId: string } | null;
  task: Task | null;
  replayed: boolean;
};

const START = "2030-03-12T08:00:00.000Z";
const END = "2030-03-12T09:30:00.000Z";

describe("appointments API", () => {
  useTestDB();
  useTestFilesDir();

  async function setup() {
    const user = await createTestUser({ displayName: "Anna" });
    const call = createCaller({ session: loginTestUser(user).token });
    const timed = async (json: object = {}) =>
      (
        await call("POST", "/api/v1/appointments", {
          json: { title: "Kaminfeger", startsAt: START, endsAt: END, ...json },
        })
      ).body as Appointment;
    const allDay = async (json: object = {}) =>
      (
        await call("POST", "/api/v1/appointments", {
          json: {
            title: "Handwerker",
            allDay: true,
            startDate: "2030-03-14",
            ...json,
          },
        })
      ).body as Appointment;
    const task = async (json: object = {}) =>
      (
        await call("POST", "/api/v1/tasks", {
          json: {
            title: "Heizung warten",
            trigger: {
              v: 1,
              type: "interval",
              every: 30,
              unit: "day",
              anchor: "completion",
              startDate: addDays(today(), -5),
            },
            ...json,
          },
        })
      ).body as Task;
    return { user, call, timed, allDay, task };
  }

  describe("creating and reading", () => {
    it("creates a timed appointment, answers 201 and reads it back", async () => {
      const { call, user } = await setup();
      const created = await call("POST", "/api/v1/appointments", {
        json: {
          title: "  Kaminfeger  ",
          notes: "Leiter bereitstellen",
          location: "Keller",
          startsAt: START,
          endsAt: END,
        },
      });
      expect(created.res.status).toBe(201);
      const a = created.body as Appointment;
      expect(a).toMatchObject({
        title: "Kaminfeger",
        notes: "Leiter bereitstellen",
        location: "Keller",
        allDay: false,
        startsAt: START,
        endsAt: END,
        startDate: null,
        endDate: null,
        status: "planned",
        taskId: null,
        assetId: null,
        contactId: null,
        commentCount: 0,
        createdByUserId: user.id,
      });
      expect((await call("GET", `/api/v1/appointments/${a.id}`)).body).toEqual(
        a,
      );
    });

    it("creates an all-day appointment of several days", async () => {
      const { call } = await setup();
      const created = await call("POST", "/api/v1/appointments", {
        json: {
          title: "Maler",
          allDay: true,
          startDate: "2030-03-12",
          endDate: "2030-03-14",
        },
      });
      expect(created.res.status).toBe(201);
      expect(created.body).toMatchObject({
        allDay: true,
        startDate: "2030-03-12",
        endDate: "2030-03-14",
        startsAt: null,
        endsAt: null,
      });
    });

    it("gives an appointment without an end an hour and links task, device and contact", async () => {
      const { call, task } = await setup();
      const asset = (
        await call("POST", "/api/v1/assets", { json: { name: "Heizung" } })
      ).body as { id: string };
      const contact = (
        await call("POST", "/api/v1/contacts", {
          json: { name: "Muster Haustechnik AG" },
        })
      ).body as { id: string };
      const t = await task({ assetId: asset.id });
      const created = await call("POST", "/api/v1/appointments", {
        json: {
          title: "Service",
          startsAt: START,
          taskId: t.id,
          contactId: contact.id,
          occurrenceKey: t.state?.occurrenceKey,
        },
      });
      expect(created.body).toMatchObject({
        endsAt: "2030-03-12T09:00:00.000Z",
        taskId: t.id,
        taskTitle: "Heizung warten",
        occurrenceKey: t.state?.occurrenceKey,
        assetId: asset.id,
        assetName: "Heizung",
        contactId: contact.id,
        contactName: "Muster Haustechnik AG",
      });
    });

    it("is a 404 for an appointment that does not exist", async () => {
      const { call } = await setup();
      expect(errorCode(await call("GET", "/api/v1/appointments/nope"))).toBe(
        "not_found",
      );
    });

    it("refuses an invalid body with a field error", async () => {
      const { call } = await setup();
      const field = async (json: object) => {
        const r = await call("POST", "/api/v1/appointments", { json });
        expect(r.res.status, JSON.stringify(json)).toBe(400);
        return Object.keys(
          (
            r.body as {
              error: {
                details: { body?: { fieldErrors: Record<string, unknown> } };
              };
            }
          ).error.details.body?.fieldErrors ?? {},
        );
      };
      expect(await field({ startsAt: START })).toEqual(["title"]);
      expect(await field({ title: "x" })).toEqual(["startsAt"]);
      expect(await field({ title: "x", allDay: true })).toEqual(["startDate"]);
      expect(
        await field({ title: "x", startsAt: START, startDate: "2030-03-12" }),
      ).toEqual(["startDate"]);
      expect(
        await field({
          title: "x",
          allDay: true,
          startDate: "2030-03-12",
          startsAt: START,
        }),
      ).toEqual(["startsAt"]);
      expect(await field({ title: "x", startsAt: END, endsAt: START })).toEqual(
        ["endsAt"],
      );
      expect(
        await field({
          title: "x",
          startsAt: START,
          endsAt: "2030-04-12T08:00:00.000Z",
        }),
      ).toEqual(["endsAt"]);
      expect(
        await field({
          title: "x",
          allDay: true,
          startDate: "2030-03-12",
          endDate: "2030-03-11",
        }),
      ).toEqual(["endDate"]);
      expect(
        await field({ title: "x", startsAt: START, occurrenceKey: "k" }),
      ).toEqual(["occurrenceKey"]);
      expect(await field({ title: "x".repeat(201), startsAt: START })).toEqual([
        "title",
      ]);
      expect(
        await field({ title: "x", startsAt: START, location: "x".repeat(301) }),
      ).toEqual(["location"]);
      expect(await field({ title: "x", startsAt: "not a time" })).toEqual([
        "startsAt",
      ]);
      expect(
        await field({ title: "x", startsAt: START, status: "done" }),
      ).toEqual([]);
      expect(
        await field({ title: "x", startsAt: START, taskId: "nope" }),
      ).toEqual(["taskId"]);
      expect(
        await field({ title: "x", startsAt: START, assetId: "nope" }),
      ).toEqual(["assetId"]);
      expect(
        await field({ title: "x", startsAt: START, contactId: "nope" }),
      ).toEqual(["contactId"]);
    });
  });

  describe("listing", () => {
    it("lists soonest first, filtered by days, status and links, in pages", async () => {
      const { call, timed, allDay, task } = await setup();
      const t = await task();
      const first = await timed({
        title: "Erster",
        startsAt: "2030-03-12T08:00:00.000Z",
        endsAt: "2030-03-12T09:00:00.000Z",
        taskId: t.id,
      });
      const second = await allDay({
        title: "Zweiter",
        startDate: "2030-03-14",
      });
      const third = await timed({
        title: "Dritter",
        startsAt: "2030-03-20T08:00:00.000Z",
        endsAt: "2030-03-20T09:00:00.000Z",
      });
      await call("PATCH", `/api/v1/appointments/${third.id}`, {
        json: { status: "cancelled" },
      });
      const ids = async (query: string) =>
        (
          (await call("GET", `/api/v1/appointments${query}`)).body as List
        ).items.map((a) => a.id);
      expect(await ids("")).toEqual([first.id, second.id, third.id]);
      expect(await ids("?from=2030-03-13&to=2030-03-19")).toEqual([second.id]);
      expect(await ids("?from=2030-03-14")).toEqual([second.id, third.id]);
      expect(await ids("?to=2030-03-12")).toEqual([first.id]);
      expect(await ids("?status=cancelled")).toEqual([third.id]);
      expect(await ids("?status=planned")).toEqual([first.id, second.id]);
      expect(await ids(`?taskId=${t.id}`)).toEqual([first.id]);
      expect(await ids("?assetId=nope")).toEqual([]);

      const page = (await call("GET", "/api/v1/appointments?limit=2"))
        .body as List;
      expect(page.items.map((a) => a.id)).toEqual([first.id, second.id]);
      expect(page.nextCursor).not.toBeNull();
      const rest = (
        await call(
          "GET",
          `/api/v1/appointments?limit=2&cursor=${page.nextCursor}`,
        )
      ).body as List;
      expect(rest.items.map((a) => a.id)).toEqual([third.id]);
      expect(rest.nextCursor).toBeNull();
    });

    it("refuses a range that ends before it starts and an unknown status", async () => {
      const { call } = await setup();
      expect(
        (
          await call(
            "GET",
            "/api/v1/appointments?from=2030-03-14&to=2030-03-13",
          )
        ).res.status,
      ).toBe(400);
      expect(
        (await call("GET", "/api/v1/appointments?status=open")).res.status,
      ).toBe(400);
      expect(
        (await call("GET", "/api/v1/appointments?from=14.03.2030")).res.status,
      ).toBe(400);
    });

    it("is shared by every member", async () => {
      const { timed } = await setup();
      const a = await timed();
      const ben = await createTestUser({ displayName: "Ben" });
      const asBen = createCaller({ session: loginTestUser(ben).token });
      const list = (await asBen("GET", "/api/v1/appointments")).body as List;
      expect(list.items.map((x) => x.id)).toEqual([a.id]);
      const changed = await asBen("PATCH", `/api/v1/appointments/${a.id}`, {
        json: { title: "Von Ben" },
      });
      expect(changed.body).toMatchObject({
        title: "Von Ben",
        createdByUserId: expect.any(String),
      });
    });
  });

  describe("changing and deleting", () => {
    it("changes fields, cancels and reopens, and refuses what would break the span", async () => {
      const { call, timed } = await setup();
      const a = await timed();
      const patched = await call("PATCH", `/api/v1/appointments/${a.id}`, {
        json: { title: "Neu", location: null, notes: "Hinweis" },
      });
      expect(patched.body).toMatchObject({
        title: "Neu",
        location: null,
        notes: "Hinweis",
        startsAt: START,
      });
      for (const status of ["cancelled", "planned", "done"]) {
        expect(
          (
            await call("PATCH", `/api/v1/appointments/${a.id}`, {
              json: { status },
            })
          ).body,
        ).toMatchObject({ status });
      }
      const bad = await call("PATCH", `/api/v1/appointments/${a.id}`, {
        json: { startsAt: "2030-03-12T10:00:00.000Z" },
      });
      expect(bad.res.status).toBe(400);
      expect(
        (await call("GET", `/api/v1/appointments/${a.id}`)).body,
      ).toMatchObject({ startsAt: START, endsAt: END });
      expect(
        (
          await call("PATCH", `/api/v1/appointments/${a.id}`, {
            json: { allDay: true, startDate: "2030-03-13" },
          })
        ).body,
      ).toMatchObject({
        allDay: true,
        startDate: "2030-03-13",
        endDate: "2030-03-13",
        startsAt: null,
      });
    });

    it("refuses empty and contradictory bodies", async () => {
      const { call, timed } = await setup();
      const a = await timed();
      const patch = async (json: object) =>
        (await call("PATCH", `/api/v1/appointments/${a.id}`, { json })).res
          .status;
      expect(await patch({})).toBe(400);
      expect(await patch({ allDay: true, startsAt: START })).toBe(400);
      expect(await patch({ allDay: false, startDate: "2030-03-12" })).toBe(400);
      expect(await patch({ startsAt: START, startDate: "2030-03-12" })).toBe(
        400,
      );
      expect(await patch({ occurrenceKey: "k", taskId: null })).toBe(400);
      expect(await patch({ unknown: 1 })).toBe(400);
      expect(await patch({ status: "open" })).toBe(400);
      expect(
        errorCode(
          await call("PATCH", "/api/v1/appointments/nope", {
            json: { title: "x" },
          }),
        ),
      ).toBe("not_found");
    });

    it("deletes with 204 and then reports 404", async () => {
      const { call, timed } = await setup();
      const a = await timed();
      const gone = await call("DELETE", `/api/v1/appointments/${a.id}`);
      expect(gone.res.status).toBe(204);
      expect(errorCode(await call("GET", `/api/v1/appointments/${a.id}`))).toBe(
        "not_found",
      );
      expect(
        errorCode(await call("DELETE", `/api/v1/appointments/${a.id}`)),
      ).toBe("not_found");
    });
  });

  describe("completing", () => {
    it("completes the task of the appointment, answers 200 and repeats safely", async () => {
      const { call, timed, task, user } = await setup();
      const t = await task();
      const a = await timed({ taskId: t.id });
      const first = await call(
        "POST",
        `/api/v1/appointments/${a.id}/complete`,
        { json: { note: "Alles gut" } },
      );
      expect(first.res.status).toBe(200);
      const body = first.body as Completed;
      expect(body).toMatchObject({
        appointment: { id: a.id, status: "done" },
        completion: { taskId: t.id, source: "manual" },
        task: { id: t.id },
        replayed: false,
      });
      expect(body.task?.state?.status).not.toBe("overdue");
      const done = (await call("GET", `/api/v1/tasks/${t.id}`)).body as {
        recentCompletions: { id: string; userId: string; note: string }[];
        nextAppointment: unknown;
      };
      expect(done.recentCompletions).toMatchObject([
        { id: body.completion?.id, userId: user.id, note: "Alles gut" },
      ]);
      expect(done.nextAppointment).toBeNull();

      const again = await call(
        "POST",
        `/api/v1/appointments/${a.id}/complete`,
        { json: {} },
      );
      expect(again.res.status).toBe(200);
      expect((again.body as Completed).completion?.id).toBe(
        body.completion?.id,
      );
      expect((again.body as Completed).replayed).toBe(true);
      expect(
        (
          (await call("GET", "/api/v1/completions")).body as {
            items: unknown[];
          }
        ).items,
      ).toHaveLength(1);
    });

    it("completes an appointment without a task and does not need a body", async () => {
      const { call, timed } = await setup();
      const a = await timed();
      const r = await call("POST", `/api/v1/appointments/${a.id}/complete`, {
        json: {},
      });
      expect(r.body).toMatchObject({
        appointment: { status: "done" },
        completion: null,
        task: null,
        replayed: false,
      });
    });

    it("attributes the completion by the kind of token", async () => {
      const { user, timed, task } = await setup();
      const t = await task();
      const a = await timed({ taskId: t.id });
      const { token } = createTestToken(user, {
        kind: "mcp",
        scopes: ["read", "write"],
      });
      const asToken = createCaller({ bearer: token });
      const r = await asToken("POST", `/api/v1/appointments/${a.id}/complete`, {
        json: {},
      });
      expect(r.res.status).toBe(200);
      expect((r.body as Completed).completion?.source).toBe("mcp");
    });

    it("refuses a cancelled appointment with 409 and a missing one with 404", async () => {
      const { call, timed } = await setup();
      const a = await timed();
      await call("PATCH", `/api/v1/appointments/${a.id}`, {
        json: { status: "cancelled" },
      });
      expect(
        errorCode(
          await call("POST", `/api/v1/appointments/${a.id}/complete`, {
            json: {},
          }),
        ),
      ).toBe("conflict");
      expect(
        errorCode(
          await call("POST", "/api/v1/appointments/nope/complete", {
            json: {},
          }),
        ),
      ).toBe("not_found");
    });

    it("refuses a completion dated in the future", async () => {
      const { call, timed, task } = await setup();
      const t = await task();
      const a = await timed({ taskId: t.id });
      const r = await call("POST", `/api/v1/appointments/${a.id}/complete`, {
        json: { completedAt: "2099-01-01T00:00:00.000Z" },
      });
      expect(r.res.status).toBe(400);
      expect(
        (
          (await call("GET", `/api/v1/appointments/${a.id}`))
            .body as Appointment
        ).status,
      ).toBe("planned");
    });

    it("does not reopen the appointment when the completion is undone", async () => {
      const { call, timed, task } = await setup();
      const t = await task();
      const a = await timed({ taskId: t.id });
      const done = (
        await call("POST", `/api/v1/appointments/${a.id}/complete`, {
          json: {},
        })
      ).body as Completed;
      const undo = await call(
        "DELETE",
        `/api/v1/completions/${done.completion?.id}`,
      );
      expect(undo.res.status).toBe(204);
      expect(
        (
          (await call("GET", `/api/v1/appointments/${a.id}`))
            .body as Appointment
        ).status,
      ).toBe("done");
      expect(
        ((await call("GET", `/api/v1/tasks/${t.id}`)).body as Task).state
          ?.status,
      ).toBe("overdue");
    });
  });

  describe("the task and the dashboard", () => {
    it("show the next planned appointment of a task", async () => {
      const { call, timed, allDay, task } = await setup();
      const t = await task();
      expect((await call("GET", `/api/v1/tasks/${t.id}`)).body).toMatchObject({
        nextAppointment: null,
      });
      const late = await timed({
        taskId: t.id,
        startsAt: "2030-04-01T08:00:00.000Z",
        endsAt: "2030-04-01T09:00:00.000Z",
      });
      expect((await call("GET", `/api/v1/tasks/${t.id}`)).body).toMatchObject({
        nextAppointment: {
          id: late.id,
          allDay: false,
          startsAt: "2030-04-01T08:00:00.000Z",
          startDate: null,
        },
      });
      const early = await allDay({ taskId: t.id, startDate: "2030-03-20" });
      const tasks = (await call("GET", "/api/v1/tasks")).body as {
        items: Task[];
      };
      expect(tasks.items.find((x) => x.id === t.id)?.nextAppointment).toEqual({
        id: early.id,
        allDay: true,
        startsAt: null,
        startDate: "2030-03-20",
      });
      const dashboard = (await call("GET", "/api/v1/dashboard")).body as {
        upcoming: Record<
          string,
          { taskId: string; nextAppointment: unknown }[]
        >;
      };
      const row = Object.values(dashboard.upcoming)
        .flat()
        .find((x) => x.taskId === t.id);
      expect(row?.nextAppointment).toMatchObject({ id: early.id });
      await call("PATCH", `/api/v1/appointments/${early.id}`, {
        json: { status: "cancelled" },
      });
      await call("PATCH", `/api/v1/appointments/${late.id}`, {
        json: { status: "done" },
      });
      expect((await call("GET", `/api/v1/tasks/${t.id}`)).body).toMatchObject({
        nextAppointment: null,
      });
    });

    it("lose the appointment pointer when the appointment is deleted", async () => {
      const { call, timed, task } = await setup();
      const t = await task();
      const a = await timed({ taskId: t.id });
      await call("DELETE", `/api/v1/appointments/${a.id}`);
      expect((await call("GET", `/api/v1/tasks/${t.id}`)).body).toMatchObject({
        nextAppointment: null,
      });
    });

    it("unlinks the appointment when the task is deleted", async () => {
      const { call, timed, task } = await setup();
      const t = await task();
      const a = await timed({ taskId: t.id, occurrenceKey: "k1" });
      await call("DELETE", `/api/v1/tasks/${t.id}`);
      expect(
        (await call("GET", `/api/v1/appointments/${a.id}`)).body,
      ).toMatchObject({ taskId: null, taskTitle: null, occurrenceKey: null });
    });
  });

  it("has comments, attachments and a search hit", async () => {
    const { call, timed } = await setup();
    const a = await timed({ location: "Kellertür" });
    const comment = await call("POST", "/api/v1/comments", {
      json: {
        entityType: "appointment",
        entityId: a.id,
        bodyMd: "Schlüssel liegt im Briefkasten",
      },
    });
    expect(comment.res.status).toBe(201);
    expect(
      (await call("GET", `/api/v1/appointments/${a.id}`)).body,
    ).toMatchObject({ commentCount: 1 });

    const upload = await call("POST", "/api/v1/attachments", {
      form: {
        file: new File([samplePdf() as BlobPart], "offerte.pdf", {
          type: "application/pdf",
        }),
        ownerType: "appointment",
        ownerId: a.id,
      },
    });
    expect(upload.res.status).toBe(201);

    const hits = (await call("GET", "/api/v1/search?q=kellertür")).body as {
      items: { type: string; id: string; url: string }[];
    };
    expect(hits.items).toEqual([
      expect.objectContaining({
        type: "appointment",
        id: a.id,
        url: `/appointments/${a.id}`,
      }),
    ]);

    await call("DELETE", `/api/v1/appointments/${a.id}`);
    expect(
      errorCode(
        await call(
          "GET",
          `/api/v1/comments?entityType=appointment&entityId=${a.id}`,
        ),
      ),
    ).toBe("not_found");
    expect(
      (
        (
          await call(
            "GET",
            `/api/v1/attachments?ownerType=appointment&ownerId=${a.id}`,
          )
        ).body as { items: unknown[] }
      ).items,
    ).toEqual([]);
    expect(
      (
        (await call("GET", "/api/v1/search?q=kellertür")).body as {
          items: unknown[];
        }
      ).items,
    ).toEqual([]);
  });

  it("lets a token with the read scope read and nothing else", async () => {
    const { user, timed } = await setup();
    const a = await timed();
    const { token } = createTestToken(user, {
      kind: "mobile",
      scopes: ["read"],
    });
    const asToken = createCaller({ bearer: token });
    expect((await asToken("GET", "/api/v1/appointments")).res.status).toBe(200);
    expect(
      (await asToken("GET", `/api/v1/appointments/${a.id}`)).res.status,
    ).toBe(200);
    for (const [method, path, json] of [
      ["POST", "/api/v1/appointments", { title: "x", startsAt: START }],
      ["PATCH", `/api/v1/appointments/${a.id}`, { title: "x" }],
      ["DELETE", `/api/v1/appointments/${a.id}`, undefined],
      ["POST", `/api/v1/appointments/${a.id}/complete`, {}],
    ] as const) {
      expect(
        (await asToken(method, path, json === undefined ? {} : { json })).res
          .status,
        `${method} ${path}`,
      ).toBe(403);
    }
  });
});
