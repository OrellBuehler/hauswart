import { describe, expect, it } from "vitest";
import type { CostBook } from "$lib/api/schemas/cost-books";
import type { CostRecurrence } from "$lib/api/schemas/cost-recurrences";
import type { RecurrenceRule } from "./recurrence";
import {
  RECURRENCE_BOOKING_CAP,
  buildRecurrenceCreateBody,
  buildRecurrenceUpdateBody,
  changesRule,
  clampNote,
  clampedMonths,
  draftFromRecurrence,
  immediateBookings,
  immediateWarning,
  isDue,
  newRecurrenceDraft,
  recurrenceBookClosed,
  recurrenceErrorMessage,
  recurrenceState,
  resumeMessage,
  ruleOf,
  ruleOfDraft,
  ruleWording,
  runNowMessage,
  upcomingDates,
  withStartDate,
  type RecurrenceDraft,
} from "./recurrences";
import { ApiError } from "$lib/api/errors";

const TODAY = "2026-10-12";
const USERS = ["u1", "u2", "u3"];

const rule = (over: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  frequency: "monthly",
  interval: 1,
  dayOfMonth: 1,
  startDate: "2026-01-01",
  endDate: null,
  ...over,
});

function recurrence(over: Partial<CostRecurrence> = {}): CostRecurrence {
  return {
    id: "r1",
    bookId: "b1",
    bookName: "Wohnung",
    title: "Miete",
    amountMinor: 185000,
    currency: "CHF",
    category: "utilities",
    assetId: null,
    assetName: null,
    roomId: null,
    roomName: null,
    payee: null,
    notes: null,
    paidByUserId: "u1",
    paidByName: "Anna Beispiel",
    splitMode: "ownership",
    shares: null,
    participantIds: null,
    tags: [],
    countsAsExpense: true,
    deductible: "unknown",
    frequency: "monthly",
    interval: 1,
    dayOfMonth: 1,
    startDate: "2026-01-01",
    endDate: null,
    nextDate: "2026-11-01",
    lastOccurrenceDate: "2026-10-01",
    active: true,
    lastError: null,
    createdBy: "u1",
    createdAt: "2026-01-01T08:00:00.000Z",
    updatedAt: "2026-10-01T08:00:00.000Z",
    ...over,
  };
}

const books: CostBook[] = [
  {
    id: "b1",
    name: "Wohnung",
    taxRelevant: true,
    defaultSplitMode: "ownership",
    archivedAt: null,
    isDefault: true,
  } as CostBook,
];

describe("the rule in words", () => {
  it.each<[string, Partial<RecurrenceRule>, string, string]>([
    ["every month", {}, "Monatlich am 1.", "Monthly on the 1st"],
    [
      "every few months",
      { interval: 3, dayOfMonth: 15 },
      "Alle 3 Monate am 15.",
      "Every 3 months on the 15th",
    ],
    [
      "every quarter",
      { frequency: "quarterly", dayOfMonth: 2 },
      "Vierteljährlich am 2.",
      "Quarterly on the 2nd",
    ],
    [
      "every other quarter",
      { frequency: "quarterly", interval: 2, dayOfMonth: 3 },
      "Alle 2 Quartale am 3.",
      "Every 2 quarters on the 3rd",
    ],
    [
      "every year, in the month of the start",
      { frequency: "yearly", dayOfMonth: 31, startDate: "2026-01-10" },
      "Jährlich am 31. Jan.",
      "Yearly on 31 Jan",
    ],
    [
      "every few years",
      {
        frequency: "yearly",
        interval: 2,
        dayOfMonth: 15,
        startDate: "2026-03-01",
      },
      "Alle 2 Jahre am 15. März",
      "Every 2 years on 15 Mar",
    ],
    [
      "the last day of a month",
      { dayOfMonth: 31 },
      "Monatlich am 31.",
      "Monthly on the 31st",
    ],
  ])("%s", (_name, over, german, english) => {
    const r = rule(over);
    expect(ruleWording(r, "de")).toBe(german);
    expect(ruleWording(r, "en")).toBe(english);
  });

  it("uses the language of the page without an explicit one", () => {
    expect(ruleWording(rule())).toBe("Monatlich am 1.");
  });

  it("takes the month of a yearly rule from its start date", () => {
    expect(
      ruleWording(
        rule({ frequency: "yearly", dayOfMonth: 1, startDate: "2026-12-10" }),
        "de",
      ),
    ).toBe("Jährlich am 1. Dez.");
  });
});

