import { describe, expect, it } from "vitest";
import { ApiError } from "$lib/api/errors";
import { m } from "$lib/paraglide/messages";
import {
  chosenId,
  fittingMatches,
  matchFits,
  matchKey,
  matchQuery,
  matchTitle,
  matchWhen,
  tieFailure,
  tieRefused,
  type FinanceMatch,
  type MatchQuery,
} from "./matches";

function match(
  over: Partial<FinanceMatch["payload"]> = {},
  id = "s1",
): FinanceMatch {
  return {
    id,
    status: "pending",
    acceptedEntityId: null,
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-01T08:00:00.000Z",
    kind: "cost",
    payload: {
      source: "finance_transaction",
      date: "2026-10-12",
      amountMinor: 4550,
      currency: "CHF",
      title: "Beispiel Markt",
      payee: null,
      category: "groceries",
      url: null,
      assetId: null,
      bookId: null,
      ...over,
    },
  };
}

const query: MatchQuery = {
  amountMinor: 4550,
  currency: "CHF",
  date: "2026-10-12",
};

describe("what the form asks the bank for", () => {
  it("needs a valid amount, a currency and a real date before it asks", () => {
    const ready = { amountMinor: 4550, currency: "CHF", date: "2026-10-12" };
    expect(matchQuery(ready)).toEqual(query);
    expect(matchQuery({ ...ready, amountMinor: undefined })).toBeNull();
    expect(matchQuery({ ...ready, amountMinor: 0 })).toBeNull();
    expect(matchQuery({ ...ready, currency: "CH" })).toBeNull();
    expect(matchQuery({ ...ready, currency: "" })).toBeNull();
    expect(matchQuery({ ...ready, date: "" })).toBeNull();
    expect(matchQuery({ ...ready, date: "2026-02-30" })).toBeNull();
  });

  it("keeps the sign, so a refund asks for refunds", () => {
    expect(
      matchQuery({ amountMinor: -4550, currency: "CHF", date: "2026-10-12" })
        ?.amountMinor,
    ).toBe(-4550);
  });

  it("gives the same key to the same question", () => {
    expect(matchKey(query)).toBe(matchKey({ ...query }));
    expect(matchKey(query)).not.toBe(
      matchKey({ ...query, date: "2026-10-13" }),
    );
    expect(matchKey(null)).toBe("");
  });
});

describe("whether a transaction still fits the entry", () => {
  it.each<[string, Partial<FinanceMatch["payload"]>, boolean]>([
    ["the same amount and day", {}, true],
    ["three days after", { date: "2026-10-15" }, true],
    ["three days before", { date: "2026-10-09" }, true],
    ["four days after", { date: "2026-10-16" }, false],
    ["another amount", { amountMinor: 4551 }, false],
    ["a refund of the same size", { amountMinor: -4550 }, false],
    ["another currency", { currency: "EUR" }, false],
  ])("%s", (_name, over, fits) => {
    expect(matchFits(match(over), query)).toBe(fits);
  });

  it("keeps the order of the server and drops what no longer fits", () => {
    const list = [
      match({ date: "2026-10-12" }, "a"),
      match({ date: "2026-10-14" }, "b"),
      match({ date: "2026-10-20" }, "c"),
    ];
    expect(fittingMatches(list, query).map((x) => x.id)).toEqual(["a", "b"]);
    expect(fittingMatches(list, null)).toEqual([]);
    expect(
      fittingMatches(list, { ...query, date: "2026-10-20" }).map((x) => x.id),
    ).toEqual(["c"]);
  });

  it("sends a choice only while it fits", () => {
    const list = [match({}, "a"), match({ date: "2026-10-14" }, "b")];
    expect(chosenId("b", list, query)).toBe("b");
    expect(chosenId("b", list, { ...query, date: "2026-10-30" })).toBe("");
    expect(chosenId("b", list, { ...query, amountMinor: 1 })).toBe("");
    expect(chosenId("b", list, null)).toBe("");
    expect(chosenId("", list, query)).toBe("");
    expect(chosenId("zz", list, query)).toBe("");
  });
});

