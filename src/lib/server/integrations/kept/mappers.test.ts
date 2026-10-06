import { describe, expect, it } from "vitest";
import {
  SEED_TEXT_MAX,
  billTitle,
  billToTaskSeed,
  taskStatusOf,
  transactionToAssetSuggestion,
  transactionToCostSeed,
  type KeptBill,
} from "./index";
import { fakeBill, fakeTransaction } from "./fake-server";

describe("billToTaskSeed", () => {
  it("maps the fields of an open invoice", () => {
    const bill = fakeBill({
      id: "bill-1",
      remainingAmount: 7345,
      paidAmount: 5000,
      status: "partially_paid",
    });
    expect(billToTaskSeed(bill)).toEqual({
      externalRef: "bill-1",
      title: "Muster Verwaltung AG: INV-2026-17",
      dueDate: "2026-10-01",
      amountMinor: 12345,
      remainingMinor: 7345,
      currency: "CHF",
      status: "open",
      kind: "invoice",
      url: "https://kept.example.org/bills/bill-1",
    });
  });

  it("keeps a bill without amount or due date", () => {
    const seed = billToTaskSeed(
      fakeBill({ amount: null, remainingAmount: null, dueDate: null }),
    );
    expect(seed.amountMinor).toBeNull();
    expect(seed.remainingMinor).toBeNull();
    expect(seed.dueDate).toBeNull();
  });

  const statusCases: Array<
    [string, Partial<KeptBill>, ReturnType<typeof taskStatusOf>]
  > = [
    ["open", { status: "open" }, "open"],
    ["partially paid", { status: "partially_paid" }, "open"],
    ["open and overdue", { status: "open", overdue: true }, "overdue"],
    [
      "partially paid and overdue",
      { status: "partially_paid", overdue: true },
      "overdue",
    ],
    ["paid", { status: "paid" }, "paid"],
    ["overpaid invoice", { status: "overpaid" }, "paid"],
    ["invoice awaiting refund", { status: "credit_due" }, "paid"],
    ["cancelled", { status: "cancelled" }, "cancelled"],
    [
      "cancelled and flagged overdue",
      { status: "cancelled", overdue: true },
      "cancelled",
    ],
    ["credit note, open", { kind: "credit_note", status: "open" }, "paid"],
    [
      "credit note, flagged overdue",
      { kind: "credit_note", status: "open", overdue: true },
      "paid",
    ],
    [
      "credit note, credit due",
      { kind: "credit_note", status: "credit_due" },
      "paid",
    ],
    [
      "cancelled credit note",
      { kind: "credit_note", status: "cancelled" },
      "cancelled",
    ],
  ];
  it.each(statusCases)("status: %s", (_name, over, expected) => {
    expect(taskStatusOf(fakeBill(over))).toBe(expected);
    expect(billToTaskSeed(fakeBill(over)).status).toBe(expected);
  });

  describe("title", () => {
    const cases: Array<[string | null, string | null, string]> = [
      ["Muster Verwaltung AG", "INV-1", "Muster Verwaltung AG: INV-1"],
      ["Muster Verwaltung AG", null, "Muster Verwaltung AG"],
      ["Muster Verwaltung AG", "   ", "Muster Verwaltung AG"],
      [null, "INV-1", "?: INV-1"],
      [null, null, "?"],
      ["  Muster \n AG ", " INV-1 ", "Muster AG: INV-1"],
      ["", "", "?"],
    ];
    it.each(cases)("%j + %j", (creditorName, invoiceNumber, expected) => {
      expect(billTitle(fakeBill({ creditorName, invoiceNumber }))).toBe(
        expected,
      );
    });

    it("is clipped to the seed text limit", () => {
      const title = billTitle(fakeBill({ creditorName: "A".repeat(500) }));
      expect([...title]).toHaveLength(SEED_TEXT_MAX);
      expect(title.endsWith("…")).toBe(true);
    });
  });
});

