import { describe, expect, it, vi } from "vitest";
import { saveConnection } from "$lib/server/connections/connections";
import { getDB } from "$lib/server/db";
import { upsertFinanceBillTask } from "$lib/server/finance/bill-tasks";
import { registerFinanceProvider } from "$lib/server/finance/providers";
import { recordSuggestion } from "$lib/server/finance/suggestions";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { useTestDB } from "$lib/testing/db";

type Suggestion = {
  id: string;
  kind: string;
  status: string;
  acceptedEntityId: string | null;
  payload: Record<string, unknown>;
};
type Page = { items: Suggestion[]; nextCursor: string | null };

describe("finance suggestions API", () => {
  useTestDB();
  const ctx = () => ({ db: getDB(), now: Date.now() });

  async function member(name: string) {
    const user = await createTestUser({ displayName: name });
    const connection = saveConnection(ctx(), "kept", user.id, {
      baseUrl: `https://${name.toLowerCase()}-finance.example.org`,
      token: "kept_example-token",
      allowInsecureTls: false,
    });
    return {
      user,
      connection,
      call: createCaller({ session: loginTestUser(user).token }),
      offer: (providerRef: string, title = "Reparatur") =>
        recordSuggestion(ctx(), {
          connectionId: connection.id,
          userId: user.id,
          kind: "cost",
          providerRef,
          payload: {
            source: "finance_transaction",
            date: "2026-03-10",
            amountMinor: 12050,
            currency: "CHF",
            title,
            payee: "Beispiel AG",
            category: "repair",
            url: `https://${name.toLowerCase()}-finance.example.org/tx/${providerRef}`,
            assetId: null,
          },
        }).row,
    };
  }

  it("lists a person's own suggestions with their payload", async () => {
    const anna = await member("Anna");
    anna.offer("tx:1");
    const list = (await anna.call("GET", "/api/v1/finance/suggestions"))
      .body as Page;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      kind: "cost",
      status: "pending",
      acceptedEntityId: null,
      payload: { title: "Reparatur", amountMinor: 12050, category: "repair" },
    });
  });

  it("never shows a suggestion to another household member", async () => {
    const anna = await member("Anna");
    const ben = await member("Ben");
    const secret = anna.offer("tx:1", "Annas private Ausgabe");
    ben.offer("tx:2", "Bens Ausgabe");
    const bens = await ben.call("GET", "/api/v1/finance/suggestions");
    expect((bens.body as Page).items.map((s) => s.payload.title)).toEqual([
      "Bens Ausgabe",
    ]);
    expect(JSON.stringify(bens.body)).not.toContain("Annas");
    expect(JSON.stringify(bens.body)).not.toContain("anna-finance");
    for (const status of ["pending", "accepted", "dismissed"]) {
      const r = await ben.call(
        "GET",
        `/api/v1/finance/suggestions?status=${status}&kind=cost`,
      );
      expect(JSON.stringify(r.body)).not.toContain(secret.id);
    }
    // reaching for it by id is a 404, exactly like an id that does not exist
    const accept = await ben.call(
      "POST",
      `/api/v1/finance/suggestions/${secret.id}/accept`,
      { json: {} },
    );
    const missing = await ben.call(
      "POST",
      "/api/v1/finance/suggestions/does-not-exist/accept",
      { json: {} },
    );
    expect(accept.res.status).toBe(404);
    expect(accept.body).toEqual(missing.body);
    const dismiss = await ben.call(
      "POST",
      `/api/v1/finance/suggestions/${secret.id}/dismiss`,
    );
    expect(dismiss.res.status).toBe(404);
    // and nothing happened to it, or to the shared costs
    const stillThere = (await anna.call("GET", "/api/v1/finance/suggestions"))
      .body as Page;
    expect(stillThere.items.map((s) => s.status)).toEqual(["pending"]);
    expect(
      ((await ben.call("GET", "/api/v1/costs")).body as Page).items,
    ).toHaveLength(0);
  });

  it("accepts with overrides and books the cost for the household", async () => {
    const anna = await member("Anna");
    const ben = await member("Ben");
    const row = anna.offer("tx:1");
    const accepted = await anna.call(
      "POST",
      `/api/v1/finance/suggestions/${row.id}/accept`,
      {
        json: {
          title: "Pumpe ersetzt",
          category: "maintenance",
          splitMode: "equal",
          deductible: "maintenance",
        },
      },
    );
    expect(accepted.res.status).toBe(200);
    const body = accepted.body as {
      suggestion: Suggestion;
      entity: { type: string; id: string };
    };
    expect(body.entity.type).toBe("cost");
    expect(body.suggestion).toMatchObject({
      status: "accepted",
      acceptedEntityId: body.entity.id,
    });
    const cost = (await ben.call("GET", `/api/v1/costs/${body.entity.id}`))
      .body as Record<string, unknown>;
    expect(cost).toMatchObject({
      title: "Pumpe ersetzt",
      category: "maintenance",
      amountMinor: 12050,
      paidByUserId: anna.user.id,
      paidByName: "Anna",
      splitMode: "equal",
      source: "finance_transaction",
      // Anna's finance address stays hers
      providerUrl: null,
    });
    const again = await anna.call(
      "POST",
      `/api/v1/finance/suggestions/${row.id}/accept`,
      { json: {} },
    );
    expect(again.res.status).toBe(409);
    expect(errorCode(again)).toBe("conflict");
    expect(
      ((await anna.call("GET", "/api/v1/finance/suggestions")).body as Page)
        .items,
    ).toHaveLength(0);
    const done = (
      await anna.call("GET", "/api/v1/finance/suggestions?status=accepted")
    ).body as Page;
    expect(done.items).toHaveLength(1);
  });

  it("dismisses, and a dismissed suggestion cannot be accepted", async () => {
    const anna = await member("Anna");
    const row = anna.offer("tx:1");
    const d = await anna.call(
      "POST",
      `/api/v1/finance/suggestions/${row.id}/dismiss`,
    );
    expect(d.res.status).toBe(200);
    expect(d.body).toMatchObject({ status: "dismissed" });
    expect(
      ((await anna.call("GET", "/api/v1/finance/suggestions")).body as Page)
        .items,
    ).toHaveLength(0);
    const accept = await anna.call(
      "POST",
      `/api/v1/finance/suggestions/${row.id}/accept`,
      { json: {} },
    );
    expect(accept.res.status).toBe(409);
  });

  it("rejects bad input", async () => {
    const anna = await member("Anna");
    const row = anna.offer("tx:1");
    const post = (json: object) =>
      anna.call("POST", `/api/v1/finance/suggestions/${row.id}/accept`, {
        json,
      });
    expect((await post({ category: "luxury" })).res.status).toBe(400);
    expect((await post({ unknown: 1 })).res.status).toBe(400);
    expect((await post({ name: "an asset field" })).res.status).toBe(400);
    expect((await post({ splitMode: "custom" })).res.status).toBe(400);
    expect((await post({ assetId: "missing" })).res.status).toBe(400);
    expect(
      (await anna.call("GET", "/api/v1/finance/suggestions?status=bogus")).res
        .status,
    ).toBe(400);
    expect(
      (await anna.call("GET", "/api/v1/finance/suggestions?kind=bogus")).res
        .status,
    ).toBe(400);
    expect(
      (await anna.call("GET", "/api/v1/finance/suggestions?cursor=zzz")).res
        .status,
    ).toBe(400);
  });

  it("needs read to list and costs:write to decide", async () => {
    const anna = await member("Anna");
    const row = anna.offer("tx:1");
    const caller = (scopes: ("read" | "write" | "costs:write")[]) =>
      createCaller({ bearer: createTestToken(anna.user, { scopes }).token });
    const reader = caller(["read"]);
    const writer = caller(["read", "write"]);
    const bookkeeper = caller(["read", "costs:write"]);
    expect(
      (await reader("GET", "/api/v1/finance/suggestions")).res.status,
    ).toBe(200);
    for (const who of [reader, writer]) {
      expect(
        (
          await who("POST", `/api/v1/finance/suggestions/${row.id}/accept`, {
            json: {},
          })
        ).res.status,
      ).toBe(403);
      expect(
        (await who("POST", `/api/v1/finance/suggestions/${row.id}/dismiss`)).res
          .status,
      ).toBe(403);
      expect((await who("POST", "/api/v1/finance/sync")).res.status).toBe(403);
    }
    expect(
      (
        await bookkeeper(
          "POST",
          `/api/v1/finance/suggestions/${row.id}/accept`,
          { json: {} },
        )
      ).res.status,
    ).toBe(200);
  });

  describe("sync", () => {
    it("is a 404 without a connection of your own, and never touches somebody else's", async () => {
      const anna = await member("Anna");
      const nobody = await createTestUser({ displayName: "Ben" });
      const ben = createCaller({ session: loginTestUser(nobody).token });
      const sync = vi.fn(async () => ({ ok: true, stats: { suggestions: 1 } }));
      const off = registerFinanceProvider({ kind: "kept", sync });
      try {
        expect((await ben("POST", "/api/v1/finance/sync")).res.status).toBe(
          404,
        );
        expect(sync).not.toHaveBeenCalled();
        const mine = await anna.call("POST", "/api/v1/finance/sync");
        expect(mine.res.status).toBe(200);
        expect(mine.body).toEqual({
          ok: true,
          error: null,
          stats: { suggestions: 1 },
        });
        expect(sync).toHaveBeenCalledTimes(1);
        const row = (sync.mock.calls[0] as unknown[])[1] as { userId: string };
        expect(row.userId).toBe(anna.user.id);
      } finally {
        off();
      }
    });

    it("is a 404 when no provider runs or the connection is switched off", async () => {
      const anna = await member("Anna");
      expect((await anna.call("POST", "/api/v1/finance/sync")).res.status).toBe(
        404,
      );
      const sync = vi.fn(async () => ({ ok: true, stats: {} }));
      const off = registerFinanceProvider({ kind: "kept", sync });
      try {
        saveConnection(ctx(), "kept", anna.user.id, {
          baseUrl: anna.connection.baseUrl,
          allowInsecureTls: false,
          enabled: false,
          token: "kept_example-token",
        });
        expect(
          (await anna.call("POST", "/api/v1/finance/sync")).res.status,
        ).toBe(404);
        expect(sync).not.toHaveBeenCalled();
      } finally {
        off();
      }
    });

    it("reports a failed run as a normal answer", async () => {
      const anna = await member("Anna");
      const off = registerFinanceProvider({
        kind: "kept",
        sync: async () => ({
          ok: false,
          error: { code: "unauthorized", message: "The token was rejected." },
          stats: {},
        }),
      });
      try {
        const r = await anna.call("POST", "/api/v1/finance/sync");
        expect(r.res.status).toBe(200);
        expect(r.body).toMatchObject({
          ok: false,
          error: { code: "unauthorized" },
        });
      } finally {
        off();
      }
    });
  });
  it("counts a person's own pending suggestions on the dashboard", async () => {
    const anna = await member("Anna");
    const ben = await member("Ben");
    const first = anna.offer("tx:1");
    anna.offer("tx:2");
    ben.offer("tx:3");
    const count = async (who: typeof anna) =>
      (
        (await who.call("GET", "/api/v1/dashboard")).body as {
          pendingFinanceSuggestions: number;
        }
      ).pendingFinanceSuggestions;
    expect(await count(anna)).toBe(2);
    expect(await count(ben)).toBe(1);
    await anna.call("POST", `/api/v1/finance/suggestions/${first.id}/dismiss`);
    expect(await count(anna)).toBe(1);
    const nobody = createCaller({
      session: loginTestUser(await createTestUser({ displayName: "Cleo" }))
        .token,
    });
    expect(
      (
        (await nobody("GET", "/api/v1/dashboard")).body as {
          pendingFinanceSuggestions: number;
        }
      ).pendingFinanceSuggestions,
    ).toBe(0);
  });

  describe("bill tasks", () => {
    const BILL_URL = "https://anna-finance.example.org/bills/b1";

    async function withBillTask() {
      const anna = await member("Anna");
      const ben = await member("Ben");
      const { taskId } = await upsertFinanceBillTask(ctx(), {
        connectionId: anna.connection.id,
        kind: "kept",
        ownerId: anna.user.id,
        billId: "b1",
        title: "Muster Verwaltung AG: INV-7",
        dueDate: "2026-07-01",
        status: "open",
        amountMinor: 45000,
        currency: "CHF",
        url: BILL_URL,
      });
      return { anna, ben, taskId: taskId! };
    }

    type TaskBody = { externalUrl: string | null; title: string };

    it("shows the address in the finance app to the person it belongs to only", async () => {
      const { anna, ben, taskId } = await withBillTask();
      for (const who of [anna, ben]) {
        const detail = (await who.call("GET", `/api/v1/tasks/${taskId}`))
          .body as TaskBody;
        const listed = (
          (await who.call("GET", "/api/v1/tasks")).body as {
            items: TaskBody[];
          }
        ).items.find((t) => t.title.startsWith("Muster"));
        const expected = who === anna ? BILL_URL : null;
        expect(detail.externalUrl).toBe(expected);
        expect(listed?.externalUrl).toBe(expected);
        // the household still sees what it consented to
        expect(detail.title).toBe("Muster Verwaltung AG: INV-7");
      }
    });

    it("leaves the address of other tasks alone", async () => {
      const { ben } = await withBillTask();
      const created = await ben.call("POST", "/api/v1/tasks", {
        json: {
          title: "Offerte prüfen",
          trigger: { v: 1, type: "one_off", date: "2026-09-01" },
          externalUrl: "https://example.org/offer",
        },
      });
      expect((created.body as TaskBody).externalUrl).toBe(
        "https://example.org/offer",
      );
    });
  });
});
