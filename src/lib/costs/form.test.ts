import { describe, expect, it } from "vitest";
import type { CostEntry } from "$lib/api/schemas/costs";
import {
  buildCreateBody,
  buildUpdateBody,
  draftFromEntry,
  equalShares,
  newDraft,
  parseDraftAmount,
  parseShares,
  sharePreview,
  validateShares,
  type CostDraft,
} from "./form";

const USERS = ["u1", "u2", "u3"];

function draft(over: Partial<CostDraft> = {}): CostDraft {
  return {
    ...newDraft({
      today: "2026-10-07",
      currency: "CHF",
      paidByUserId: "u1",
      userIds: USERS,
    }),
    title: "Dishwasher repair",
    amount: "189.50",
    category: "repair",
    ...over,
  };
}

function entry(over: Partial<CostEntry> = {}): CostEntry {
  return {
    id: "c1",
    date: "2026-10-01",
    title: "Dishwasher repair",
    amountMinor: 18950,
    currency: "CHF",
    category: "repair",
    assetId: null,
    assetName: null,
    roomId: null,
    roomName: null,
    defectId: null,
    defectNumber: null,
    defectTitle: null,
    serviceLogId: null,
    serviceLogTitle: null,
    payee: null,
    notes: null,
    paidByUserId: "u1",
    paidByName: "Person One",
    splitMode: "ownership",
    shares: [
      {
        userId: "u1",
        userName: "Person One",
        shareBps: 6000,
        amountMinor: 11370,
      },
      {
        userId: "u2",
        userName: "Person Two",
        shareBps: 4000,
        amountMinor: 7580,
      },
    ],
    countsAsExpense: true,
    deductible: "unknown",
    source: "manual",
    providerUrl: null,
    commentCount: 0,
    createdBy: "u1",
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-01T08:00:00.000Z",
    ...over,
  };
}

describe("amounts", () => {
  it("reads an amount into minor units without floats", () => {
    expect(parseDraftAmount("189.50", false, "CHF")).toEqual({
      ok: true,
      amountMinor: 18950,
    });
    expect(parseDraftAmount("1'234.5", false, "CHF")).toEqual({
      ok: true,
      amountMinor: 123450,
    });
    expect(parseDraftAmount("0,1", false, "CHF")).toEqual({
      ok: true,
      amountMinor: 10,
    });
    expect(parseDraftAmount("1500", false, "JPY")).toEqual({
      ok: true,
      amountMinor: 1500,
    });
  });

  it("makes a refund negative, and keeps a typed minus negative", () => {
    expect(parseDraftAmount("12.00", true, "CHF")).toEqual({
      ok: true,
      amountMinor: -1200,
    });
    expect(parseDraftAmount("-12.00", false, "CHF")).toEqual({
      ok: true,
      amountMinor: -1200,
    });
    expect(parseDraftAmount("-12.00", true, "CHF")).toEqual({
      ok: true,
      amountMinor: -1200,
    });
  });

  it("refuses empty, malformed, zero and too precise amounts", () => {
    for (const text of ["", "abc", "0", "0.00", "1.234", "1,2,3"]) {
      expect(parseDraftAmount(text, false, "CHF").ok, text).toBe(false);
    }
    expect(parseDraftAmount("1.5", false, "JPY").ok).toBe(false);
    expect(parseDraftAmount("1e5", false, "CHF").ok).toBe(false);
    expect(parseDraftAmount("10000000000.00", false, "CHF").ok).toBe(false);
  });

  it("needs a currency code first", () => {
    expect(parseDraftAmount("5", false, "ch").ok).toBe(false);
    expect(parseDraftAmount("5", false, "").ok).toBe(false);
  });
});