describe("the words for a match", () => {
  it("says how far the booking is from the entry's date", () => {
    expect(matchWhen(match({ date: "2026-10-12" }), query)).toBe(
      "am selben Tag",
    );
    expect(matchWhen(match({ date: "2026-10-13" }), query)).toBe(
      "1 Tag später",
    );
    expect(matchWhen(match({ date: "2026-10-15" }), query)).toBe(
      "3 Tage später",
    );
    expect(matchWhen(match({ date: "2026-10-11" }), query)).toBe(
      "1 Tag früher",
    );
    expect(matchWhen(match({ date: "2026-10-09" }), query)).toBe(
      "3 Tage früher",
    );
  });

  it("names the match by the bank's text, with the payee when it adds something", () => {
    expect(matchTitle(match())).toBe("Beispiel Markt");
    expect(matchTitle(match({ payee: "Beispiel Markt AG" }))).toBe(
      "Beispiel Markt · Beispiel Markt AG",
    );
    expect(matchTitle(match({ payee: "beispiel markt" }))).toBe(
      "Beispiel Markt",
    );
    expect(matchTitle(match({ title: "Karte 1234", payee: "Kiosk" }))).toBe(
      "Karte 1234 · Kiosk",
    );
  });
});

describe("why tying an entry was refused", () => {
  const decided = new ApiError("conflict", "decided", {
    status: 409,
    details: { code: "suggestion_decided" },
  });
  const field = new ApiError("invalid_request", "x", {
    status: 400,
    details: { body: { fieldErrors: { financeSuggestionId: ["x"] } } },
  });

  it("words a transaction that no longer fits, is gone or was decided", () => {
    expect(tieFailure(field, true)).toContain("passt nicht mehr");
    expect(tieFailure(new ApiError("not_found", "x"), true)).toContain(
      "nicht mehr",
    );
    expect(tieFailure(decided, true)).toContain("verarbeitet");
  });

  it("takes only a 409 about the suggestion for a decided transaction, not any other conflict", () => {
    for (const details of [
      { code: "idempotency_key_reused" },
      { code: "entry_tied" },
      { code: "receipt_task_closed", status: "done" },
      { fuelLogId: "f1" },
      undefined,
    ]) {
      const conflict = new ApiError("conflict", "x", { status: 409, details });
      expect(tieRefused(conflict, true), JSON.stringify(details)).toBe(
        undefined,
      );
      expect(tieFailure(conflict, true)).toBeUndefined();
    }
    expect(tieRefused(decided, true)).toBe("decided");
  });

  it("says nothing when no transaction was sent or the failure is about something else", () => {
    expect(tieFailure(field, false)).toBeUndefined();
    expect(tieFailure(decided, false)).toBeUndefined();
    expect(tieFailure(new ApiError("internal", "x"), true)).toBeUndefined();
    expect(
      tieFailure(
        new ApiError("invalid_request", "x", {
          details: { body: { fieldErrors: { title: ["x"] } } },
        }),
        true,
      ),
    ).toBeUndefined();
    expect(tieFailure(new Error("x"), true)).toBeUndefined();
  });
});

describe("the wording of the offer to link", () => {
  it("agrees in number in German", () => {
    expect(m.match_description({ count: 1 }, { locale: "de" })).toBe(
      "Eine Buchung deiner Finanz-App hat denselben Betrag. Verknüpfe sie mit diesem Eintrag, damit sie nicht noch einmal vorgeschlagen wird. Tippe sie erneut an, um sie nicht zu verknüpfen.",
    );
    expect(m.match_description({ count: 3 }, { locale: "de" })).toBe(
      "3 Buchungen deiner Finanz-App haben denselben Betrag. Verknüpfe die passende mit diesem Eintrag, damit sie nicht noch einmal vorgeschlagen wird. Tippe sie erneut an, um sie nicht zu verknüpfen.",
    );
  });

  it("names the one to link in English as well", () => {
    expect(m.match_description({ count: 1 }, { locale: "en" })).toBe(
      "A booking in your finance app has the same amount. Link it to this entry so it is not suggested again. Tap it again to leave it unlinked.",
    );
    expect(m.match_description({ count: 2 }, { locale: "en" })).toBe(
      "2 bookings in your finance app have the same amount. Link the matching one to this entry so it is not suggested again. Tap it again to leave it unlinked.",
    );
  });

  it("quotes titles with typographic quotes in English, as the other finance messages do", () => {
    expect(
      m.finance_accepted_link_toast({ title: "X" }, { locale: "en" }),
    ).toBe("“X” linked to the entry.");
    expect(
      m.finance_dismiss_link_description({ title: "X" }, { locale: "en" }),
    ).toBe(
      "“X” will not be linked to the entry; it is offered as a booking again instead.",
    );
  });
});