describe("month-end clamping", () => {
  it("is no issue up to the 28th", () => {
    expect(clampedMonths(rule({ dayOfMonth: 28 }))).toEqual([]);
    expect(clampNote(rule({ dayOfMonth: 28 }))).toBeNull();
  });

  it("names the months of a monthly rule that lack the day", () => {
    expect(clampedMonths(rule({ dayOfMonth: 31 }))).toEqual([2, 4, 6, 9, 11]);
    expect(clampedMonths(rule({ dayOfMonth: 30 }))).toEqual([2]);
    expect(clampedMonths(rule({ dayOfMonth: 29 }))).toEqual([2]);
  });

  it("only looks at the months the rule books in", () => {
    // Quarterly from January: January, April, July, October.
    expect(
      clampedMonths(
        rule({
          frequency: "quarterly",
          dayOfMonth: 31,
          startDate: "2026-01-01",
        }),
      ),
    ).toEqual([4]);
    // Quarterly from January on the 30th never meets a short month.
    expect(
      clampedMonths(
        rule({
          frequency: "quarterly",
          dayOfMonth: 30,
          startDate: "2026-01-01",
        }),
      ),
    ).toEqual([]);
    expect(
      clampedMonths(
        rule({ frequency: "yearly", dayOfMonth: 31, startDate: "2026-01-10" }),
      ),
    ).toEqual([]);
    expect(
      clampedMonths(
        rule({ frequency: "yearly", dayOfMonth: 31, startDate: "2026-04-10" }),
      ),
    ).toEqual([4]);
    // Every other month from February: February, April, June, ...
    expect(
      clampedMonths(
        rule({ interval: 2, dayOfMonth: 31, startDate: "2026-02-01" }),
      ),
    ).toEqual([2, 4, 6]);
  });

  it("explains the clamping, in general for a rule that books every month", () => {
    const general = clampNote(rule({ dayOfMonth: 31 }));
    expect(general).toContain("31.");
    expect(general).toContain("letzten Tag");
    expect(general).toContain("28. Februar");
    expect(clampNote(rule({ dayOfMonth: 31 }), "en")).toContain(
      "last day of that month",
    );
  });

  it("names the months for any other rule", () => {
    // Quarterly from February books in February, May, August and November.
    const note = clampNote(
      rule({ frequency: "quarterly", dayOfMonth: 31, startDate: "2026-02-01" }),
    );
    expect(note).toContain("Februar und November");
    expect(note).toContain("letzten Tag");
    expect(
      clampNote(
        rule({ frequency: "yearly", dayOfMonth: 29, startDate: "2026-02-01" }),
        "en",
      ),
    ).toContain("February");
  });
});

describe("the state of a recurring cost", () => {
  it("is active, paused or finished", () => {
    expect(recurrenceState(recurrence())).toBe("active");
    expect(recurrenceState(recurrence({ active: false }))).toBe("paused");
    expect(recurrenceState(recurrence({ nextDate: null }))).toBe("finished");
    expect(recurrenceState(recurrence({ nextDate: null, active: false }))).toBe(
      "finished",
    );
  });

  it("is due when it is active and its next date is today or earlier", () => {
    expect(isDue(recurrence({ nextDate: TODAY }), TODAY)).toBe(true);
    expect(isDue(recurrence({ nextDate: "2026-10-01" }), TODAY)).toBe(true);
    expect(isDue(recurrence({ nextDate: "2026-10-13" }), TODAY)).toBe(false);
    expect(
      isDue(recurrence({ nextDate: "2026-10-01", active: false }), TODAY),
    ).toBe(false);
    expect(isDue(recurrence({ nextDate: null }), TODAY)).toBe(false);
  });

  it("words what went wrong with the last booking", () => {
    expect(recurrenceErrorMessage(recurrence())).toBeNull();
    const archived = recurrenceErrorMessage(
      recurrence({ lastError: "book_archived" }),
    );
    expect(archived).toContain("«Wohnung»");
    expect(archived).toContain("archiviert");
    expect(
      recurrenceErrorMessage(recurrence({ lastError: "failed" })),
    ).toContain("fehlgeschlagen");
  });
});