describe("shares", () => {
  it("splits 100% evenly, the remainder going to the first people", () => {
    expect(equalShares(USERS)).toEqual({
      u1: "33.34",
      u2: "33.33",
      u3: "33.33",
    });
    expect(equalShares(["a", "b"])).toEqual({ a: "50", b: "50" });
    expect(equalShares([])).toEqual({});
    const total = Object.values(equalShares(USERS))
      .map((v) => Math.round(Number(v) * 100))
      .reduce((a, b) => a + b, 0);
    expect(total).toBe(10_000);
  });

  it("maps percent to basis points and skips blank and zero", () => {
    const parsed = parseShares({ u1: "60", u2: "33,33", u3: "0" }, USERS);
    expect(parsed.items).toEqual([
      { userId: "u1", shareBps: 6000 },
      { userId: "u2", shareBps: 3333 },
    ]);
    expect(parsed.totalBps).toBe(9333);
    expect(parsed.invalid).toEqual([]);
    expect(
      parseShares({ u1: "", u2: "0.00 %", u3: "." }, USERS).invalid,
    ).toEqual(["u3"]);
  });

  it("reports unreadable and out-of-range values", () => {
    const parsed = parseShares({ u1: "abc", u2: "101", u3: "12.345" }, USERS);
    expect(parsed.invalid).toEqual(["u1", "u2", "u3"]);
    expect(parsed.items).toEqual([]);
  });

  it("accepts custom shares only when they add up to 100%", () => {
    expect(validateShares({ u1: "70", u2: "30" }, USERS)).toEqual({
      items: [
        { userId: "u1", shareBps: 7000 },
        { userId: "u2", shareBps: 3000 },
      ],
    });
    expect(validateShares({ u1: "70", u2: "20" }, USERS).error).toBeTruthy();
    expect(validateShares({}, USERS).error).toBeTruthy();
    expect(validateShares({ u1: "x" }, USERS).error).toBeTruthy();
    expect(validateShares({ u1: "100" }, USERS).error).toBeUndefined();
  });

  it("previews each person's part like the server divides it", () => {
    const parts = sharePreview(10, [
      { userId: "b", shareBps: 5000 },
      { userId: "a", shareBps: 5000 },
    ]);
    expect([...parts.entries()]).toEqual([
      ["a", 5],
      ["b", 5],
    ]);
    const odd = sharePreview(1001, [
      { userId: "a", shareBps: 3333 },
      { userId: "b", shareBps: 3333 },
      { userId: "c", shareBps: 3334 },
    ]);
    expect([...odd.values()].reduce((a, b) => a + b, 0)).toBe(1001);
    expect([
      ...sharePreview(-1000, [{ userId: "a", shareBps: 10000 }]).values(),
    ]).toEqual([-1000]);
    expect(sharePreview(100, []).size).toBe(0);
  });
});

describe("creating", () => {
  it("builds a request in minor units with the person as payer", () => {
    const { body, errors } = buildCreateBody(
      draft({ payee: "  Example Service Ltd ", notes: "", assetId: "a1" }),
      USERS,
    );
    expect(errors).toEqual({});
    expect(body).toMatchObject({
      date: "2026-10-07",
      title: "Dishwasher repair",
      amountMinor: 18950,
      currency: "CHF",
      category: "repair",
      assetId: "a1",
      roomId: null,
      defectId: null,
      serviceLogId: null,
      payee: "Example Service Ltd",
      notes: null,
      paidByUserId: "u1",
      splitMode: "ownership",
      countsAsExpense: true,
      deductible: "unknown",
    });
    expect(body).not.toHaveProperty("shares");
  });

  it("sends shares only for a custom split", () => {
    const { body } = buildCreateBody(
      draft({ splitMode: "custom", shares: { u1: "25", u2: "75", u3: "" } }),
      USERS,
    );
    expect(body?.splitMode).toBe("custom");
    expect(body?.shares).toEqual([
      { userId: "u1", shareBps: 2500 },
      { userId: "u2", shareBps: 7500 },
    ]);
    const other = buildCreateBody(
      draft({ splitMode: "equal", shares: { u1: "25", u2: "75" } }),
      USERS,
    );
    expect(other.body).not.toHaveProperty("shares");
  });

  it("books a refund as a negative amount", () => {
    expect(
      buildCreateBody(draft({ refund: true }), USERS).body?.amountMinor,
    ).toBe(-18950);
  });

  it("points at every field that is wrong", () => {
    const { body, errors } = buildCreateBody(
      draft({
        title: "  ",
        amount: "abc",
        currency: "CH",
        date: "2026-02-31",
        splitMode: "custom",
        shares: { u1: "50" },
      }),
      USERS,
    );
    expect(body).toBeUndefined();
    expect(Object.keys(errors).sort()).toEqual([
      "currency",
      "date",
      "shares",
      "title",
    ]);
  });

  it("explains an amount that is not a number or zero", () => {
    expect(
      buildCreateBody(draft({ amount: "0" }), USERS).errors.amountMinor,
    ).toBeTruthy();
    expect(
      buildCreateBody(draft({ amount: "" }), USERS).errors.amountMinor,
    ).toBeTruthy();
  });

  it("lets a mortgage repayment stay out of the expenses by default", () => {
    const base = newDraft({
      today: "2026-10-07",
      currency: "CHF",
      paidByUserId: "",
      userIds: USERS,
    });
    expect(base.countsAsExpense).toBe(true);
    expect(base.paidByUserId).toBe("");
    const { body } = buildCreateBody(
      {
        ...base,
        title: "x",
        amount: "1",
        category: "mortgage_principal",
        countsAsExpense: false,
      },
      USERS,
    );
    expect(body?.countsAsExpense).toBe(false);
    expect(body?.paidByUserId).toBeNull();
  });
});