describe("transactionToCostSeed", () => {
  const map = { "cat-housing": "rent", "cat-energy": "utilities" } as const;

  it("maps an expense to a positive amount and carries the references", () => {
    const tx = fakeTransaction({
      id: "tx-1",
      categoryId: "cat-energy",
      amount: -12345,
      bookingDate: "2026-09-20",
      billIds: ["bill-1", "bill-2"],
      counterpartyName: " Muster Energie AG ",
      description: "Strom  Q3",
    });
    const seed = transactionToCostSeed(tx, map);
    expect(seed).toEqual({
      externalRef: "tx-1",
      date: "2026-09-20",
      amountMinor: 12345,
      currency: "CHF",
      payee: "Muster Energie AG",
      description: "Strom Q3",
      category: "utilities",
      billIds: ["bill-1", "bill-2"],
      url: tx.url,
    });
    expect(seed!.billIds).not.toBe(tx.billIds);
  });

  it("maps a refund to a negative amount and zero to plain zero", () => {
    const refund = transactionToCostSeed(
      fakeTransaction({ categoryId: "cat-housing", amount: 2500 }),
      map,
    );
    expect(refund!.amountMinor).toBe(-2500);
    const zero = transactionToCostSeed(
      fakeTransaction({ categoryId: "cat-housing", amount: 0 }),
      map,
    );
    expect(Object.is(zero!.amountMinor, 0)).toBe(true);
  });

  it("returns null for unmapped, missing and inherited categories", () => {
    expect(
      transactionToCostSeed(fakeTransaction({ categoryId: "cat-other" }), map),
    ).toBeNull();
    expect(
      transactionToCostSeed(fakeTransaction({ categoryId: null }), map),
    ).toBeNull();
    for (const key of [
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
    ]) {
      expect(
        transactionToCostSeed(fakeTransaction({ categoryId: key }), map),
        key,
      ).toBeNull();
    }
    expect(
      transactionToCostSeed(fakeTransaction({ categoryId: "cat-housing" }), {}),
    ).toBeNull();
  });

  it("normalises blank text to null", () => {
    const seed = transactionToCostSeed(
      fakeTransaction({
        categoryId: "cat-housing",
        counterpartyName: null,
        description: "  ",
      }),
      map,
    );
    expect(seed).toMatchObject({ payee: null, description: null });
  });
});

describe("transactionToAssetSuggestion", () => {
  const purchase = new Set(["cat-purchases"]);
  const base = {
    id: "tx-1",
    categoryId: "cat-purchases",
    amount: -89900,
    bookingDate: "2026-09-12",
    description: "Waschmaschine XL",
    counterpartyName: "Beispiel Elektro AG",
  };

  it("suggests a large purchase in a purchase category", () => {
    const tx = fakeTransaction(base);
    expect(transactionToAssetSuggestion(tx, purchase)).toEqual({
      externalRef: "tx-1",
      name: "Waschmaschine XL",
      purchaseDate: "2026-09-12",
      priceMinor: 89900,
      currency: "CHF",
      url: tx.url,
    });
  });

  it("accepts an array of category ids", () => {
    expect(
      transactionToAssetSuggestion(fakeTransaction(base), ["cat-purchases"]),
    ).not.toBeNull();
  });

  it("uses the threshold inclusively, default CHF 100", () => {
    const at = (amount: number) => fakeTransaction({ ...base, amount });
    expect(transactionToAssetSuggestion(at(-9999), purchase)).toBeNull();
    expect(transactionToAssetSuggestion(at(-10000), purchase)).not.toBeNull();
    expect(
      transactionToAssetSuggestion(at(-20000), purchase, {
        minPriceMinor: 20001,
      }),
    ).toBeNull();
    expect(
      transactionToAssetSuggestion(at(-500), purchase, { minPriceMinor: 500 }),
    ).not.toBeNull();
  });

  it("ignores refunds, income, other categories and uncategorised payments", () => {
    expect(
      transactionToAssetSuggestion(
        fakeTransaction({ ...base, amount: 89900 }),
        purchase,
      ),
    ).toBeNull();
    expect(
      transactionToAssetSuggestion(
        fakeTransaction({ ...base, amount: 0 }),
        purchase,
      ),
    ).toBeNull();
    expect(
      transactionToAssetSuggestion(
        fakeTransaction({ ...base, categoryId: "cat-food" }),
        purchase,
      ),
    ).toBeNull();
    expect(
      transactionToAssetSuggestion(
        fakeTransaction({ ...base, categoryId: null }),
        purchase,
      ),
    ).toBeNull();
    expect(
      transactionToAssetSuggestion(fakeTransaction(base), new Set()),
    ).toBeNull();
    expect(transactionToAssetSuggestion(fakeTransaction(base), [])).toBeNull();
  });

  it("names it after the description, else the counterparty, else gives up", () => {
    expect(
      transactionToAssetSuggestion(
        fakeTransaction({ ...base, description: null }),
        purchase,
      )!.name,
    ).toBe("Beispiel Elektro AG");
    expect(
      transactionToAssetSuggestion(
        fakeTransaction({ ...base, description: "  " }),
        purchase,
      )!.name,
    ).toBe("Beispiel Elektro AG");
    expect(
      transactionToAssetSuggestion(
        fakeTransaction({ ...base, description: null, counterpartyName: null }),
        purchase,
      ),
    ).toBeNull();
  });

  it("clips a long name", () => {
    const s = transactionToAssetSuggestion(
      fakeTransaction({ ...base, description: "x".repeat(400) }),
      purchase,
    )!;
    expect([...s.name]).toHaveLength(SEED_TEXT_MAX);
  });
});
