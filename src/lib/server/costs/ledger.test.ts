import { describe, expect, it } from "vitest";
import { bookEntry, bookSettlement, newLedger, personBalances } from "./ledger";

const people = [
  { id: "u1", name: "Anna" },
  { id: "u2", name: "Ben" },
  { id: "u3", name: "Carl" },
];
const half = [
  { userId: "u1", shareBps: 5000 },
  { userId: "u2", shareBps: 5000 },
];
const thirds = [
  { userId: "u1", shareBps: 3334 },
  { userId: "u2", shareBps: 3333 },
  { userId: "u3", shareBps: 3333 },
];

const balances = (ledger: ReturnType<typeof newLedger>) =>
  Object.fromEntries(
    personBalances(ledger, people).map((p) => [p.userId, p.balanceMinor]),
  );

describe("the ledger", () => {
  it("is square when empty", () => {
    expect(balances(newLedger())).toEqual({ u1: 0, u2: 0, u3: 0 });
  });

  it.each([
    {
      name: "an equal split between two",
      entry: {
        amountMinor: 10000,
        splitMode: "equal" as const,
        paidByUserId: "u1",
      },
      shares: half,
      expected: { u1: 5000, u2: -5000, u3: 0 },
    },
    {
      name: "thirds, the odd cent to the first share",
      entry: {
        amountMinor: 100,
        splitMode: "equal" as const,
        paidByUserId: "u2",
      },
      shares: thirds,
      expected: { u1: -34, u2: 67, u3: -33 },
    },
    {
      name: "a refund, which gives back what the expense took",
      entry: {
        amountMinor: -101,
        splitMode: "equal" as const,
        paidByUserId: "u1",
      },
      shares: half,
      expected: { u1: -50, u2: 50, u3: 0 },
    },
    {
      name: "payer who bears nothing of it",
      entry: {
        amountMinor: 900,
        splitMode: "equal" as const,
        paidByUserId: "u3",
      },
      shares: half,
      expected: { u1: -450, u2: -450, u3: 900 },
    },
  ])("books $name", ({ entry, shares, expected }) => {
    const ledger = newLedger();
    bookEntry(ledger, entry, shares);
    expect(balances(ledger)).toEqual(expected);
    expect(Object.values(balances(ledger)).reduce((a, b) => a + b, 0)).toBe(0);
    expect(ledger.unassigned).toBe(0);
  });

  it("leaves out an entry that is not split, and counts a split one without a payer", () => {
    const ledger = newLedger();
    bookEntry(
      ledger,
      { amountMinor: 500, splitMode: "none", paidByUserId: "u1" },
      [],
    );
    bookEntry(
      ledger,
      { amountMinor: 500, splitMode: "equal", paidByUserId: "u1" },
      [],
    );
    expect(balances(ledger)).toEqual({ u1: 0, u2: 0, u3: 0 });
    expect(ledger.unassigned).toBe(0);
    bookEntry(
      ledger,
      { amountMinor: 500, splitMode: "equal", paidByUserId: null },
      half,
    );
    expect(balances(ledger)).toEqual({ u1: 0, u2: 0, u3: 0 });
    expect(ledger.unassigned).toBe(1);
  });

  it("moves the balances with a payment: the one who pays gains, the one who receives loses", () => {
    const ledger = newLedger();
    bookEntry(
      ledger,
      { amountMinor: 10000, splitMode: "equal", paidByUserId: "u1" },
      half,
    );
    bookSettlement(ledger, {
      fromUserId: "u2",
      toUserId: "u1",
      amountMinor: 3000,
    });
    expect(balances(ledger)).toEqual({ u1: 2000, u2: -2000, u3: 0 });
    bookSettlement(ledger, {
      fromUserId: "u2",
      toUserId: "u1",
      amountMinor: 2000,
    });
    expect(balances(ledger)).toEqual({ u1: 0, u2: 0, u3: 0 });
    const rows = personBalances(ledger, people);
    expect(rows.find((p) => p.userId === "u2")).toMatchObject({
      paidMinor: 0,
      shareMinor: 5000,
      sentMinor: 5000,
      receivedMinor: 0,
      balanceMinor: 0,
    });
  });

  it("lists people by name, then id, whatever order they come in", () => {
    const rows = personBalances(newLedger(), [
      { id: "b", name: "Zora" },
      { id: "z", name: null },
      { id: "a", name: "Anna" },
      { id: "c", name: "Anna" },
    ]);
    expect(rows.map((r) => r.userId)).toEqual(["z", "a", "c", "b"]);
  });
});