describe("editing", () => {
  it("sends nothing when nothing changed", () => {
    const e = entry();
    const result = buildUpdateBody(draftFromEntry(e, USERS), e, USERS);
    expect(result.errors).toEqual({});
    expect(result.body).toEqual({});
  });

  it("round-trips a refund", () => {
    const e = entry({ amountMinor: -1250 });
    const d = draftFromEntry(e, USERS);
    expect(d.refund).toBe(true);
    expect(d.amount).toBe("12.50");
    expect(buildUpdateBody(d, e, USERS).body).toEqual({});
  });

  it("sends only the changed fields and keeps the frozen split", () => {
    const e = entry();
    const d = draftFromEntry(e, USERS);
    d.amount = "200";
    d.payee = "Example Service Ltd";
    expect(buildUpdateBody(d, e, USERS).body).toEqual({
      amountMinor: 20000,
      payee: "Example Service Ltd",
    });
  });

  it("clears a link or text by sending null", () => {
    const e = entry({
      assetId: "a1",
      payee: "Example Service Ltd",
      notes: "n",
    });
    const d = draftFromEntry(e, USERS);
    d.assetId = "";
    d.payee = "";
    d.notes = "  ";
    expect(buildUpdateBody(d, e, USERS).body).toEqual({
      assetId: null,
      payee: null,
      notes: null,
    });
  });

  it("splits again only when the mode or the custom shares changed", () => {
    const e = entry();
    const changed = draftFromEntry(e, USERS);
    changed.splitMode = "equal";
    expect(buildUpdateBody(changed, e, USERS).body).toEqual({
      splitMode: "equal",
    });

    const toCustom = draftFromEntry(e, USERS);
    toCustom.splitMode = "custom";
    toCustom.shares = { u1: "50", u2: "50", u3: "" };
    expect(buildUpdateBody(toCustom, e, USERS).body).toEqual({
      splitMode: "custom",
      shares: [
        { userId: "u1", shareBps: 5000 },
        { userId: "u2", shareBps: 5000 },
      ],
    });

    const custom = entry({
      splitMode: "custom",
      shares: [
        { userId: "u1", userName: null, shareBps: 2500, amountMinor: 0 },
        { userId: "u2", userName: null, shareBps: 7500, amountMinor: 0 },
      ],
    });
    const same = draftFromEntry(custom, USERS);
    expect(buildUpdateBody(same, custom, USERS).body).toEqual({});
    same.shares = { u1: "30", u2: "70", u3: "" };
    expect(buildUpdateBody(same, custom, USERS).body).toEqual({
      shares: [
        { userId: "u1", shareBps: 3000 },
        { userId: "u2", shareBps: 7000 },
      ],
    });
  });

  it("starts a custom split from the frozen shares", () => {
    const d = draftFromEntry(entry(), USERS);
    expect(d.shares).toEqual({ u1: "60", u2: "40", u3: "" });
  });

  it("sends the expense flag along with a category change", () => {
    const e = entry();
    const d = draftFromEntry(e, USERS);
    d.category = "mortgage_principal";
    d.countsAsExpense = false;
    expect(buildUpdateBody(d, e, USERS).body).toEqual({
      category: "mortgage_principal",
      countsAsExpense: false,
    });
    d.countsAsExpense = true;
    d.countsTouched = true;
    expect(buildUpdateBody(d, e, USERS).body).toEqual({
      category: "mortgage_principal",
      countsAsExpense: true,
    });
  });

  it("does not follow a category change when the flag was set by hand", () => {
    const e = entry({ countsAsExpense: false });
    const d = draftFromEntry(e, USERS);
    expect(d.countsTouched).toBe(true);
    d.deductible = "maintenance";
    expect(buildUpdateBody(d, e, USERS).body).toEqual({
      deductible: "maintenance",
    });
  });

  it("reports a custom split that does not add up", () => {
    const e = entry();
    const d = draftFromEntry(e, USERS);
    d.splitMode = "custom";
    d.shares = { u1: "10", u2: "10", u3: "" };
    const result = buildUpdateBody(d, e, USERS);
    expect(result.body).toBeUndefined();
    expect(result.errors.shares).toBeTruthy();
  });
});
