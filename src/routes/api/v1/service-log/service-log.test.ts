import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { today } from "$lib/testing/dates";

type Entry = {
  id: string;
  assetId: string;
  title: string;
  kind: string;
  date: string;
  completionId: string | null;
  costMinor: number | null;
  currency: string | null;
  contactName: string | null;
};

describe("service log API", () => {
  useTestDB();
  async function setup() {
    const user = await createTestUser();
    const call = createCaller({ session: loginTestUser(user).token });
    const asset = async (name = "Boiler") =>
      (await call("POST", "/api/v1/assets", { json: { name } })).body as {
        id: string;
      };
    return { user, call, asset };
  }

  it("adds, reads, updates and deletes entries of an asset", async () => {
    const { call, asset } = await setup();
    const a = await asset();
    const created = await call("POST", `/api/v1/assets/${a.id}/service-log`, {
      json: {
        title: "Entkalkt",
        kind: "maintenance",
        descriptionMd: "mit **Zitronensäure**",
        costMinor: 4500,
        performedBy: "Anna",
      },
    });
    expect(created.res.status).toBe(201);
    const e = created.body as Entry;
    expect(e).toMatchObject({
      assetId: a.id,
      date: today(),
      currency: "CHF",
      costMinor: 4500,
      performedBy: "Anna",
      assetName: "Boiler",
    });
    expect(
      (await call("GET", `/api/v1/assets/${a.id}/service-log/${e.id}`)).body,
    ).toEqual(e);
    const patched = await call(
      "PATCH",
      `/api/v1/assets/${a.id}/service-log/${e.id}`,
      { json: { title: "Neu", kind: "repair", costMinor: null } },
    );
    expect(patched.body).toMatchObject({
      title: "Neu",
      kind: "repair",
      costMinor: null,
      currency: null,
    });
    expect(
      (await call("DELETE", `/api/v1/assets/${a.id}/service-log/${e.id}`)).res
        .status,
    ).toBe(204);
    expect(
      errorCode(
        await call("GET", `/api/v1/assets/${a.id}/service-log/${e.id}`),
      ),
    ).toBe("not_found");
  });

  it("lists per asset and across assets, newest first, filtered and paged", async () => {
    const { call, asset } = await setup();
    const a = await asset();
    const b = await asset("Ofen");
    const add = (id: string, json: object) =>
      call("POST", `/api/v1/assets/${id}/service-log`, { json });
    await add(a.id, { title: "alt", date: "2026-01-01" });
    await add(b.id, { title: "mitte", date: "2026-03-01", kind: "repair" });
    await add(a.id, { title: "neu", date: "2026-05-01" });
    const titles = async (path: string) =>
      ((await call("GET", path)).body as { items: Entry[] }).items.map(
        (e) => e.title,
      );
    expect(await titles("/api/v1/service-log")).toEqual([
      "neu",
      "mitte",
      "alt",
    ]);
    expect(await titles(`/api/v1/service-log?assetId=${b.id}`)).toEqual([
      "mitte",
    ]);
    expect(await titles("/api/v1/service-log?kind=repair")).toEqual(["mitte"]);
    expect(
      await titles("/api/v1/service-log?from=2026-02-01&to=2026-04-01"),
    ).toEqual(["mitte"]);
    expect(await titles(`/api/v1/assets/${a.id}/service-log`)).toEqual([
      "neu",
      "alt",
    ]);
    expect(
      await titles(`/api/v1/assets/${a.id}/service-log?kind=repair`),
    ).toEqual([]);
    const page = (await call("GET", "/api/v1/service-log?limit=2")).body as {
      items: Entry[];
      nextCursor: string;
    };
    const next = (
      await call("GET", `/api/v1/service-log?limit=2&cursor=${page.nextCursor}`)
    ).body as { items: Entry[]; nextCursor: null };
    expect([
      page.items.length,
      next.items.map((e) => e.title),
      next.nextCursor,
    ]).toEqual([2, ["alt"], null]);
  });

  it("validates input and answers 404", async () => {
    const { call, asset } = await setup();
    const a = await asset();
    const b = await asset("Ofen");
    for (const json of [
      {},
      { title: "" },
      { title: "x", kind: "party" },
      { title: "x", date: "2026-13-01" },
      { title: "x", costMinor: -1 },
      { title: "x", costMinor: 1.5 },
      { title: "x", contactId: "nope" },
      { title: "x", surprise: 1 },
    ]) {
      const r = await call("POST", `/api/v1/assets/${a.id}/service-log`, {
        json,
      });
      expect([r.res.status, errorCode(r)], JSON.stringify(json)).toEqual([
        400,
        "invalid_request",
      ]);
    }
    expect(
      errorCode(
        await call("POST", "/api/v1/assets/nope/service-log", {
          json: { title: "x" },
        }),
      ),
    ).toBe("not_found");
    expect(
      errorCode(await call("GET", "/api/v1/assets/nope/service-log")),
    ).toBe("not_found");
    const e = (
      await call("POST", `/api/v1/assets/${a.id}/service-log`, {
        json: { title: "x" },
      })
    ).body as Entry;
    expect(
      errorCode(
        await call("GET", `/api/v1/assets/${b.id}/service-log/${e.id}`),
      ),
    ).toBe("not_found");
    expect(
      errorCode(
        await call("PATCH", `/api/v1/assets/${b.id}/service-log/${e.id}`, {
          json: { title: "y" },
        }),
      ),
    ).toBe("not_found");
    expect(
      errorCode(
        await call("DELETE", `/api/v1/assets/${b.id}/service-log/${e.id}`),
      ),
    ).toBe("not_found");
    expect(
      errorCode(
        await call("PATCH", `/api/v1/assets/${a.id}/service-log/${e.id}`, {
          json: {},
        }),
      ),
    ).toBe("invalid_request");
    expect(errorCode(await call("GET", "/api/v1/service-log?kind=nope"))).toBe(
      "invalid_request",
    );
  });

  it("names the contact", async () => {
    const { call, asset } = await setup();
    const a = await asset();
    const c = (
      await call("POST", "/api/v1/contacts", { json: { name: "Muster AG" } })
    ).body as { id: string };
    const e = await call("POST", `/api/v1/assets/${a.id}/service-log`, {
      json: { title: "x", contactId: c.id },
    });
    expect(e.body).toMatchObject({ contactId: c.id, contactName: "Muster AG" });
    await call("DELETE", `/api/v1/contacts/${c.id}`);
    expect(
      (
        (
          await call(
            "GET",
            `/api/v1/assets/${a.id}/service-log/${(e.body as Entry).id}`,
          )
        ).body as Entry
      ).contactName,
    ).toBeNull();
  });

  describe("with a task completion", () => {
    const oneOff = { v: 1, type: "one_off", date: "2099-01-01" };

    it("also writes a service log entry linked to the completion", async () => {
      const { call, asset } = await setup();
      const a = await asset();
      const c = (
        await call("POST", "/api/v1/contacts", { json: { name: "Muster AG" } })
      ).body as { id: string };
      const task = (
        await call("POST", "/api/v1/tasks", {
          json: { title: "Entkalken", assetId: a.id, trigger: oneOff },
        })
      ).body as { id: string };
      const done = await call("POST", `/api/v1/tasks/${task.id}/complete`, {
        json: {
          serviceLog: {
            kind: "maintenance",
            descriptionMd: "alles ok",
            contactId: c.id,
            costMinor: 12000,
          },
        },
      });
      expect(done.res.status).toBe(201);
      const body = done.body as {
        completion: { id: string; completedDate: string };
        serviceLog: Entry;
      };
      expect(body.serviceLog).toMatchObject({
        assetId: a.id,
        title: "Entkalken",
        kind: "maintenance",
        date: body.completion.completedDate,
        completionId: body.completion.id,
        contactName: "Muster AG",
        costMinor: 12000,
        currency: "CHF",
      });
      expect(
        (
          (await call("GET", `/api/v1/assets/${a.id}/service-log`)).body as {
            items: Entry[];
          }
        ).items,
      ).toHaveLength(1);
    });

    it("takes a title of its own", async () => {
      const { call, asset } = await setup();
      const a = await asset();
      const task = (
        await call("POST", "/api/v1/tasks", {
          json: { title: "Entkalken", assetId: a.id, trigger: oneOff },
        })
      ).body as { id: string };
      const done = await call("POST", `/api/v1/tasks/${task.id}/complete`, {
        json: {
          serviceLog: {
            title: "Entkalkt mit Spezialmittel",
            kind: "inspection",
          },
        },
      });
      expect((done.body as { serviceLog: Entry }).serviceLog).toMatchObject({
        title: "Entkalkt mit Spezialmittel",
        kind: "inspection",
      });
    });

    it("is null without a serviceLog request and for skips", async () => {
      const { call, asset } = await setup();
      const a = await asset();
      const task = (
        await call("POST", "/api/v1/tasks", {
          json: { title: "T", assetId: a.id, trigger: oneOff },
        })
      ).body as { id: string };
      expect(
        (await call("POST", `/api/v1/tasks/${task.id}/complete`, { json: {} }))
          .body,
      ).toMatchObject({ serviceLog: null });
      expect(
        (await call("POST", `/api/v1/tasks/${task.id}/skip`, { json: {} }))
          .body,
      ).toMatchObject({ serviceLog: null });
      expect(
        errorCode(
          await call("POST", `/api/v1/tasks/${task.id}/skip`, {
            json: { serviceLog: { kind: "repair" } },
          }),
        ),
      ).toBe("invalid_request");
      expect(
        (
          (await call("GET", `/api/v1/assets/${a.id}/service-log`)).body as {
            items: Entry[];
          }
        ).items,
      ).toEqual([]);
    });

    it("refuses tasks without an asset and bad contacts without completing anything", async () => {
      const { call, asset } = await setup();
      const a = await asset();
      const plain = (
        await call("POST", "/api/v1/tasks", {
          json: { title: "Ohne Gerät", trigger: oneOff },
        })
      ).body as { id: string };
      const r = await call("POST", `/api/v1/tasks/${plain.id}/complete`, {
        json: { serviceLog: { kind: "repair" } },
      });
      expect([r.res.status, errorCode(r)]).toEqual([400, "invalid_request"]);
      const task = (
        await call("POST", "/api/v1/tasks", {
          json: { title: "T", assetId: a.id, trigger: oneOff },
        })
      ).body as { id: string };
      expect(
        errorCode(
          await call("POST", `/api/v1/tasks/${task.id}/complete`, {
            json: { serviceLog: { contactId: "nope" } },
          }),
        ),
      ).toBe("invalid_request");
      expect(
        errorCode(
          await call("POST", `/api/v1/tasks/${task.id}/complete`, {
            json: { serviceLog: { kind: "party" } },
          }),
        ),
      ).toBe("invalid_request");
      expect(
        (
          (await call("GET", `/api/v1/tasks/${plain.id}`)).body as {
            recentCompletions: unknown[];
          }
        ).recentCompletions,
      ).toEqual([]);
      expect(
        (
          (await call("GET", `/api/v1/tasks/${task.id}`)).body as {
            recentCompletions: unknown[];
          }
        ).recentCompletions,
      ).toEqual([]);
    });

    it("a retried request returns the same entry and writes no second one", async () => {
      const { call, asset } = await setup();
      const a = await asset();
      const task = (
        await call("POST", "/api/v1/tasks", {
          json: { title: "T", assetId: a.id, trigger: oneOff },
        })
      ).body as { id: string };
      const json = {
        idempotencyKey: "retry-key-42",
        serviceLog: { kind: "maintenance" },
      };
      const first = await call("POST", `/api/v1/tasks/${task.id}/complete`, {
        json,
      });
      const second = await call("POST", `/api/v1/tasks/${task.id}/complete`, {
        json,
      });
      expect([first.res.status, second.res.status]).toEqual([201, 200]);
      expect((second.body as { serviceLog: Entry }).serviceLog.id).toBe(
        (first.body as { serviceLog: Entry }).serviceLog.id,
      );
      expect(
        (
          (await call("GET", `/api/v1/assets/${a.id}/service-log`)).body as {
            items: Entry[];
          }
        ).items,
      ).toHaveLength(1);
    });
  });

  it("needs write scope to change", async () => {
    const { user, asset } = await setup();
    const a = await asset();
    const reader = createCaller({
      bearer: createTestToken(user, { scopes: ["read"] }).token,
    });
    expect((await reader("GET", "/api/v1/service-log")).res.status).toBe(200);
    expect(
      (
        await reader("POST", `/api/v1/assets/${a.id}/service-log`, {
          json: { title: "x" },
        })
      ).res.status,
    ).toBe(403);
  });
});
