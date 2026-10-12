import { describe, expect, it } from "vitest";
import { saveConnection } from "$lib/server/connections/connections";
import { getDB } from "$lib/server/db";
import { recordSuggestion } from "$lib/server/finance/suggestions";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { today } from "$lib/testing/dates";
import { useTestDB } from "$lib/testing/db";
import { addDays } from "$lib/dates";

type Suggestion = {
  id: string;
  kind: string;
  status: string;
  acceptedEntityId: string | null;
  payload: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};
type Page = { items: Suggestion[]; nextCursor: string | null };
type Cost = {
  id: string;
  title: string;
  source: string;
  financeLinked: boolean;
  providerUrl: string | null;
};

describe("tying entries made by hand to transactions, through the API", () => {
  useTestDB();
  const ctx = () => ({ db: getDB(), now: Date.now() });
  const DAY = today(-1);

  async function member(name: string) {
    const user = await createTestUser({ displayName: name });
    const connection = saveConnection(ctx(), "kept", user.id, {
      baseUrl: `https://${name.toLowerCase()}-finance.example.org`,
      token: "kept_example-token",
      allowInsecureTls: false,
    });
    const call = createCaller({ session: loginTestUser(user).token });
    const offer = (providerRef: string, over: Record<string, unknown> = {}) =>
      recordSuggestion(ctx(), {
        connectionId: connection.id,
        userId: user.id,
        kind: "cost",
        providerRef,
        payload: {
          source: "finance_transaction",
          date: DAY,
          amountMinor: 4250,
          currency: "CHF",
          title: "BEISPIEL MARKT ZUERICH",
          payee: "Beispiel Markt",
          category: "groceries",
          url: `https://${name.toLowerCase()}-finance.example.org/tx/${providerRef}`,
          assetId: null,
          ...over,
        },
      }).row;
    const entry = async (json: Record<string, unknown> = {}) =>
      (
        await call("POST", "/api/v1/costs", {
          json: {
            title: "Einkauf Beispiel Markt",
            amountMinor: 4250,
            category: "groceries",
            date: DAY,
            paidByUserId: user.id,
            splitMode: "none",
            ...json,
          },
        })
      ).body as Cost;
    const suggestions = async (q = "") =>
      ((await call("GET", `/api/v1/finance/suggestions${q}`)).body as Page)
        .items;
    return { user, connection, call, offer, entry, suggestions };
  }

  it("lists a link with the entry as it is now, and counts it as waiting", async () => {
    const anna = await member("Anna");
    const e = await anna.entry();
    anna.offer("tx:1");
    const [link] = await anna.suggestions();
    expect(link).toMatchObject({
      kind: "link",
      status: "pending",
      acceptedEntityId: null,
      payload: {
        entryId: e.id,
        entry: {
          id: e.id,
          title: "Einkauf Beispiel Markt",
          date: DAY,
          amountMinor: 4250,
          currency: "CHF",
          payee: null,
          bookName: "Wohnung",
        },
        transaction: {
          title: "BEISPIEL MARKT ZUERICH",
          amountMinor: 4250,
          bookId: null,
          url: "https://anna-finance.example.org/tx/tx:1",
        },
      },
    });
    expect((await anna.suggestions("?kind=link")).map((s) => s.id)).toEqual([
      link.id,
    ]);
    expect(await anna.suggestions("?kind=cost")).toEqual([]);
    const dashboard = (await anna.call("GET", "/api/v1/dashboard")).body as {
      pendingFinanceSuggestions: number;
    };
    expect(dashboard.pendingFinanceSuggestions).toBe(1);
  });

  it("shows the entry as it changes, and no entry once it is deleted", async () => {
    const anna = await member("Anna");
    const e = await anna.entry();
    anna.offer("tx:1");
    await anna.call("PATCH", `/api/v1/costs/${e.id}`, {
      json: { title: "Beispiel Markt Wocheneinkauf" },
    });
    expect((await anna.suggestions())[0].payload.entry.title).toBe(
      "Beispiel Markt Wocheneinkauf",
    );
    await anna.call("DELETE", `/api/v1/costs/${e.id}`);
    // Deleting the entry gives the transaction back as a cost suggestion.
    const after = await anna.suggestions();
    expect(after.map((s) => [s.kind, s.status])).toEqual([["cost", "pending"]]);
    expect(
      (await anna.suggestions("?kind=link&status=dismissed")).map(
        (s) => s.payload.entry,
      ),
    ).toEqual([null]);
  });

  it("ties the entry on accepting, books nothing and tells the entry apart", async () => {
    const anna = await member("Anna");
    const e = await anna.entry();
    expect(e.financeLinked).toBe(false);
    const link = anna.offer("tx:1");
    const accepted = await anna.call(
      "POST",
      `/api/v1/finance/suggestions/${link.id}/accept`,
      { json: {} },
    );
    expect(accepted.res.status).toBe(200);
    expect(accepted.body).toMatchObject({
      suggestion: {
        kind: "link",
        status: "accepted",
        acceptedEntityId: e.id,
      },
      entity: { type: "cost", id: e.id },
    });
    const after = (await anna.call("GET", `/api/v1/costs/${e.id}`))
      .body as Cost;
    expect(after).toMatchObject({
      financeLinked: true,
      source: "manual",
      providerUrl: "https://anna-finance.example.org/tx/tx:1",
    });
    const list = (await anna.call("GET", "/api/v1/costs")).body as {
      items: Cost[];
    };
    expect(list.items).toHaveLength(1);
    const again = await anna.call(
      "POST",
      `/api/v1/finance/suggestions/${link.id}/accept`,
      { json: {} },
    );
    expect(again.res.status).toBe(409);
  });

  it("takes no override when accepting a link, and answers 409 for an entry that was deleted", async () => {
    const anna = await member("Anna");
    const e = await anna.entry();
    const link = anna.offer("tx:1");
    const withTitle = await anna.call(
      "POST",
      `/api/v1/finance/suggestions/${link.id}/accept`,
      { json: { title: "Anders" } },
    );
    expect(withTitle.res.status).toBe(400);
    // The entry is deleted straight in the database, as a cascade would: no event reaches the link.
    getDB().$client.query("delete from cost_entries where id = ?").run(e.id);
    const gone = await anna.call(
      "POST",
      `/api/v1/finance/suggestions/${link.id}/accept`,
      { json: {} },
    );
    expect(gone.res.status).toBe(409);
    expect(errorCode(gone)).toBe("conflict");
    const [shown] = await anna.suggestions();
    expect(shown.payload.entry).toBeNull();
    const dismissed = await anna.call(
      "POST",
      `/api/v1/finance/suggestions/${link.id}/dismiss`,
    );
    expect(dismissed.res.status).toBe(200);
    expect((await anna.suggestions()).map((s) => s.kind)).toEqual(["cost"]);
  });

  it("offers the transaction as a cost when the link is dismissed", async () => {
    const anna = await member("Anna");
    const e = await anna.entry();
    const link = anna.offer("tx:1");
    const dismissed = await anna.call(
      "POST",
      `/api/v1/finance/suggestions/${link.id}/dismiss`,
    );
    expect(dismissed.body).toMatchObject({ kind: "link", status: "dismissed" });
    const [cost] = await anna.suggestions();
    expect(cost).toMatchObject({
      kind: "cost",
      status: "pending",
      payload: { title: "BEISPIEL MARKT ZUERICH", amountMinor: 4250 },
    });
    const accepted = await anna.call(
      "POST",
      `/api/v1/finance/suggestions/${cost.id}/accept`,
      { json: {} },
    );
    expect(accepted.res.status).toBe(200);
    expect((accepted.body as { entity: { id: string } }).entity.id).not.toBe(
      e.id,
    );
    expect(
      ((await anna.call("GET", "/api/v1/costs")).body as { items: Cost[] })
        .items,
    ).toHaveLength(2);
  });

  it("keeps a link private to its owner", async () => {
    const anna = await member("Anna");
    const ben = await member("Ben");
    await anna.entry();
    const link = anna.offer("tx:1");
    expect(await ben.suggestions()).toEqual([]);
    expect((await ben.suggestions("?kind=link&status=dismissed")).length).toBe(
      0,
    );
    for (const action of ["accept", "dismiss"]) {
      const r = await ben.call(
        "POST",
        `/api/v1/finance/suggestions/${link.id}/${action}`,
        action === "accept" ? { json: {} } : {},
      );
      expect(r.res.status, action).toBe(404);
    }
    expect((await anna.suggestions())[0].status).toBe("pending");
  });

  it("does not show the finance address of a tied entry to anybody but its maker", async () => {
    const anna = await member("Anna");
    const ben = await member("Ben");
    const e = await anna.entry();
    await anna.call(
      "POST",
      `/api/v1/finance/suggestions/${anna.offer("tx:1").id}/accept`,
      { json: {} },
    );
    const seen = (await ben.call("GET", `/api/v1/costs/${e.id}`)).body as Cost;
    expect(seen).toMatchObject({ financeLinked: true, providerUrl: null });
    expect(JSON.stringify(seen)).not.toContain("anna-finance");
  });

  describe("the entry form", () => {
    const matches = (
      call: ReturnType<typeof createCaller>,
      q: Record<string, string>,
    ) => call("GET", `/api/v1/finance/matches?${new URLSearchParams(q)}`);

    it("offers the person's own pending cost suggestions with that amount within three days", async () => {
      const anna = await member("Anna");
      const ben = await member("Ben");
      anna.offer("tx:near", { date: addDays(DAY, 2) });
      anna.offer("tx:same");
      anna.offer("tx:out", { date: addDays(DAY, 4) });
      anna.offer("tx:amount", { amountMinor: 4251 });
      ben.offer("tx:theirs");
      const r = await matches(anna.call, {
        amountMinor: "4250",
        date: DAY,
      });
      expect(r.res.status).toBe(200);
      const items = (r.body as { items: Suggestion[] }).items;
      expect(items.map((s) => s.payload.url)).toEqual([
        "https://anna-finance.example.org/tx/tx:same",
        "https://anna-finance.example.org/tx/tx:near",
      ]);
      expect(
        items.every((s) => s.kind === "cost" && s.status === "pending"),
      ).toBe(true);
      expect(
        JSON.stringify(
          (await matches(ben.call, { amountMinor: "4250", date: DAY })).body,
        ),
      ).not.toContain("anna-finance");
    });

    it("takes the currency, defaulting to the household's", async () => {
      const anna = await member("Anna");
      anna.offer("tx:eur", { currency: "EUR" });
      const chf = (await matches(anna.call, { amountMinor: "4250", date: DAY }))
        .body as { items: unknown[] };
      expect(chf.items).toEqual([]);
      const eur = (
        await matches(anna.call, {
          amountMinor: "4250",
          currency: "EUR",
          date: DAY,
        })
      ).body as { items: unknown[] };
      expect(eur.items).toHaveLength(1);
    });

    it("reads negative amounts as refunds", async () => {
      const anna = await member("Anna");
      anna.offer("tx:refund", { amountMinor: -1500 });
      const r = (await matches(anna.call, { amountMinor: "-1500", date: DAY }))
        .body as { items: unknown[] };
      expect(r.items).toHaveLength(1);
    });

    it("refuses what is not an amount, a date or a currency", async () => {
      const anna = await member("Anna");
      const bad: Record<string, string>[] = [
        {},
        { date: DAY },
        { amountMinor: "4250" },
        { amountMinor: "0", date: DAY },
        { amountMinor: "12.5", date: DAY },
        { amountMinor: "x", date: DAY },
        { amountMinor: "4250", date: "yesterday" },
        { amountMinor: "4250", date: DAY, currency: "chf" },
      ];
      for (const q of bad) {
        const r = await matches(anna.call, q);
        expect(r.res.status, JSON.stringify(q)).toBe(400);
      }
    });

    it("ties a new entry to a suggestion in one step", async () => {
      const anna = await member("Anna");
      const suggestion = anna.offer("tx:1");
      const created = await anna.call("POST", "/api/v1/costs", {
        json: {
          title: "Wocheneinkauf",
          amountMinor: 4250,
          category: "groceries",
          date: DAY,
          splitMode: "none",
          financeSuggestionId: suggestion.id,
          idempotencyKey: "key-link-0001",
        },
      });
      expect(created.res.status).toBe(201);
      const cost = created.body as Cost;
      expect(cost).toMatchObject({
        financeLinked: true,
        source: "manual",
        providerUrl: "https://anna-finance.example.org/tx/tx:1",
      });
      const [done] = await anna.suggestions("?status=accepted");
      expect(done).toMatchObject({ kind: "cost", acceptedEntityId: cost.id });
      expect(
        (await matches(anna.call, { amountMinor: "4250", date: DAY })).body,
      ).toEqual({ items: [] });
      // A retry of the same request answers with the first entry.
      const retry = await anna.call("POST", "/api/v1/costs", {
        json: {
          title: "Wocheneinkauf",
          amountMinor: 4250,
          category: "groceries",
          date: DAY,
          splitMode: "none",
          financeSuggestionId: suggestion.id,
          idempotencyKey: "key-link-0001",
        },
      });
      expect(retry.res.status).toBe(200);
      expect((retry.body as Cost).id).toBe(cost.id);
      // Without a key it is a conflict.
      const again = await anna.call("POST", "/api/v1/costs", {
        json: {
          title: "Wocheneinkauf",
          amountMinor: 4250,
          category: "groceries",
          financeSuggestionId: suggestion.id,
          splitMode: "none",
        },
      });
      expect(again.res.status).toBe(409);
    });

    it("refuses a suggestion that is not yours, not a cost, or another amount", async () => {
      const anna = await member("Anna");
      const ben = await member("Ben");
      const theirs = ben.offer("tx:1");
      const mine = anna.offer("tx:2");
      const body = (id: string, over: Record<string, unknown> = {}) => ({
        json: {
          title: "x",
          amountMinor: 4250,
          category: "groceries",
          splitMode: "none",
          financeSuggestionId: id,
          ...over,
        },
      });
      expect(
        (await anna.call("POST", "/api/v1/costs", body(theirs.id))).res.status,
      ).toBe(404);
      expect(
        (await anna.call("POST", "/api/v1/costs", body("nope"))).res.status,
      ).toBe(404);
      const other = await anna.call(
        "POST",
        "/api/v1/costs",
        body(mine.id, { amountMinor: 4251 }),
      );
      expect(other.res.status).toBe(400);
      expect(JSON.stringify(other.body)).toContain("financeSuggestionId");
      expect((await anna.suggestions())[0].status).toBe("pending");
      expect((await ben.suggestions())[0].status).toBe("pending");
    });

    it("ties an existing entry with a change, and a repeated request changes nothing", async () => {
      const anna = await member("Anna");
      const e = await anna.entry({ title: "Etwas anderes", amountMinor: 4000 });
      const suggestion = anna.offer("tx:1");
      const patch = (json: Record<string, unknown>) =>
        anna.call("PATCH", `/api/v1/costs/${e.id}`, { json });
      expect(
        (await patch({ financeSuggestionId: suggestion.id })).res.status,
      ).toBe(400);
      const tied = await patch({
        financeSuggestionId: suggestion.id,
        amountMinor: 4250,
      });
      expect(tied.res.status).toBe(200);
      expect(tied.body).toMatchObject({ financeLinked: true });
      const repeat = await patch({ financeSuggestionId: suggestion.id });
      expect(repeat.res.status).toBe(200);
      const other = anna.offer("tx:2", { title: "Anderes" });
      const conflict = await patch({ financeSuggestionId: other.id });
      expect(conflict.res.status).toBe(409);
    });

    it("needs costs:write to tie and read to look", async () => {
      const anna = await member("Anna");
      anna.offer("tx:1");
      const readOnly = createCaller({
        bearer: createTestToken(anna.user, { scopes: ["read"] }).token,
      });
      expect(
        (await matches(readOnly, { amountMinor: "4250", date: DAY })).res
          .status,
      ).toBe(200);
      const [suggestion] = await anna.suggestions();
      const denied = await readOnly("POST", "/api/v1/costs", {
        json: {
          title: "x",
          amountMinor: 4250,
          category: "other",
          financeSuggestionId: suggestion.id,
        },
      });
      expect(denied.res.status).toBe(403);
    });
  });
});
