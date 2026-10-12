import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createCostBookRequestSchema } from "$lib/api/schemas/cost-books";
import {
  MAX_COST_RECURRENCES,
  createCostRecurrenceRequestSchema,
  updateCostRecurrenceRequestSchema,
} from "$lib/api/schemas/cost-recurrences";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { costEntries, costRecurrences, users } from "$lib/server/db";
import { createAsset } from "$lib/server/assets/assets";
import { createTestUser } from "$lib/testing/auth";
import { at, ctxAt } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import {
  createCostBook,
  deleteCostBook,
  listCostBooks,
  updateCostBook,
} from "./books";
import { deleteCost, listCosts } from "./costs";
import {
  MAX_OCCURRENCES_PER_RUN,
  bookDueRecurrences,
  createCostRecurrence,
  deleteCostRecurrence,
  getCostRecurrence,
  listCostRecurrences,
  runCostRecurrenceNow,
  updateCostRecurrence,
} from "./recurrences";
import { createCostTag, deleteCostTag } from "./tags";

describe("recurring costs", () => {
  const test = useTestDB();
  /** `today` is a calendar date in the household zone; the instant is noon there. */
  const on = (today: string) => ctxAt(test.db, at(today));
  const ctx = () => on("2026-01-01");
  const book = (name: string) =>
    listCostBooks(ctx(), { includeArchived: true }, { limit: 50 }).items.find(
      (b) => b.name === name,
    )!;

  const make = (over: Record<string, unknown> = {}, by: string | null = null) =>
    createCostRecurrence(
      ctx(),
      createCostRecurrenceRequestSchema.parse({
        title: "Miete",
        amountMinor: 150000,
        category: "other",
        frequency: "monthly",
        startDate: "2026-01-01",
        splitMode: "none",
        ...over,
      }),
      by,
    );
  const update = (
    id: string,
    patch: Record<string, unknown>,
    today = "2026-01-01",
  ) =>
    updateCostRecurrence(
      on(today),
      id,
      updateCostRecurrenceRequestSchema.parse(patch),
    );
  const run = (today: string, id?: string) =>
    bookDueRecurrences(on(today), { id });
  const entries = () =>
    listCosts(ctx(), {}, { limit: 200 }, "me")
      .items.slice()
      .sort((a, b) => a.date.localeCompare(b.date));
  const dates = () => entries().map((e) => e.date);
  /** Who bears how much of an entry, by name (the order of the shares follows the people's ids). */
  const bps = (e: {
    shares: { userName: string | null; shareBps: number }[];
  }) => Object.fromEntries(e.shares.map((x) => [x.userName, x.shareBps]));

  describe("creating", () => {
    it("starts at the first occurrence and fills in the day, the interval, the household currency and the default book", async () => {
      const anna = await createTestUser({ displayName: "Anna" });
      const r = make({ startDate: "2026-03-15", currency: undefined }, anna.id);
      expect(r).toMatchObject({
        title: "Miete",
        amountMinor: 150000,
        currency: "CHF",
        bookName: "Wohnung",
        frequency: "monthly",
        interval: 1,
        dayOfMonth: 15,
        startDate: "2026-03-15",
        endDate: null,
        nextDate: "2026-03-15",
        lastOccurrenceDate: null,
        active: true,
        lastError: null,
        createdBy: anna.id,
        countsAsExpense: true,
        deductible: "unknown",
        tags: [],
      });
    });

    it("starts next month when the day of the month has passed in the start month", () => {
      expect(make({ startDate: "2026-01-20", dayOfMonth: 5 }).nextDate).toBe(
        "2026-02-05",
      );
    });

    it("takes the split of the book when it names none, and stores it", () => {
      const r = createCostRecurrence(
        ctx(),
        createCostRecurrenceRequestSchema.parse({
          title: "Strom",
          amountMinor: 8000,
          category: "utilities",
          frequency: "monthly",
          startDate: "2026-01-01",
          bookId: book("Haushalt").id,
        }),
        null,
      );
      expect(r.splitMode).toBe("equal");
      updateCostBook(ctx(), book("Haushalt").id, {
        defaultSplitMode: "ownership",
      });
      expect(getCostRecurrence(ctx(), r.id).splitMode).toBe("equal");
    });

    it("keeps mortgage repayments out of the expenses unless told otherwise", () => {
      expect(make({ category: "mortgage_principal" }).countsAsExpense).toBe(
        false,
      );
      expect(
        make({ category: "mortgage_principal", countsAsExpense: true })
          .countsAsExpense,
      ).toBe(true);
    });

    it.each<[string, Record<string, unknown>]>([
      ["a book that does not exist", { bookId: "nope" }],
      ["an asset that does not exist", { assetId: "nope" }],
      ["a room that does not exist", { roomId: "nope" }],
      ["a payer that does not exist", { paidByUserId: "nope" }],
      ["a tag that does not exist", { tagIds: ["nope"] }],
      ["a custom split without shares", { splitMode: "custom" }],
      [
        "participants for an ownership split",
        { splitMode: "ownership", participantIds: ["nope"] },
      ],
      [
        "a tax class in a book that is not tax relevant",
        { bookId: "haushalt", deductible: "maintenance" },
      ],
      [
        "an end date that leaves no occurrence",
        { startDate: "2026-01-20", dayOfMonth: 5, endDate: "2026-02-01" },
      ],
    ])("refuses %s", (_name, over) => {
      const bookId =
        over.bookId === "haushalt" ? book("Haushalt").id : over.bookId;
      expect(() =>
        make(over.bookId === undefined ? over : { ...over, bookId }),
      ).toThrow("Invalid request");
      expect(listCostRecurrences(ctx())).toEqual([]);
    });

    it("refuses a book that is closed to new entries", () => {
      const ferien = createCostBook(
        ctx(),
        createCostBookRequestSchema.parse({ name: "Ferien" }),
      );
      updateCostBook(ctx(), ferien.id, { archived: true });
      expect(() => make({ bookId: ferien.id })).toThrow("Invalid request");
    });

    it("refuses an end date before the start date in the request", () => {
      expect(
        createCostRecurrenceRequestSchema.safeParse({
          title: "x",
          amountMinor: 1,
          category: "other",
          frequency: "monthly",
          startDate: "2026-03-01",
          endDate: "2026-02-28",
        }).success,
      ).toBe(false);
    });

    it("refuses an interval or a day outside its range", () => {
      for (const over of [
        { interval: 0 },
        { interval: 13 },
        { dayOfMonth: 0 },
        { dayOfMonth: 32 },
        { amountMinor: 0 },
      ]) {
        expect(
          createCostRecurrenceRequestSchema.safeParse({
            title: "x",
            amountMinor: 1,
            category: "other",
            frequency: "monthly",
            startDate: "2026-03-01",
            ...over,
          }).success,
        ).toBe(false);
      }
    });

    it("stops at the most recurring costs a household can have", () => {
      for (let i = 0; i < MAX_COST_RECURRENCES; i++) make({ title: `R${i}` });
      expect(() => make({ title: "Eins zu viel" })).toThrow(
        /delete one you do not use/,
      );
    });
  });

  describe("booking what is due", () => {
    it("books an occurrence once, however often it runs, and moves on", async () => {
      const anna = await createTestUser({ displayName: "Anna" });
      const r = make({}, anna.id);
      expect(run("2026-01-01", r.id)).toEqual({ booked: 1, failed: 0 });
      expect(run("2026-01-01")).toEqual({ booked: 0, failed: 0 });
      expect(run("2026-01-31")).toEqual({ booked: 0, failed: 0 });
      expect(dates()).toEqual(["2026-01-01"]);
      expect(getCostRecurrence(ctx(), r.id)).toMatchObject({
        lastOccurrenceDate: "2026-01-01",
        nextDate: "2026-02-01",
        lastError: null,
      });
    });

    it("books the entry the template describes, as a recurring entry nobody has to review", async () => {
      const anna = await createTestUser({ displayName: "Anna" });
      const ben = await createTestUser({ displayName: "Ben" });
      const asset = createAsset(
        ctx(),
        createAssetRequestSchema.parse({ kind: "device", name: "Heizung" }),
      );
      const tag = createCostTag(ctx(), { name: "Fix" });
      const r = make(
        {
          title: "Wartung",
          amountMinor: 24050,
          category: "maintenance",
          payee: "Beispiel AG",
          notes: "Vertrag 17",
          paidByUserId: ben.id,
          assetId: asset.id,
          tagIds: [tag.id],
          deductible: "maintenance",
          splitMode: "equal",
        },
        anna.id,
      );
      run("2026-01-01");
      const [e] = entries();
      expect(e).toMatchObject({
        date: "2026-01-01",
        title: "Wartung",
        amountMinor: 24050,
        currency: "CHF",
        category: "maintenance",
        payee: "Beispiel AG",
        notes: "Vertrag 17",
        paidByUserId: ben.id,
        assetId: asset.id,
        source: "recurring",
        recurrenceId: r.id,
        recurrenceDate: "2026-01-01",
        reviewNeeded: false,
        createdBy: anna.id,
        countsAsExpense: true,
        deductible: "maintenance",
        splitMode: "equal",
        bookName: "Wohnung",
      });
      expect(e.tags.map((t) => t.name)).toEqual(["Fix"]);
      expect(bps(e)).toEqual({ Anna: 5000, Ben: 5000 });
    });

    it("books nothing before the day", () => {
      make({ startDate: "2026-02-10" });
      expect(run("2026-02-09")).toEqual({ booked: 0, failed: 0 });
      expect(entries()).toEqual([]);
      expect(run("2026-02-10")).toEqual({ booked: 1, failed: 0 });
    });

    it("books every occurrence a server missed while it was down, each once and with its own date", () => {
      const r = make({ startDate: "2026-01-01" });
      expect(run("2026-04-15")).toEqual({ booked: 4, failed: 0 });
      expect(dates()).toEqual([
        "2026-01-01",
        "2026-02-01",
        "2026-03-01",
        "2026-04-01",
      ]);
      expect(run("2026-04-15").booked).toBe(0);
      expect(getCostRecurrence(ctx(), r.id).nextDate).toBe("2026-05-01");
      expect(run("2026-05-01").booked).toBe(1);
      expect(dates()).toHaveLength(5);
    });

    it("clamps the 31st to the end of shorter months without drifting", () => {
      make({ startDate: "2026-01-31", dayOfMonth: 31 });
      run("2026-05-01");
      expect(dates()).toEqual([
        "2026-01-31",
        "2026-02-28",
        "2026-03-31",
        "2026-04-30",
      ]);
      run("2026-05-31");
      expect(dates().at(-1)).toBe("2026-05-31");
    });

    it("follows quarterly and yearly rules, with 29 February falling back to the 28th", () => {
      make({
        title: "Quartal",
        frequency: "quarterly",
        startDate: "2026-02-15",
      });
      make({
        title: "Jahr",
        frequency: "yearly",
        startDate: "2028-02-29",
        interval: 1,
      });
      run("2030-03-01");
      const by = (title: string) =>
        entries()
          .filter((e) => e.title === title)
          .map((e) => e.date);
      expect(by("Quartal")).toHaveLength(17);
      expect(by("Quartal").slice(0, 4)).toEqual([
        "2026-02-15",
        "2026-05-15",
        "2026-08-15",
        "2026-11-15",
      ]);
      expect(by("Jahr")).toEqual(["2028-02-29", "2029-02-28", "2030-02-28"]);
    });

    it("follows an interval", () => {
      make({ interval: 2, startDate: "2026-01-10" });
      run("2026-08-31");
      expect(dates()).toEqual([
        "2026-01-10",
        "2026-03-10",
        "2026-05-10",
        "2026-07-10",
      ]);
    });

    it("stops after the end date, which is included, and the series is over", () => {
      const r = make({ endDate: "2026-03-01" });
      run("2026-12-31");
      expect(dates()).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
      expect(getCostRecurrence(ctx(), r.id)).toMatchObject({
        nextDate: null,
        lastOccurrenceDate: "2026-03-01",
      });
      expect(run("2027-12-31").booked).toBe(0);
    });

    it("books nothing for a paused recurring cost", () => {
      make({ active: false });
      expect(run("2026-06-30")).toEqual({ booked: 0, failed: 0 });
      expect(entries()).toEqual([]);
    });

    it("splits by the ownership shares of the day it books, and keeps what earlier entries froze", async () => {
      const anna = await createTestUser({ displayName: "Anna" });
      const ben = await createTestUser({ displayName: "Ben" });
      for (const [u, bps] of [
        [anna, 5000],
        [ben, 5000],
      ] as const) {
        test.db
          .update(users)
          .set({ ownershipBps: bps })
          .where(eq(users.id, u.id))
          .run();
      }
      make({ splitMode: "ownership" });
      run("2026-01-01");
      test.db
        .update(users)
        .set({ ownershipBps: 7000 })
        .where(eq(users.id, anna.id))
        .run();
      test.db
        .update(users)
        .set({ ownershipBps: 3000 })
        .where(eq(users.id, ben.id))
        .run();
      run("2026-02-01");
      const [jan, feb] = entries();
      expect(bps(jan)).toEqual({ Anna: 5000, Ben: 5000 });
      expect(bps(feb)).toEqual({ Anna: 7000, Ben: 3000 });
    });

    it("honours a custom split and a narrowed equal split", async () => {
      const anna = await createTestUser({ displayName: "Anna" });
      const ben = await createTestUser({ displayName: "Ben" });
      await createTestUser({ displayName: "Carl" });
      make({
        title: "Custom",
        splitMode: "custom",
        shares: [
          { userId: anna.id, shareBps: 2500 },
          { userId: ben.id, shareBps: 7500 },
        ],
      });
      make({
        title: "Zwei",
        splitMode: "equal",
        participantIds: [anna.id, ben.id],
      });
      run("2026-01-01");
      const by = (title: string) =>
        bps(entries().find((e) => e.title === title)!);
      expect(by("Custom")).toEqual({ Anna: 2500, Ben: 7500 });
      expect(by("Zwei")).toEqual({ Anna: 5000, Ben: 5000 });
    });

    it("books at most MAX_OCCURRENCES_PER_RUN at once and the rest in the next run", () => {
      make({ startDate: "2010-01-01" });
      const first = run("2026-01-01");
      expect(first.booked).toBe(MAX_OCCURRENCES_PER_RUN);
      const second = run("2026-01-01");
      expect(second.booked).toBeGreaterThan(0);
      expect(first.booked + second.booked).toBeGreaterThan(
        MAX_OCCURRENCES_PER_RUN,
      );
      let total = first.booked + second.booked;
      for (let i = 0; i < 5; i++) total += run("2026-01-01").booked;
      // January 2010 to January 2026 inclusive.
      expect(total).toBe(16 * 12 + 1);
      expect(new Set(dates()).size).toBe(total);
    });

    it("leaves out a tag that was deleted since", () => {
      const keep = createCostTag(ctx(), { name: "Keep" });
      const gone = createCostTag(ctx(), { name: "Gone" });
      make({ tagIds: [keep.id, gone.id] });
      deleteCostTag(ctx(), gone.id);
      run("2026-01-01");
      expect(entries()[0].tags.map((t) => t.name)).toEqual(["Keep"]);
    });

    it("does not book an occurrence again after its entry was deleted", () => {
      make();
      run("2026-01-01");
      deleteCost(ctx(), entries()[0].id);
      expect(run("2026-01-31").booked).toBe(0);
      expect(entries()).toEqual([]);
      expect(run("2026-02-01").booked).toBe(1);
    });

    it("books no second entry for an occurrence that has one, and still moves on", () => {
      const r = make();
      // An earlier run booked the entry but was cut short before the series moved on.
      test.db
        .insert(costEntries)
        .values({
          bookId: r.bookId,
          date: "2026-01-01",
          title: "Miete",
          amountMinor: 150000 as never,
          currency: "CHF",
          category: "other",
          splitMode: "none",
          source: "recurring",
          recurrenceId: r.id,
          recurrenceDate: "2026-01-01",
        })
        .run();
      expect(run("2026-01-01")).toEqual({ booked: 0, failed: 0 });
      expect(entries()).toHaveLength(1);
      expect(getCostRecurrence(ctx(), r.id)).toMatchObject({
        lastOccurrenceDate: "2026-01-01",
        nextDate: "2026-02-01",
      });
    });

    it.each<[string, string, string, string, number]>([
      [
        "just before midnight, the night the clocks go forward",
        "2026-03-29",
        "2026-03-28",
        "23:30",
        0,
      ],
      [
        "after midnight, the night the clocks go forward (still the 28th in UTC)",
        "2026-03-29",
        "2026-03-29",
        "00:30",
        1,
      ],
      ["after the clocks went forward", "2026-03-29", "2026-03-29", "03:30", 1],
      [
        "just before midnight, the night the clocks go back",
        "2026-10-25",
        "2026-10-24",
        "23:30",
        0,
      ],
      [
        "after midnight, the night the clocks go back (still the 24th in UTC)",
        "2026-10-25",
        "2026-10-25",
        "00:30",
        1,
      ],
      [
        "the evening of the day the clocks went back",
        "2026-10-25",
        "2026-10-25",
        "23:59",
        1,
      ],
      [
        "the evening before the next day's occurrence",
        "2026-10-26",
        "2026-10-25",
        "23:59",
        0,
      ],
    ])(
      "reads today in the household zone, not in UTC: %s",
      (_name, due, atDate, atTime, expected) => {
        make({
          startDate: `${due.slice(0, 8)}01`,
          dayOfMonth: Number(due.slice(8)),
        });
        const booked = bookDueRecurrences(
          ctxAt(test.db, at(atDate, atTime)),
        ).booked;
        expect(booked).toBe(expected);
        expect(dates()).toEqual(expected ? [due] : []);
      },
    );
  });

  describe("failing", () => {
    it("records why a recurring cost cannot book, keeps its place and does not hold up the others", () => {
      const ferien = createCostBook(
        ctx(),
        createCostBookRequestSchema.parse({ name: "Ferien" }),
      );
      const stuck = make({ title: "Ferienhaus", bookId: ferien.id });
      make({ title: "Miete" });
      updateCostBook(ctx(), ferien.id, { archived: true });
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(run("2026-02-01")).toEqual({ booked: 2, failed: 1 });
      expect(entries().map((e) => e.title)).toEqual(["Miete", "Miete"]);
      expect(getCostRecurrence(ctx(), stuck.id)).toMatchObject({
        lastError: "book_archived",
        nextDate: "2026-01-01",
        lastOccurrenceDate: null,
      });
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0][0])).toContain("book_archived");
      expect(String(error.mock.calls[0][0])).not.toContain("Ferienhaus");
      error.mockRestore();

      updateCostBook(ctx(), ferien.id, { archived: false });
      expect(run("2026-02-01")).toEqual({ booked: 2, failed: 0 });
      expect(getCostRecurrence(ctx(), stuck.id)).toMatchObject({
        lastError: null,
        nextDate: "2026-03-01",
      });
      expect(
        entries()
          .filter((e) => e.title === "Ferienhaus")
          .map((e) => e.date),
      ).toEqual(["2026-01-01", "2026-02-01"]);
    });

    it("reports any other failure as a plain failure", () => {
      const r = make();
      test.db
        .update(costRecurrences)
        .set({ splitMode: "custom", sharesJson: null })
        .where(eq(costRecurrences.id, r.id))
        .run();
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(run("2026-01-01")).toEqual({ booked: 0, failed: 1 });
      expect(getCostRecurrence(ctx(), r.id).lastError).toBe("failed");
      error.mockRestore();
    });
  });

  describe("updating", () => {
    it("applies the template to entries booked from now on only", () => {
      const r = make();
      run("2026-01-01");
      update(r.id, { title: "Miete neu", amountMinor: 160000 });
      run("2026-02-01");
      const [jan, feb] = entries();
      expect(jan).toMatchObject({ title: "Miete", amountMinor: 150000 });
      expect(feb).toMatchObject({ title: "Miete neu", amountMinor: 160000 });
    });

    it("continues after the newest booked occurrence when the rule changes", () => {
      const r = make();
      run("2026-01-01");
      expect(update(r.id, { dayOfMonth: 15 })).toMatchObject({
        dayOfMonth: 15,
        nextDate: "2026-01-15",
      });
      run("2026-03-31");
      expect(dates()).toEqual([
        "2026-01-01",
        "2026-01-15",
        "2026-02-15",
        "2026-03-15",
      ]);
    });

    it("never books an occurrence before the newest one again when the start moves back", () => {
      const r = make({ startDate: "2026-03-01" });
      run("2026-03-01");
      expect(update(r.id, { startDate: "2026-01-01" }).nextDate).toBe(
        "2026-04-01",
      );
    });

    it("starts over from the new start date while nothing was booked", () => {
      const r = make({ startDate: "2026-03-01" });
      expect(update(r.id, { startDate: "2026-02-01" }).nextDate).toBe(
        "2026-02-01",
      );
    });

    it("ends the series with an end date and goes on when it is removed", () => {
      const r = make();
      run("2026-02-01");
      expect(update(r.id, { endDate: "2026-02-15" })).toMatchObject({
        nextDate: null,
      });
      expect(run("2026-06-01").booked).toBe(0);
      expect(update(r.id, { endDate: null })).toMatchObject({
        nextDate: "2026-03-01",
        endDate: null,
      });
      expect(run("2026-03-01").booked).toBe(1);
    });

    it("pauses, and resuming skips what fell due meanwhile", () => {
      const r = make();
      run("2026-01-01");
      update(r.id, { active: false });
      expect(run("2026-04-10").booked).toBe(0);
      const resumed = update(r.id, { active: true }, "2026-04-10");
      expect(resumed).toMatchObject({ active: true, nextDate: "2026-05-01" });
      run("2026-05-01");
      expect(dates()).toEqual(["2026-01-01", "2026-05-01"]);
    });

    it("resumes with an occurrence that is due today", () => {
      const r = make();
      run("2026-01-01");
      update(r.id, { active: false });
      expect(update(r.id, { active: true }, "2026-03-01").nextDate).toBe(
        "2026-03-01",
      );
    });

    it("clears the last error with any change", () => {
      const r = make();
      test.db
        .update(costRecurrences)
        .set({ lastError: "failed" })
        .where(eq(costRecurrences.id, r.id))
        .run();
      expect(update(r.id, { notes: "repariert" }).lastError).toBeNull();
    });

    it("follows the rules of an entry for the split", async () => {
      const anna = await createTestUser({ displayName: "Anna" });
      const ben = await createTestUser({ displayName: "Ben" });
      const r = make({ splitMode: "ownership" });
      expect(() => update(r.id, { shares: [] })).toThrow();
      expect(() =>
        update(r.id, {
          shares: [{ userId: anna.id, shareBps: 10000 }],
        }),
      ).toThrow("Invalid request");
      expect(() => update(r.id, { participantIds: [anna.id] })).toThrow(
        "Invalid request",
      );
      expect(() => update(r.id, { splitMode: "custom" })).toThrow(
        "Invalid request",
      );
      const equal = update(r.id, {
        splitMode: "equal",
        participantIds: [anna.id, ben.id],
      });
      expect(equal).toMatchObject({
        splitMode: "equal",
        participantIdsJson: [anna.id, ben.id],
        sharesJson: null,
      });
      const custom = update(r.id, {
        splitMode: "custom",
        shares: [
          { userId: anna.id, shareBps: 4000 },
          { userId: ben.id, shareBps: 6000 },
        ],
      });
      expect(custom).toMatchObject({
        splitMode: "custom",
        participantIdsJson: null,
      });
      expect(custom.sharesJson).toHaveLength(2);
      expect(update(r.id, { splitMode: "none" })).toMatchObject({
        sharesJson: null,
        participantIdsJson: null,
      });
    });

    it("widens a narrowed equal split to everybody when the request names equal without participants", async () => {
      const anna = await createTestUser({ displayName: "Anna" });
      await createTestUser({ displayName: "Ben" });
      const r = make({ splitMode: "equal", participantIds: [anna.id] });
      run("2026-01-01");
      expect(bps(entries()[0])).toEqual({ Anna: 10000 });
      expect(update(r.id, { splitMode: "equal" })).toMatchObject({
        splitMode: "equal",
        participantIdsJson: null,
        sharesJson: null,
      });
      run("2026-02-01");
      expect(bps(entries()[1])).toEqual({ Anna: 5000, Ben: 5000 });
    });

    it("keeps a narrowed equal split when the request does not touch the split", async () => {
      const anna = await createTestUser({ displayName: "Anna" });
      await createTestUser({ displayName: "Ben" });
      const r = make({ splitMode: "equal", participantIds: [anna.id] });
      expect(update(r.id, { title: "Neu" }).participantIdsJson).toEqual([
        anna.id,
      ]);
    });

    it("keeps a custom split when the request names custom again without shares", async () => {
      const anna = await createTestUser({ displayName: "Anna" });
      const ben = await createTestUser({ displayName: "Ben" });
      const r = make({
        splitMode: "custom",
        shares: [
          { userId: anna.id, shareBps: 2500 },
          { userId: ben.id, shareBps: 7500 },
        ],
      });
      const same = update(r.id, { splitMode: "custom" });
      expect(same.sharesJson).toEqual(r.sharesJson);
      expect(same.splitMode).toBe("custom");
    });

    it("replaces the tags", () => {
      const a = createCostTag(ctx(), { name: "A" });
      const b = createCostTag(ctx(), { name: "B" });
      const r = make({ tagIds: [a.id] });
      expect(update(r.id, { tagIds: [b.id] }).tags.map((t) => t.name)).toEqual([
        "B",
      ]);
      expect(update(r.id, { tagIds: [] }).tags).toEqual([]);
      expect(() => update(r.id, { tagIds: ["nope"] })).toThrow(
        "Invalid request",
      );
    });

    it("checks the merged result and changes nothing when it is wrong", () => {
      const r = make({ startDate: "2026-03-01" });
      expect(() => update(r.id, { endDate: "2026-02-01" })).toThrow(
        "Invalid request",
      );
      expect(() => update(r.id, { bookId: "nope" })).toThrow("Invalid request");
      expect(() => update(r.id, { paidByUserId: "nope" })).toThrow(
        "Invalid request",
      );
      expect(() =>
        update(r.id, {
          startDate: "2026-02-20",
          dayOfMonth: 5,
          endDate: "2026-03-01",
        }),
      ).toThrow("Invalid request");
      expect(getCostRecurrence(ctx(), r.id)).toMatchObject({
        startDate: "2026-03-01",
        endDate: null,
        bookName: "Wohnung",
      });
    });

    it("can be paused or deleted while its book is closed, but editing the template asks for an open book", () => {
      const ferien = createCostBook(
        ctx(),
        createCostBookRequestSchema.parse({ name: "Ferien" }),
      );
      const r = make({ bookId: ferien.id });
      updateCostBook(ctx(), ferien.id, { archived: true });
      expect(update(r.id, { active: false }).active).toBe(false);
      expect(() => update(r.id, { title: "Neu" })).toThrow("Invalid request");
      expect(
        update(r.id, { bookId: book("Wohnung").id, title: "Neu" }),
      ).toMatchObject({ title: "Neu", bookName: "Wohnung" });
    });

    it("answers not found for a recurring cost that is not there", () => {
      expect(() => getCostRecurrence(ctx(), "nope")).toThrow(/not found/);
      expect(() => update("nope", { active: true })).toThrow(/not found/);
      expect(() => deleteCostRecurrence(ctx(), "nope")).toThrow(/not found/);
      expect(() => runCostRecurrenceNow(ctx(), "nope")).toThrow(/not found/);
    });
  });

  describe("running now", () => {
    it("books exactly the next due occurrence", () => {
      const r = make();
      const today = on("2026-03-15");
      const first = runCostRecurrenceNow(today, r.id);
      expect(first.entry).toMatchObject({
        date: "2026-01-01",
        source: "recurring",
        recurrenceId: r.id,
      });
      expect(first.recurrence).toMatchObject({
        lastOccurrenceDate: "2026-01-01",
        nextDate: "2026-02-01",
      });
      expect(runCostRecurrenceNow(today, r.id).entry?.date).toBe("2026-02-01");
      expect(runCostRecurrenceNow(today, r.id).entry?.date).toBe("2026-03-01");
      const none = runCostRecurrenceNow(today, r.id);
      expect(none.entry).toBeNull();
      expect(none.recurrence.nextDate).toBe("2026-04-01");
      expect(dates()).toHaveLength(3);
    });

    it("books nothing that is not due, paused or over", () => {
      const ahead = make({ startDate: "2026-06-01", title: "Später" });
      const paused = make({ active: false, title: "Pause" });
      const over = make({ title: "Vorbei", endDate: "2026-01-01" });
      run("2026-01-01", over.id);
      for (const id of [ahead.id, paused.id, over.id]) {
        expect(runCostRecurrenceNow(on("2026-01-01"), id).entry).toBeNull();
      }
      expect(entries().map((e) => e.title)).toEqual(["Vorbei"]);
    });

    it("records a failure on the recurring cost and throws it", () => {
      const ferien = createCostBook(
        ctx(),
        createCostBookRequestSchema.parse({ name: "Ferien" }),
      );
      const r = make({ bookId: ferien.id });
      updateCostBook(ctx(), ferien.id, { archived: true });
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(() => runCostRecurrenceNow(ctx(), r.id)).toThrow(
        "Invalid request",
      );
      expect(getCostRecurrence(ctx(), r.id).lastError).toBe("book_archived");
      expect(entries()).toEqual([]);
      error.mockRestore();
    });
  });

  describe("listing and deleting", () => {
    it("lists the upcoming ones first and the paused and finished ones last", () => {
      make({ title: "C", startDate: "2026-03-01" });
      make({ title: "A", startDate: "2026-01-01" });
      make({ title: "Pause", active: false, startDate: "2025-12-01" });
      const over = make({ title: "Ende", endDate: "2026-01-01" });
      run("2026-01-01", over.id);
      expect(listCostRecurrences(ctx()).map((r) => r.title)).toEqual([
        "A",
        "C",
        "Ende",
        "Pause",
      ]);
      expect(
        listCostRecurrences(ctx(), { active: true }).map((r) => r.title),
      ).toEqual(["A", "C"]);
      expect(
        listCostRecurrences(ctx(), { active: false }).map((r) => r.title),
      ).toEqual(["Ende", "Pause"]);
    });

    it("filters by book", () => {
      make({ title: "Wohnung" });
      make({ title: "Haushalt", bookId: book("Haushalt").id });
      expect(
        listCostRecurrences(ctx(), { bookId: book("Haushalt").id }).map(
          (r) => r.title,
        ),
      ).toEqual(["Haushalt"]);
    });

    it("keeps the entries a deleted recurring cost booked, without the tie to it", () => {
      const r = make();
      run("2026-02-01");
      deleteCostRecurrence(ctx(), r.id);
      expect(listCostRecurrences(ctx())).toEqual([]);
      expect(entries()).toHaveLength(2);
      expect(entries().every((e) => e.recurrenceId === null)).toBe(true);
      expect(entries().every((e) => e.source === "recurring")).toBe(true);
    });

    it("keeps a book that has a recurring cost from being deleted", () => {
      const ferien = createCostBook(
        ctx(),
        createCostBookRequestSchema.parse({ name: "Ferien" }),
      );
      const r = make({ bookId: ferien.id });
      expect(() => deleteCostBook(ctx(), ferien.id)).toThrow(
        /still has recurring costs/,
      );
      deleteCostRecurrence(ctx(), r.id);
      deleteCostBook(ctx(), ferien.id);
    });
  });
});
