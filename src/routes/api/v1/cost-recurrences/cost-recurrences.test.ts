import { describe, expect, it } from "vitest";
import { addMonths } from "$lib/dates";
import { createCaller, errorCode } from "$lib/testing/api";
import {
  createTestToken,
  createTestUser,
  loginTestUser,
} from "$lib/testing/auth";
import { today } from "$lib/testing/dates";
import { useTestDB } from "$lib/testing/db";

interface Recurrence {
  id: string;
  bookId: string;
  bookName: string;
  title: string;
  amountMinor: number;
  currency: string;
  splitMode: string;
  shares: { userId: string; shareBps: number }[] | null;
  participantIds: string[] | null;
  tags: { name: string }[];
  frequency: string;
  interval: number;
  dayOfMonth: number;
  startDate: string;
  endDate: string | null;
  nextDate: string | null;
  lastOccurrenceDate: string | null;
  active: boolean;
  lastError: string | null;
}
interface Cost {
  id: string;
  date: string;
  title: string;
  source: string;
  recurrenceId: string | null;
  reviewNeeded: boolean;
}

describe("recurring costs API", () => {
  useTestDB();

  async function setup() {
    const anna = await createTestUser({ displayName: "Anna" });
    const ben = await createTestUser({ displayName: "Ben" });
    const call = createCaller({ session: loginTestUser(anna).token });
    const make = async (json: object = {}) => {
      const r = await call("POST", "/api/v1/cost-recurrences", {
        json: {
          title: "Miete",
          amountMinor: 150000,
          category: "other",
          frequency: "monthly",
          startDate: addMonths(today(), 1),
          splitMode: "none",
          ...json,
        },
      });
      return r;
    };
    const costs = async (q = "") =>
      ((await call("GET", `/api/v1/costs${q}`)).body as { items: Cost[] })
        .items;
    return { anna, ben, call, make, costs };
  }

  it("sets up, reads, changes, pauses and deletes a recurring cost", async () => {
    const { call, make, anna } = await setup();
    const startDate = addMonths(today(), 1);
    const created = await make({ payee: "Verwaltung", tagIds: [] });
    expect(created.res.status).toBe(201);
    const r = created.body as Recurrence;
    expect(r).toMatchObject({
      title: "Miete",
      amountMinor: 150000,
      currency: "CHF",
      bookName: "Wohnung",
      frequency: "monthly",
      interval: 1,
      dayOfMonth: Number(startDate.slice(8)),
      startDate,
      endDate: null,
      nextDate: startDate,
      lastOccurrenceDate: null,
      active: true,
      lastError: null,
      shares: null,
      participantIds: null,
    });

    expect(
      (
        (await call("GET", `/api/v1/cost-recurrences/${r.id}`))
          .body as Recurrence
      ).id,
    ).toBe(r.id);
    const list = await call("GET", "/api/v1/cost-recurrences");
    expect(
      (list.body as { items: Recurrence[] }).items.map((x) => x.id),
    ).toEqual([r.id]);

    const patched = await call("PATCH", `/api/v1/cost-recurrences/${r.id}`, {
      json: { title: "Miete 2", amountMinor: 160000, active: false },
    });
    expect(patched.body).toMatchObject({
      title: "Miete 2",
      amountMinor: 160000,
      active: false,
    });
    expect(
      (
        (await call("GET", "/api/v1/cost-recurrences?active=false")).body as {
          items: Recurrence[];
        }
      ).items,
    ).toHaveLength(1);
    expect(
      (
        (await call("GET", "/api/v1/cost-recurrences?active=true")).body as {
          items: Recurrence[];
        }
      ).items,
    ).toHaveLength(0);

    expect(
      (await call("DELETE", `/api/v1/cost-recurrences/${r.id}`)).res.status,
    ).toBe(204);
    expect(
      (await call("GET", `/api/v1/cost-recurrences/${r.id}`)).res.status,
    ).toBe(404);
    expect(
      (await call("DELETE", `/api/v1/cost-recurrences/${r.id}`)).res.status,
    ).toBe(404);
    expect(anna.id).toBeTruthy();
  });

  it("books what is already due when it is saved, and shows the entries with their source and recurrence", async () => {
    const { make, costs } = await setup();
    const start = addMonths(today(), -2);
    const created = await make({
      startDate: start,
      dayOfMonth: Number(start.slice(8)),
    });
    expect(created.res.status).toBe(201);
    const r = created.body as Recurrence;
    expect(r.lastOccurrenceDate).not.toBeNull();
    expect(r.nextDate! > today()).toBe(true);
    const entries = await costs();
    expect(entries.length).toBeGreaterThanOrEqual(2);
    for (const e of entries) {
      expect(e).toMatchObject({
        source: "recurring",
        recurrenceId: r.id,
        reviewNeeded: false,
        title: "Miete",
      });
    }
    expect(entries.map((e) => e.date)).toContain(start);
  });

  it("answers null when nothing is due, and for a paused one", async () => {
    const { call, make, costs } = await setup();
    const ahead = (await make()).body as Recurrence;
    const early = await call(
      "POST",
      `/api/v1/cost-recurrences/${ahead.id}/run-now`,
    );
    expect(early.res.status).toBe(200);
    expect(early.body).toMatchObject({
      entry: null,
      recurrence: { id: ahead.id, nextDate: ahead.nextDate },
    });
    const paused = (
      await make({
        title: "Pause",
        startDate: addMonths(today(), -2),
        active: false,
      })
    ).body as Recurrence;
    const none = await call(
      "POST",
      `/api/v1/cost-recurrences/${paused.id}/run-now`,
    );
    expect((none.body as { entry: unknown }).entry).toBeNull();
    expect(await costs()).toEqual([]);
  });

  it("records why a booking failed, and books one occurrence per call of run-now once the book takes entries again", async () => {
    const { call, make, costs } = await setup();
    const book = (
      await call("POST", "/api/v1/cost-books", { json: { name: "Ferien" } })
    ).body as { id: string };
    const r = (await make({ bookId: book.id })).body as Recurrence;
    await call("PATCH", `/api/v1/cost-books/${book.id}`, {
      json: { archived: true },
    });
    // Moving the start into the past makes occurrences due; the book is closed, so none can be booked.
    const start = addMonths(today(), -2);
    const stuck = await call("PATCH", `/api/v1/cost-recurrences/${r.id}`, {
      json: { startDate: start, dayOfMonth: Number(start.slice(8)) },
    });
    expect(stuck.res.status).toBe(200);
    expect(stuck.body).toMatchObject({
      lastError: "book_archived",
      nextDate: start,
      lastOccurrenceDate: null,
    });
    expect(await costs()).toEqual([]);
    const refused = await call(
      "POST",
      `/api/v1/cost-recurrences/${r.id}/run-now`,
    );
    expect(refused.res.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain("bookId");

    await call("PATCH", `/api/v1/cost-books/${book.id}`, {
      json: { archived: false },
    });
    const first = await call(
      "POST",
      `/api/v1/cost-recurrences/${r.id}/run-now`,
    );
    expect(first.res.status).toBe(200);
    expect(first.body).toMatchObject({
      entry: { date: start, source: "recurring", recurrenceId: r.id },
      recurrence: { lastOccurrenceDate: start, lastError: null },
    });
    expect(await costs()).toHaveLength(1);
    const second = await call(
      "POST",
      `/api/v1/cost-recurrences/${r.id}/run-now`,
    );
    expect((second.body as { entry: Cost }).entry.date).toBe(
      addMonths(start, 1),
    );
    expect(await costs()).toHaveLength(2);
  });

  it("keeps a book that has a recurring cost from being deleted", async () => {
    const { call, make } = await setup();
    const book = (
      await call("POST", "/api/v1/cost-books", { json: { name: "Ferien" } })
    ).body as { id: string };
    await make({ bookId: book.id });
    const del = await call("DELETE", `/api/v1/cost-books/${book.id}`);
    expect(del.res.status).toBe(409);
    expect(errorCode(del)).toBe("conflict");
    expect(JSON.stringify(del.body)).toContain("recurrenceCount");
  });

  it("refuses bad input", async () => {
    const { call, make } = await setup();
    for (const json of [
      { title: "" },
      { frequency: "weekly" },
      { interval: 0 },
      { interval: 13 },
      { dayOfMonth: 32 },
      { startDate: "2026-02-30" },
      { startDate: addMonths(today(), 1), endDate: addMonths(today(), -1) },
      { amountMinor: 0 },
      { bookId: "nope" },
      { tagIds: ["nope"] },
      { paidByUserId: "nope" },
      { splitMode: "custom" },
      { extra: true },
    ]) {
      const r = await make(json);
      expect(r.res.status, JSON.stringify(json)).toBe(400);
    }
    const ok = (await make()).body as Recurrence;
    for (const json of [
      {},
      { endDate: addMonths(today(), -5) },
      { interval: 99 },
      { splitMode: "custom" },
    ]) {
      const r = await call("PATCH", `/api/v1/cost-recurrences/${ok.id}`, {
        json,
      });
      expect(r.res.status, JSON.stringify(json)).toBe(400);
    }
    expect(
      (await call("GET", "/api/v1/cost-recurrences/nope")).res.status,
    ).toBe(404);
    expect(
      (await call("POST", "/api/v1/cost-recurrences/nope/run-now")).res.status,
    ).toBe(404);
  });

  it("is shared by the household, and needs costs:write to change", async () => {
    const { ben, anna, call, make } = await setup();
    const r = (await make()).body as Recurrence;
    const asBen = createCaller({ session: loginTestUser(ben).token });
    expect(
      (
        (await asBen("GET", `/api/v1/cost-recurrences/${r.id}`))
          .body as Recurrence
      ).id,
    ).toBe(r.id);
    const readOnly = createCaller({
      bearer: createTestToken(anna, { scopes: ["read"] }).token,
    });
    expect((await readOnly("GET", "/api/v1/cost-recurrences")).res.status).toBe(
      200,
    );
    expect(
      (await readOnly("DELETE", `/api/v1/cost-recurrences/${r.id}`)).res.status,
    ).toBe(403);
    expect(
      (await readOnly("POST", `/api/v1/cost-recurrences/${r.id}/run-now`)).res
        .status,
    ).toBe(403);
    expect(call).toBeTruthy();
  });
});
