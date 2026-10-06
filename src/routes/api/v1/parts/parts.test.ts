import { describe, expect, it } from "vitest";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";
import { today } from "$lib/testing/dates";

type Part = {
  id: string;
  name: string;
  stockCount: number;
  orderedQty: number;
  orderedAt: string | null;
  lowStock: boolean;
  currency: string;
};
type Item = Record<string, unknown> & {
  partId: string;
  quantity: number;
  late: boolean;
};

const oneOff = (date: string) => ({ v: 1, type: "one_off", date });

describe("parts API", () => {
  useTestDB();
  async function setup() {
    const user = await createTestUser();
    const call = createCaller({ session: loginTestUser(user).token });
    const part = async (json: object = {}) =>
      (
        await call("POST", "/api/v1/parts", {
          json: { name: "Filterpatrone", ...json },
        })
      ).body as Part;
    const task = async (json: object = {}) =>
      (
        await call("POST", "/api/v1/tasks", {
          json: {
            title: "Filter wechseln",
            trigger: oneOff(today(5)),
            ...json,
          },
        })
      ).body as { id: string };
    return { user, call, part, task };
  }

  it("creates, reads with links and history, updates and deletes", async () => {
    const { call, part } = await setup();
    const created = await call("POST", "/api/v1/parts", {
      json: {
        name: "Dichtung",
        partNumber: "D-1",
        supplier: "Muster AG",
        shopUrl: "https://example.org/d1",
        unitPriceMinor: 1290,
        stockCount: 3,
        minStock: 1,
      },
    });
    expect(created.res.status).toBe(201);
    const p = created.body as Part;
    expect(p).toMatchObject({
      currency: "CHF",
      stockCount: 3,
      lowStock: false,
      orderedQty: 0,
      orderedAt: null,
    });
    const detail = (await call("GET", `/api/v1/parts/${p.id}`)).body as {
      assets: unknown[];
      tasks: unknown[];
      recentMovements: { delta: number }[];
    };
    expect(detail).toMatchObject({ assets: [], tasks: [] });
    expect(detail.recentMovements.map((m) => m.delta)).toEqual([3]);
    const patched = await call("PATCH", `/api/v1/parts/${p.id}`, {
      json: { supplier: null, minStock: 5 },
    });
    expect(patched.body).toMatchObject({
      supplier: null,
      minStock: 5,
      lowStock: true,
      stockCount: 3,
    });
    expect((await call("DELETE", `/api/v1/parts/${p.id}`)).res.status).toBe(
      204,
    );
    expect(errorCode(await call("GET", `/api/v1/parts/${p.id}`))).toBe(
      "not_found",
    );
    expect((await part()).id).toBeTruthy();
  });

  it("validates input", async () => {
    const { call, part } = await setup();
    for (const json of [
      {},
      { name: "x", shopUrl: "javascript:alert(1)" },
      { name: "x", shopUrl: "ftp://example.org" },
      { name: "x", stockCount: -1 },
      { name: "x", reorderQty: 0 },
      { name: "x", unitPriceMinor: 1.5 },
      { name: "x", currency: "chf" },
      { name: "x", surprise: true },
    ]) {
      const r = await call("POST", "/api/v1/parts", { json });
      expect([r.res.status, errorCode(r)], JSON.stringify(json)).toEqual([
        400,
        "invalid_request",
      ]);
    }
    const p = await part();
    expect(
      errorCode(
        await call("PATCH", `/api/v1/parts/${p.id}`, {
          json: { stockCount: 5 },
        }),
      ),
    ).toBe("invalid_request");
    expect(
      errorCode(await call("PATCH", `/api/v1/parts/${p.id}`, { json: {} })),
    ).toBe("invalid_request");
    expect(
      errorCode(
        await call("PATCH", "/api/v1/parts/nope", { json: { name: "y" } }),
      ),
    ).toBe("not_found");
    expect(errorCode(await call("DELETE", "/api/v1/parts/nope"))).toBe(
      "not_found",
    );
  });

  it("books stock movements and keeps the history", async () => {
    const { call, part, user } = await setup();
    const p = await part({ stockCount: 2 });
    const used = await call("POST", `/api/v1/parts/${p.id}/stock`, {
      json: { delta: -1, reason: "used", note: "Küche" },
    });
    expect(used.body).toMatchObject({ stockCount: 1 });
    expect(
      (
        await call("POST", `/api/v1/parts/${p.id}/stock`, {
          json: { delta: 10, reason: "bought" },
        })
      ).body,
    ).toMatchObject({ stockCount: 11 });
    const history = (await call("GET", `/api/v1/parts/${p.id}/movements`))
      .body as {
      items: {
        delta: number;
        reason: string;
        userId: string;
        note: string | null;
      }[];
    };
    expect(history.items.map((m) => [m.reason, m.delta])).toEqual([
      ["bought", 10],
      ["used", -1],
      ["correction", 2],
    ]);
    expect(history.items[1]).toMatchObject({ userId: user.id, note: "Küche" });
    const page = (await call("GET", `/api/v1/parts/${p.id}/movements?limit=2`))
      .body as { items: unknown[]; nextCursor: string };
    expect(page.items).toHaveLength(2);
    const next = (
      await call(
        "GET",
        `/api/v1/parts/${p.id}/movements?limit=2&cursor=${page.nextCursor}`,
      )
    ).body as { items: unknown[] };
    expect(next.items).toHaveLength(1);
  });

  it("rejects bad movements", async () => {
    const { call, part } = await setup();
    const p = await part({ stockCount: 1 });
    const stock = (json: object) =>
      call("POST", `/api/v1/parts/${p.id}/stock`, { json });
    for (const json of [
      { delta: 0, reason: "correction" },
      { delta: 1, reason: "used" },
      { delta: -1, reason: "bought" },
      { delta: -2, reason: "used" },
      { delta: 1.5, reason: "bought" },
      { delta: 1, reason: "stolen" },
      { reason: "bought" },
    ]) {
      const r = await stock(json);
      expect([r.res.status, errorCode(r)], JSON.stringify(json)).toEqual([
        400,
        "invalid_request",
      ]);
    }
    expect(
      errorCode(
        await call("POST", "/api/v1/parts/nope/stock", {
          json: { delta: 1, reason: "bought" },
        }),
      ),
    ).toBe("not_found");
    expect(errorCode(await call("GET", "/api/v1/parts/nope/movements"))).toBe(
      "not_found",
    );
    expect(
      ((await call("GET", `/api/v1/parts/${p.id}`)).body as Part).stockCount,
    ).toBe(1);
  });

  it("marks parts as ordered and clears it when bought", async () => {
    const { call, part } = await setup();
    const p = await part({ reorderQty: 4 });
    const ordered = (
      await call("POST", `/api/v1/parts/${p.id}/ordered`, { json: {} })
    ).body as Part;
    expect(ordered).toMatchObject({ orderedQty: 4 });
    expect(ordered.orderedAt).toMatch(/Z$/);
    expect(
      (
        await call("POST", `/api/v1/parts/${p.id}/ordered`, {
          json: { qty: 2 },
        })
      ).body,
    ).toMatchObject({ orderedQty: 2 });
    expect(
      (
        await call("POST", `/api/v1/parts/${p.id}/stock`, {
          json: { delta: 2, reason: "bought" },
        })
      ).body,
    ).toMatchObject({ orderedQty: 0, orderedAt: null });
    await call("POST", `/api/v1/parts/${p.id}/ordered`, { json: { qty: 3 } });
    expect(
      (
        await call("POST", `/api/v1/parts/${p.id}/ordered`, {
          json: { qty: 0 },
        })
      ).body,
    ).toMatchObject({ orderedQty: 0, orderedAt: null });
    expect(
      errorCode(
        await call("POST", `/api/v1/parts/${p.id}/ordered`, {
          json: { qty: -1 },
        }),
      ),
    ).toBe("invalid_request");
    expect(
      errorCode(await call("POST", "/api/v1/parts/nope/ordered", { json: {} })),
    ).toBe("not_found");
  });

  it("filters the list", async () => {
    const { call, part, task } = await setup();
    const a = await part({ name: "Alpha", minStock: 2 });
    const b = await part({
      name: "Beta",
      supplier: "Muster AG",
      stockCount: 5,
    });
    const old = await part({ name: "Alt" });
    await call("PATCH", `/api/v1/parts/${old.id}`, {
      json: { archived: true },
    });
    const asset = (
      await call("POST", "/api/v1/assets", { json: { name: "Mixer" } })
    ).body as { id: string };
    await call("POST", `/api/v1/assets/${asset.id}/parts`, {
      json: { partId: a.id },
    });
    const t = await task();
    await call("POST", `/api/v1/tasks/${t.id}/parts`, {
      json: { partId: b.id },
    });
    const names = async (qs: string) =>
      (
        (await call("GET", `/api/v1/parts${qs}`)).body as { items: Part[] }
      ).items.map((p) => p.name);
    expect(await names("")).toEqual(["Alpha", "Beta"]);
    expect(await names("?includeArchived=true")).toEqual([
      "Alpha",
      "Alt",
      "Beta",
    ]);
    expect(await names("?lowStock=true")).toEqual(["Alpha"]);
    expect(await names("?q=muster")).toEqual(["Beta"]);
    expect(await names(`?assetId=${asset.id}`)).toEqual(["Alpha"]);
    expect(await names(`?taskId=${t.id}`)).toEqual(["Beta"]);
  });

  it("links parts to assets and tasks", async () => {
    const { call, part, task } = await setup();
    const p = await part();
    const asset = (
      await call("POST", "/api/v1/assets", { json: { name: "Mixer" } })
    ).body as { id: string };
    const t = await task();
    expect(
      (
        await call("POST", `/api/v1/assets/${asset.id}/parts`, {
          json: { partId: p.id },
        })
      ).res.status,
    ).toBe(201);
    expect(
      errorCode(
        await call("POST", `/api/v1/assets/${asset.id}/parts`, {
          json: { partId: p.id },
        }),
      ),
    ).toBe("conflict");
    expect(
      (
        (await call("GET", `/api/v1/assets/${asset.id}/parts`)).body as {
          items: { part: Part }[];
        }
      ).items[0].part.id,
    ).toBe(p.id);
    const link = await call("POST", `/api/v1/tasks/${t.id}/parts`, {
      json: { partId: p.id, qty: 2 },
    });
    expect(link.res.status).toBe(201);
    expect(link.body).toMatchObject({ taskId: t.id, partId: p.id, qty: 2 });
    expect(
      errorCode(
        await call("POST", `/api/v1/tasks/${t.id}/parts`, {
          json: { partId: p.id },
        }),
      ),
    ).toBe("conflict");
    expect(
      (
        await call("PATCH", `/api/v1/tasks/${t.id}/parts/${p.id}`, {
          json: { qty: 3 },
        })
      ).body,
    ).toMatchObject({ qty: 3 });
    expect(
      (
        (await call("GET", `/api/v1/tasks/${t.id}/parts`)).body as {
          items: { qty: number }[];
        }
      ).items[0].qty,
    ).toBe(3);
    const detail = (await call("GET", `/api/v1/parts/${p.id}`)).body as {
      assets: { id: string }[];
      tasks: { id: string; qty: number }[];
    };
    expect(detail.assets[0].id).toBe(asset.id);
    expect(detail.tasks[0]).toMatchObject({ id: t.id, qty: 3 });
    expect(
      (await call("DELETE", `/api/v1/assets/${asset.id}/parts/${p.id}`)).res
        .status,
    ).toBe(204);
    expect(
      (await call("DELETE", `/api/v1/tasks/${t.id}/parts/${p.id}`)).res.status,
    ).toBe(204);
    expect(
      errorCode(await call("DELETE", `/api/v1/tasks/${t.id}/parts/${p.id}`)),
    ).toBe("not_found");
    expect(
      errorCode(
        await call("PATCH", `/api/v1/tasks/${t.id}/parts/${p.id}`, {
          json: { qty: 1 },
        }),
      ),
    ).toBe("not_found");
    expect(
      errorCode(
        await call("DELETE", `/api/v1/assets/${asset.id}/parts/${p.id}`),
      ),
    ).toBe("not_found");
    expect(
      errorCode(
        await call("POST", "/api/v1/assets/nope/parts", {
          json: { partId: p.id },
        }),
      ),
    ).toBe("not_found");
    expect(
      errorCode(
        await call("POST", `/api/v1/tasks/${t.id}/parts`, {
          json: { partId: "nope" },
        }),
      ),
    ).toBe("not_found");
    expect(
      errorCode(
        await call("POST", `/api/v1/tasks/${t.id}/parts`, {
          json: { partId: p.id, qty: 0 },
        }),
      ),
    ).toBe("invalid_request");
    expect(errorCode(await call("GET", "/api/v1/tasks/nope/parts"))).toBe(
      "not_found",
    );
    expect(errorCode(await call("GET", "/api/v1/assets/nope/parts"))).toBe(
      "not_found",
    );
  });

  describe("completing tasks", () => {
    it("takes the parts out of stock and puts them back on undo", async () => {
      const { call, part, task } = await setup();
      const p = await part({ stockCount: 4 });
      const t = await task();
      await call("POST", `/api/v1/tasks/${t.id}/parts`, {
        json: { partId: p.id, qty: 2 },
      });
      const done = await call("POST", `/api/v1/tasks/${t.id}/complete`, {
        json: {},
      });
      expect(done.res.status).toBe(201);
      const stock = async () =>
        ((await call("GET", `/api/v1/parts/${p.id}`)).body as Part).stockCount;
      expect(await stock()).toBe(2);
      const { completion } = done.body as { completion: { id: string } };
      const movements = (await call("GET", `/api/v1/parts/${p.id}/movements`))
        .body as { items: { reason: string; completionId: string | null }[] };
      expect(movements.items[0]).toMatchObject({
        reason: "used",
        completionId: completion.id,
      });
      expect(
        (await call("DELETE", `/api/v1/completions/${completion.id}`)).res
          .status,
      ).toBe(204);
      expect(await stock()).toBe(4);
    });

    it("books once for a retried request", async () => {
      const { call, part, task } = await setup();
      const p = await part({ stockCount: 4 });
      const t = await task();
      await call("POST", `/api/v1/tasks/${t.id}/parts`, {
        json: { partId: p.id, qty: 1 },
      });
      const json = { idempotencyKey: "retry-once-1" };
      expect(
        (await call("POST", `/api/v1/tasks/${t.id}/complete`, { json })).res
          .status,
      ).toBe(201);
      expect(
        (await call("POST", `/api/v1/tasks/${t.id}/complete`, { json })).res
          .status,
      ).toBe(200);
      expect(
        ((await call("GET", `/api/v1/parts/${p.id}`)).body as Part).stockCount,
      ).toBe(3);
    });

    it("also works for a token-based caller", async () => {
      const { user, call, part, task } = await setup();
      const p = await part({ stockCount: 2 });
      const t = await task();
      await call("POST", `/api/v1/tasks/${t.id}/parts`, {
        json: { partId: p.id, qty: 1 },
      });
      const api = createCaller({ bearer: createTestToken(user).token });
      expect(
        (await api("POST", `/api/v1/tasks/${t.id}/complete`, { json: {} })).res
          .status,
      ).toBe(201);
      expect(
        ((await call("GET", `/api/v1/parts/${p.id}`)).body as Part).stockCount,
      ).toBe(1);
    });
  });

  describe("order now", () => {
    it("lists parts whose order-by date has come, also on the dashboard", async () => {
      const { call, part, task } = await setup();
      const p = await part({
        name: "Filterpatrone",
        leadTimeDays: 10,
        supplier: "Muster AG",
        shopUrl: "https://example.org/f",
        unitPriceMinor: 2500,
      });
      const soon = await task({ title: "Bald", trigger: oneOff(today(5)) });
      const later = await task({ title: "Später", trigger: oneOff(today(60)) });
      await call("POST", `/api/v1/tasks/${soon.id}/parts`, {
        json: { partId: p.id, qty: 2 },
      });
      await call("POST", `/api/v1/tasks/${later.id}/parts`, {
        json: { partId: p.id, qty: 2 },
      });
      const list = (await call("GET", "/api/v1/parts/order-now")).body as {
        items: Item[];
      };
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({
        id: `${soon.id}:${p.id}`,
        title: "Filterpatrone",
        date: today(-5),
        taskId: soon.id,
        taskTitle: "Bald",
        partId: p.id,
        partName: "Filterpatrone",
        quantity: 2,
        neededBy: today(5),
        orderBy: today(-5),
        late: true,
        stockCount: 0,
        supplier: "Muster AG",
        shopUrl: "https://example.org/f",
        unitPriceMinor: 2500,
        currency: "CHF",
      });
      const dashboard = (await call("GET", "/api/v1/dashboard")).body as {
        orderNow: Item[];
      };
      expect(dashboard.orderNow).toEqual(list.items);
      await call("POST", `/api/v1/parts/${p.id}/stock`, {
        json: { delta: 2, reason: "bought" },
      });
      expect(
        (
          (await call("GET", "/api/v1/parts/order-now")).body as {
            items: Item[];
          }
        ).items,
      ).toEqual([]);
      expect(
        ((await call("GET", "/api/v1/dashboard")).body as { orderNow: Item[] })
          .orderNow,
      ).toEqual([]);
    });

    it("marks an order-part preparation as in stock", async () => {
      const { call, part, task } = await setup();
      const p = await part({ stockCount: 3 });
      const t = await task({ trigger: oneOff(today(3)) });
      const prep = (
        await call("POST", `/api/v1/tasks/${t.id}/preparations`, {
          json: {
            title: "Patrone bestellen",
            kind: "order_part",
            partId: p.id,
            qty: 2,
            leadDays: 7,
          },
        })
      ).body as { id: string; state: string };
      expect(prep.state).toBe("in_stock_skip");
      const dashboard = (await call("GET", "/api/v1/dashboard")).body as {
        preparations: unknown[];
      };
      expect(dashboard.preparations).toEqual([]);
      await call("POST", `/api/v1/parts/${p.id}/stock`, {
        json: { delta: -2, reason: "used" },
      });
      const detail = (await call("GET", `/api/v1/tasks/${t.id}`)).body as {
        preparations: { state: string }[];
      };
      expect(detail.preparations[0].state).toBe("now");
      expect(
        (
          (await call("GET", "/api/v1/dashboard")).body as {
            preparations: unknown[];
          }
        ).preparations,
      ).toHaveLength(1);
      expect(
        errorCode(
          await call("POST", `/api/v1/tasks/${t.id}/preparations`, {
            json: { title: "x", kind: "order_part", partId: "nope" },
          }),
        ),
      ).toBe("invalid_request");
    });
  });

  it("is shared by all users and respects scopes", async () => {
    const { user, call, part } = await setup();
    const p = await part();
    const other = await createTestUser();
    const callOther = createCaller({ session: loginTestUser(other).token });
    expect((await callOther("GET", `/api/v1/parts/${p.id}`)).res.status).toBe(
      200,
    );
    const reader = createCaller({
      bearer: createTestToken(user, { scopes: ["read"] }).token,
    });
    expect((await reader("GET", "/api/v1/parts/order-now")).res.status).toBe(
      200,
    );
    expect(
      (
        await reader("POST", `/api/v1/parts/${p.id}/stock`, {
          json: { delta: 1, reason: "bought" },
        })
      ).res.status,
    ).toBe(403);
    expect((await call("GET", "/api/v1/parts")).res.status).toBe(200);
  });
});