describe("the preview of the next dates", () => {
  it("lists the next three dates after today", () => {
    expect(upcomingDates(rule({ dayOfMonth: 15 }), TODAY)).toEqual([
      "2026-10-15",
      "2026-11-15",
      "2026-12-15",
    ]);
  });

  it("does not list today, which is booked at once", () => {
    expect(upcomingDates(rule({ dayOfMonth: 12 }), TODAY)).toEqual([
      "2026-11-12",
      "2026-12-12",
      "2027-01-12",
    ]);
  });

  it("starts at the start date when it is ahead", () => {
    expect(
      upcomingDates(rule({ startDate: "2027-03-20", dayOfMonth: 5 }), TODAY),
    ).toEqual(["2027-04-05", "2027-05-05", "2027-06-05"]);
  });

  it("clamps to the end of a short month and comes back to the 31st", () => {
    expect(upcomingDates(rule({ dayOfMonth: 31 }), "2027-01-31")).toEqual([
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
  });

  it("stops at the end date", () => {
    expect(
      upcomingDates(rule({ dayOfMonth: 15, endDate: "2026-11-30" }), TODAY),
    ).toEqual(["2026-10-15", "2026-11-15"]);
    expect(upcomingDates(rule({ endDate: "2026-10-01" }), TODAY)).toEqual([]);
  });

  it("follows the interval and the frequency", () => {
    expect(
      upcomingDates(
        rule({
          frequency: "quarterly",
          dayOfMonth: 3,
          startDate: "2026-02-01",
        }),
        TODAY,
      ),
    ).toEqual(["2026-11-03", "2027-02-03", "2027-05-03"]);
    expect(
      upcomingDates(
        rule({
          frequency: "yearly",
          interval: 2,
          dayOfMonth: 31,
          startDate: "2026-01-10",
        }),
        TODAY,
      ),
    ).toEqual(["2028-01-31", "2030-01-31", "2032-01-31"]);
  });

  it("can show fewer or more dates", () => {
    expect(upcomingDates(rule({ dayOfMonth: 15 }), TODAY, 1)).toEqual([
      "2026-10-15",
    ]);
    expect(upcomingDates(rule({ dayOfMonth: 15 }), TODAY, 5)).toHaveLength(5);
  });
});

describe("what saving books at once", () => {
  it("is nothing for a start date ahead", () => {
    const none = immediateBookings(
      rule({ startDate: "2026-12-01" }),
      null,
      TODAY,
    );
    expect(none).toEqual({ count: 0, capped: false, first: null, last: null });
    expect(immediateWarning(none, TODAY)).toBeNull();
  });

  it("counts every occurrence from a past start date up to today", () => {
    const past = immediateBookings(
      rule({ startDate: "2026-07-20", dayOfMonth: 5 }),
      null,
      TODAY,
    );
    expect(past).toEqual({
      count: 3,
      capped: false,
      first: "2026-08-05",
      last: "2026-10-05",
    });
    expect(immediateWarning(past, TODAY)).toBe(
      `Bucht sofort 3 Einträge seit ${"05.08.2026"}. Wähle einen späteren Beginn, wenn nur künftige Termine gebucht werden sollen.`,
    );
  });

  it("says 'seit' with the first date also for one entry", () => {
    const one = immediateBookings(
      rule({ startDate: "2026-10-01", dayOfMonth: 5 }),
      null,
      TODAY,
    );
    expect(one.count).toBe(1);
    expect(immediateWarning(one, TODAY)).toContain(
      "Bucht sofort 1 Eintrag seit",
    );
  });

  it("books an occurrence of today at once and says so without 'since'", () => {
    const today = immediateBookings(
      rule({ startDate: TODAY, dayOfMonth: 12 }),
      null,
      TODAY,
    );
    expect(today.count).toBe(1);
    expect(immediateWarning(today, TODAY)).toBe(
      "Bucht sofort 1 Eintrag für heute.",
    );
  });

  it("caps what one run books at 120 and says the rest follows", () => {
    const old = immediateBookings(
      rule({ startDate: "2000-01-01" }),
      null,
      TODAY,
    );
    expect(old.count).toBe(RECURRENCE_BOOKING_CAP);
    expect(old.capped).toBe(true);
    expect(old.first).toBe("2000-01-01");
    const text = immediateWarning(old, TODAY) as string;
    expect(text).toContain("Bucht sofort 120 Einträge");
    expect(text).toContain("120");
    expect(text).toContain("Rest folgt");
  });

  it("does not call exactly 120 'capped'", () => {
    // 120 monthly occurrences from 2016-10 up to and including 2026-09.
    const exact = immediateBookings(
      rule({ startDate: "2016-10-01", endDate: "2026-09-30" }),
      null,
      TODAY,
    );
    expect(exact.count).toBe(120);
    expect(exact.capped).toBe(false);
  });

  it("counts from the newest booking on an edit, not from the start", () => {
    const edit = immediateBookings(
      rule({ startDate: "2026-01-01", dayOfMonth: 1 }),
      "2026-08-01",
      TODAY,
    );
    expect(edit.count).toBe(2);
    expect(edit.first).toBe("2026-09-01");
  });
});

describe("the rule of a draft", () => {
  const draft = (over: Partial<RecurrenceDraft> = {}): RecurrenceDraft => ({
    ...newRecurrenceDraft({
      today: TODAY,
      currency: "CHF",
      paidByUserId: "u1",
      userIds: USERS,
    }),
    title: "Miete",
    amount: "1850",
    category: "utilities",
    ...over,
  });

  it("starts today, monthly, on the day of the start date", () => {
    const start = newRecurrenceDraft({
      today: "2026-10-31",
      currency: "CHF",
      paidByUserId: "u1",
      userIds: USERS,
    });
    expect(start).toMatchObject({
      frequency: "monthly",
      interval: "1",
      dayOfMonth: "31",
      dayTouched: false,
      startDate: "2026-10-31",
      endDate: "",
      paidByUserId: "u1",
      tagIds: [],
    });
    expect(start).not.toHaveProperty("date");
    expect(start).not.toHaveProperty("financeSuggestionId");
  });

  it("lets the day follow the start date until a day was typed", () => {
    expect(withStartDate(draft(), "2026-11-17").dayOfMonth).toBe("17");
    expect(
      withStartDate(draft({ dayTouched: true, dayOfMonth: "5" }), "2026-11-17")
        .dayOfMonth,
    ).toBe("5");
    expect(withStartDate(draft(), "2026-11-1").dayOfMonth).toBe("12");
  });

  it("is the rule when its fields are valid, else nothing", () => {
    expect(ruleOfDraft(draft())).toEqual({
      frequency: "monthly",
      interval: 1,
      dayOfMonth: 12,
      startDate: TODAY,
      endDate: null,
    });
    expect(ruleOfDraft(draft({ interval: "13" }))).toBeNull();
    expect(ruleOfDraft(draft({ interval: "0" }))).toBeNull();
    expect(ruleOfDraft(draft({ interval: "1.5" }))).toBeNull();
    expect(ruleOfDraft(draft({ dayOfMonth: "32" }))).toBeNull();
    expect(ruleOfDraft(draft({ dayOfMonth: "" }))).toBeNull();
    expect(ruleOfDraft(draft({ startDate: "" }))).toBeNull();
    expect(ruleOfDraft(draft({ endDate: "2026-01-01" }))).toBeNull();
    expect(ruleOfDraft(draft({ endDate: "2027-01-01" }))?.endDate).toBe(
      "2027-01-01",
    );
  });
});

describe("creating a recurring cost", () => {
  const draft = (over: Partial<RecurrenceDraft> = {}): RecurrenceDraft => ({
    ...newRecurrenceDraft({
      today: TODAY,
      currency: "CHF",
      paidByUserId: "u1",
      userIds: USERS,
    }),
    title: "Miete",
    amount: "1850",
    category: "utilities",
    ...over,
  });

  it("builds the request with the template and the rule", () => {
    const { body, errors } = buildRecurrenceCreateBody(draft(), USERS, books);
    expect(errors).toEqual({});
    expect(body).toEqual({
      bookId: draft().bookId || undefined,
      title: "Miete",
      amountMinor: 185000,
      currency: "CHF",
      category: "utilities",
      assetId: null,
      roomId: null,
      payee: null,
      notes: null,
      paidByUserId: "u1",
      splitMode: "ownership",
      countsAsExpense: true,
      deductible: "unknown",
      frequency: "monthly",
      interval: 1,
      dayOfMonth: 12,
      startDate: TODAY,
    });
  });

  it("sends tags, an end date and the people of an equal split only when they are set", () => {
    const { body } = buildRecurrenceCreateBody(
      draft({
        tagIds: ["t1"],
        endDate: "2027-09-30",
        splitMode: "equal",
        participants: ["u1", "u2"],
        payee: " Verwaltung ",
      }),
      USERS,
      books,
    );
    expect(body).toMatchObject({
      tagIds: ["t1"],
      endDate: "2027-09-30",
      splitMode: "equal",
      participantIds: ["u1", "u2"],
      payee: "Verwaltung",
    });
  });

  it("books a refund as a negative amount", () => {
    expect(
      buildRecurrenceCreateBody(draft({ refund: true, amount: "20" }), USERS)
        .body?.amountMinor,
    ).toBe(-2000);
  });

  it("points at every field that is wrong", () => {
    const { body, errors } = buildRecurrenceCreateBody(
      draft({
        title: " ",
        amount: "",
        interval: "13",
        dayOfMonth: "40",
        startDate: "",
      }),
      USERS,
    );
    expect(body).toBeUndefined();
    expect(Object.keys(errors).sort()).toEqual(
      ["amountMinor", "dayOfMonth", "interval", "startDate", "title"].sort(),
    );
    expect(errors.interval).toBe("Bitte eine ganze Zahl von 1 bis 12 angeben.");
    expect(errors.dayOfMonth).toBe("Bitte einen Tag von 1 bis 31 angeben.");
  });

  it("refuses an end before the start, and an end that leaves no booking", () => {
    expect(
      buildRecurrenceCreateBody(draft({ endDate: "2026-01-01" }), USERS).errors
        .endDate,
    ).toBe("Das Ende darf nicht vor dem Beginn liegen.");
    const none = buildRecurrenceCreateBody(
      draft({
        startDate: "2026-10-20",
        dayOfMonth: "5",
        endDate: "2026-10-31",
      }),
      USERS,
    );
    expect(none.body).toBeUndefined();
    expect(none.errors.endDate).toBe(
      "Bis zu diesem Ende fällt keine Buchung mehr an.",
    );
  });

  it("needs somebody ticked for an equal split and a valid currency", () => {
    expect(
      buildRecurrenceCreateBody(
        draft({ splitMode: "equal", participants: [] }),
        USERS,
      ).errors.participantIds,
    ).toBeTruthy();
    expect(
      buildRecurrenceCreateBody(draft({ currency: "CH" }), USERS).errors
        .currency,
    ).toBeTruthy();
  });

  it("drops a tax class in a book that does not have one", () => {
    const notRelevant: CostBook[] = [
      { ...books[0], taxRelevant: false } as CostBook,
    ];
    expect(
      buildRecurrenceCreateBody(
        draft({ bookId: "b1", deductible: "maintenance" }),
        USERS,
        notRelevant,
      ).body?.deductible,
    ).toBe("unknown");
  });
});

describe("editing a recurring cost", () => {
  it("reads a recurring cost into the draft and back without a change", () => {
    const r = recurrence({
      tags: [{ id: "t1", name: "Fix", color: "blue" }],
      endDate: "2027-12-31",
    });
    const d = draftFromRecurrence(r, USERS);
    expect(d.amount).toBe("1850.00");
    expect(d.tagIds).toEqual(["t1"]);
    expect(d.dayTouched).toBe(true);
    expect(buildRecurrenceUpdateBody(d, r, USERS, books).body).toEqual({});
  });

  it("round-trips a refund and a custom or equal split", () => {
    const refund = recurrence({ amountMinor: -2500 });
    expect(draftFromRecurrence(refund, USERS)).toMatchObject({
      refund: true,
      amount: "25.00",
    });
    const custom = recurrence({
      splitMode: "custom",
      shares: [
        { userId: "u1", shareBps: 7000 },
        { userId: "u2", shareBps: 3000 },
      ],
    });
    expect(
      buildRecurrenceUpdateBody(
        draftFromRecurrence(custom, USERS),
        custom,
        USERS,
      ).body,
    ).toEqual({});
    const equal = recurrence({
      splitMode: "equal",
      participantIds: ["u1", "u3"],
    });
    const d = draftFromRecurrence(equal, USERS);
    expect(d.participants).toEqual(["u1", "u3"]);
    expect(buildRecurrenceUpdateBody(d, equal, USERS).body).toEqual({});
  });

  it("sends only what changed", () => {
    const r = recurrence();
    const d = draftFromRecurrence(r, USERS);
    expect(
      buildRecurrenceUpdateBody({ ...d, amount: "1900" }, r, USERS).body,
    ).toEqual({ amountMinor: 190000 });
    expect(
      buildRecurrenceUpdateBody({ ...d, title: "Miete Wohnung" }, r, USERS)
        .body,
    ).toEqual({ title: "Miete Wohnung" });
    expect(
      buildRecurrenceUpdateBody({ ...d, payee: "Verwaltung" }, r, USERS).body,
    ).toEqual({ payee: "Verwaltung" });
    expect(
      buildRecurrenceUpdateBody({ ...d, tagIds: ["t1", "t2"] }, r, USERS).body,
    ).toEqual({ tagIds: ["t1", "t2"] });
  });

  it("sends the changed rule fields, and null for a cleared end", () => {
    const r = recurrence({ endDate: "2027-12-31" });
    const d = draftFromRecurrence(r, USERS);
    expect(
      buildRecurrenceUpdateBody(
        { ...d, frequency: "quarterly", interval: "2", dayOfMonth: "15" },
        r,
        USERS,
      ).body,
    ).toEqual({ frequency: "quarterly", interval: 2, dayOfMonth: 15 });
    expect(
      buildRecurrenceUpdateBody({ ...d, endDate: "" }, r, USERS).body,
    ).toEqual({
      endDate: null,
    });
    expect(
      buildRecurrenceUpdateBody({ ...d, startDate: "2026-02-01" }, r, USERS)
        .body,
    ).toEqual({ startDate: "2026-02-01" });
  });

  it("splits again only when the mode, the custom shares or the people changed", () => {
    const r = recurrence();
    const d = draftFromRecurrence(r, USERS);
    expect(
      buildRecurrenceUpdateBody({ ...d, splitMode: "equal" }, r, USERS).body,
    ).toEqual({ splitMode: "equal" });
    expect(
      buildRecurrenceUpdateBody(
        { ...d, splitMode: "equal", participants: ["u1", "u2"] },
        r,
        USERS,
      ).body,
    ).toEqual({ splitMode: "equal", participantIds: ["u1", "u2"] });
    expect(
      buildRecurrenceUpdateBody({ ...d, splitMode: "none" }, r, USERS).body,
    ).toEqual({ splitMode: "none" });
  });

  it("sends the expense flag along with a category change", () => {
    const r = recurrence();
    const d = draftFromRecurrence(r, USERS);
    expect(
      buildRecurrenceUpdateBody({ ...d, category: "repair" }, r, USERS).body,
    ).toEqual({ category: "repair", countsAsExpense: true });
  });

  it("reports the same errors as creating", () => {
    const r = recurrence();
    const d = draftFromRecurrence(r, USERS);
    const bad = buildRecurrenceUpdateBody(
      { ...d, interval: "0", amount: "x" },
      r,
      USERS,
    );
    expect(bad.body).toBeUndefined();
    expect(Object.keys(bad.errors).sort()).toEqual(["amountMinor", "interval"]);
  });

  it("tells when the rule is what changed", () => {
    const r = recurrence();
    const d = draftFromRecurrence(r, USERS);
    expect(changesRule(d, r)).toBe(false);
    expect(changesRule({ ...d, amount: "5" }, r)).toBe(false);
    expect(changesRule({ ...d, dayOfMonth: "2" }, r)).toBe(true);
    expect(changesRule({ ...d, endDate: "2027-01-01" }, r)).toBe(true);
    expect(changesRule({ ...d, interval: "x" }, r)).toBe(false);
  });

  it("keeps the rule of a recurring cost as the engine takes it", () => {
    expect(ruleOf(recurrence({ endDate: "2027-12-31" }))).toEqual({
      frequency: "monthly",
      interval: 1,
      dayOfMonth: 1,
      startDate: "2026-01-01",
      endDate: "2027-12-31",
    });
  });
});

describe("what a tap on the buttons answers", () => {
  const entry = { title: "Miete", date: "2026-10-01" } as never;

  it("says which entry was booked for which day", () => {
    const run = runNowMessage({ recurrence: recurrence(), entry });
    expect(run.kind).toBe("booked");
    expect(run.text).toContain("«Miete»");
    expect(run.text).toContain("01.10.2026");
  });

  it("says why nothing was booked", () => {
    expect(
      runNowMessage({ recurrence: recurrence(), entry: null }),
    ).toMatchObject({
      kind: "nothing",
      text: "Es ist noch nichts fällig. Die nächste Buchung ist am 01.11.2026.",
    });
    expect(
      runNowMessage({ recurrence: recurrence({ active: false }), entry: null })
        .text,
    ).toContain("Pausiert");
    expect(
      runNowMessage({ recurrence: recurrence({ nextDate: null }), entry: null })
        .text,
    ).toContain("beendet");
  });

  it("says when the next booking is after a resume, and that the pause is skipped", () => {
    const text = resumeMessage({ title: "Miete", nextDate: "2026-11-01" });
    expect(text).toContain("«Miete»");
    expect(text).toContain("01.11.2026");
    expect(text).toContain("übersprungen");
    expect(resumeMessage({ title: "Miete", nextDate: null })).toContain(
      "beendet",
    );
  });

  it("knows a book that was closed from a 400 on the book", () => {
    expect(
      recurrenceBookClosed(
        new ApiError("invalid_request", "x", {
          status: 400,
          details: { body: { fieldErrors: { bookId: ["x"] } } },
        }),
      ),
    ).toBe(true);
    expect(recurrenceBookClosed(new ApiError("not_found", "x"))).toBe(false);
    expect(
      recurrenceBookClosed(
        new ApiError("invalid_request", "x", {
          details: { body: { fieldErrors: { title: ["x"] } } },
        }),
      ),
    ).toBe(false);
    expect(recurrenceBookClosed(new Error("x"))).toBe(false);
  });
});
