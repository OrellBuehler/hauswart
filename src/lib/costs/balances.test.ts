import { describe, expect, it } from "vitest";
import type { CostBalances } from "$lib/api/schemas/costs";
import {
  balanceState,
  balanceTone,
  balanceWording,
  crossBookNote,
  hasBalanceData,
  paymentSentence,
  personName,
  personOf,
  viewerLine,
  youWording,
} from "./balances";

/** Intl separates the currency from the number with a no-break space. */
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");

function person(
  userId: string,
  over: Partial<CostBalances["people"][number]> = {},
): CostBalances["people"][number] {
  return {
    userId,
    userName: userId,
    paidMinor: 0,
    shareMinor: 0,
    sentMinor: 0,
    receivedMinor: 0,
    balanceMinor: 0,
    ...over,
  };
}

describe("balance tone", () => {
  it("is credit when the others owe the person, debit when the person owes", () => {
    expect(balanceTone(1)).toBe("credit");
    expect(balanceTone(-1)).toBe("debit");
    expect(balanceTone(0)).toBe("even");
  });
});

describe("balance wording", () => {
  it("says what a positive, negative and zero balance means", () => {
    const credit = balanceWording(2500, "CHF");
    expect(credit.tone).toBe("credit");
    expect(plain(credit.text)).toBe("bekommt CHF 25.00");
    const debit = balanceWording(-1250, "CHF");
    expect(debit.tone).toBe("debit");
    expect(plain(debit.text)).toBe("schuldet CHF 12.50");
    expect(balanceWording(0, "CHF")).toEqual({
      tone: "even",
      text: "ausgeglichen",
    });
  });

  it("never shows a minus sign: the verb carries the direction", () => {
    expect(balanceWording(-5, "CHF").text).not.toContain("-");
    expect(youWording(-5, "CHF").text).not.toContain("-");
  });

  it("speaks to the viewer", () => {
    expect(plain(youWording(2500, "CHF").text)).toBe("Du bekommst CHF 25.00");
    expect(plain(youWording(-1250, "CHF").text)).toBe("Du schuldest CHF 12.50");
    expect(youWording(0, "CHF").text).toBe("Du bist ausgeglichen");
  });

  it("uses the currency's own precision", () => {
    const yen = balanceWording(1500, "JPY").text;
    expect(yen).toContain("500");
    expect(yen).not.toMatch(/[.,]\d{2}$/);
  });
});

describe("paymentSentence", () => {
  it("reads like the suggestion on screen", () => {
    expect(
      plain(
        paymentSentence(
          { fromName: "Anna", toName: "Ben", amountMinor: 1250 },
          "CHF",
        ),
      ),
    ).toBe("Anna schuldet Ben CHF 12.50");
  });

  it("names a person the API could not name", () => {
    expect(personName(null)).toBe("Unbekannt");
    expect(personName("Cara")).toBe("Cara");
    expect(
      paymentSentence(
        { fromName: null, toName: "Ben", amountMinor: 100 },
        "CHF",
      ),
    ).toContain("Unbekannt");
  });
});

describe("balance state", () => {
  it("is empty before anything was shared or paid", () => {
    const people = [person("a"), person("b")];
    expect(hasBalanceData({ people })).toBe(false);
    expect(balanceState({ people, suggestedPayments: [] })).toBe("empty");
  });

  it("is square when there is history and nobody owes anything", () => {
    const people = [
      person("a", { paidMinor: 1000, shareMinor: 500, receivedMinor: 500 }),
      person("b", { paidMinor: 0, shareMinor: 500, sentMinor: 500 }),
    ];
    expect(balanceState({ people, suggestedPayments: [] })).toBe("square");
  });

  it("counts a recorded payment alone as history", () => {
    expect(hasBalanceData({ people: [person("a", { sentMinor: 1 })] })).toBe(
      true,
    );
  });

  it("is open as soon as a payment is suggested", () => {
    const payment = {
      fromUserId: "b",
      fromName: "b",
      toUserId: "a",
      toName: "a",
      amountMinor: 500,
    };
    expect(
      balanceState({ people: [person("a")], suggestedPayments: [payment] }),
    ).toBe("open");
  });
});

describe("personOf", () => {
  it("finds the viewer among the people", () => {
    const people = [person("a"), person("b", { balanceMinor: 7 })];
    expect(personOf({ people }, "b")?.balanceMinor).toBe(7);
    expect(personOf({ people }, "zz")).toBeUndefined();
  });
});

describe("viewerLine", () => {
  const payment = {
    fromUserId: "b",
    fromName: "b",
    toUserId: "a",
    toName: "a",
    amountMinor: 500,
  };

  it("speaks to the viewer once there is something to settle", () => {
    const balances = {
      currency: "CHF",
      people: [
        person("a", { balanceMinor: 500 }),
        person("b", { balanceMinor: -500 }),
      ],
      suggestedPayments: [payment],
    };
    expect(plain(viewerLine(balances, "a")?.text ?? "")).toBe(
      "Du bekommst CHF 5.00",
    );
    expect(plain(viewerLine(balances, "b")?.text ?? "")).toBe(
      "Du schuldest CHF 5.00",
    );
  });

  it("says nothing before anything happened or for somebody unknown", () => {
    const empty = {
      currency: "CHF",
      people: [person("a")],
      suggestedPayments: [],
    };
    expect(viewerLine(empty, "a")).toBeNull();
    expect(
      viewerLine({ ...empty, suggestedPayments: [payment] }, "zz"),
    ).toBeNull();
  });

  it("says square when there is history and nobody owes anything", () => {
    const square = {
      currency: "CHF",
      people: [person("a", { paidMinor: 10, shareMinor: 10 })],
      suggestedPayments: [],
    };
    expect(viewerLine(square, "a")).toEqual({
      tone: "even",
      text: "Du bist ausgeglichen",
    });
  });
});

describe("crossBookNote", () => {
  const view = (
    crossBookSettlements: CostBalances["crossBookSettlements"],
  ): Pick<CostBalances, "crossBookSettlements" | "currency"> => ({
    crossBookSettlements,
    currency: "CHF",
  });

  it("says how many payments across all books a single book's balances leave out, and what they add up to", () => {
    expect(
      plain(crossBookNote(view({ count: 1, totalMinor: 5000 })) ?? ""),
    ).toBe(
      "1 Zahlung über alle Bücher (CHF 50.00) ist hier nicht eingerechnet.",
    );
    expect(
      plain(crossBookNote(view({ count: 3, totalMinor: 12550 })) ?? ""),
    ).toBe(
      "3 Zahlungen über alle Bücher (zusammen CHF 125.50) sind hier nicht eingerechnet.",
    );
  });

  it("has nothing to say in the view of all books, or when there are no such payments", () => {
    expect(crossBookNote(view(null))).toBeNull();
    expect(crossBookNote(view({ count: 0, totalMinor: 0 }))).toBeNull();
  });
});
