import { describe, expect, it } from "vitest";
import {
  MATCH_DAYS,
  MATCH_MIN_SIMILARITY,
  matchTokens,
  textSimilarity,
  transactionMatchesEntry,
  type MatchSide,
} from "./match";

describe("matchTokens", () => {
  it.each<[string, string, string[]]>([
    [
      "lower case words",
      "Beispiel Markt Zürich",
      ["beispiel", "markt", "zuerich"],
    ],
    [
      "umlauts as people and banks write them",
      "Käse Café Größe",
      ["kaese", "cafe", "groesse"],
    ],
    [
      "punctuation and repeated spaces split words",
      "MUSTER-Laden,  Bern/HB",
      ["muster", "laden", "bern", "hb"],
    ],
    ["single characters are dropped", "a b Müller", ["mueller"]],
    [
      "short numbers (years, house numbers) are dropped, long ones kept",
      "Rechnung 2026 Nr 20260412",
      ["rechnung", "nr", "20260412"],
    ],
    [
      "legal forms and filler words are dropped",
      "Muster AG und Söhne GmbH",
      ["muster", "soehne"],
    ],
    ["every word once", "Markt markt MARKT", ["markt"]],
    ["nothing at all", "  ", []],
  ])("%s", (_name, text, expected) => {
    expect([...matchTokens(text)].sort()).toEqual([...expected].sort());
  });
});

describe("textSimilarity", () => {
  it.each<[string, string, string, number]>([
    ["the same text", "Beispiel Markt Zürich", "Beispiel Markt Zürich", 1],
    ["another spelling of the same text", "Café Zürich", "CAFE ZUERICH", 1],
    [
      "a short text inside a long bank text",
      "Beispiel Markt",
      "BEISPIEL MARKT ZUERICH HB 1234 CH",
      1,
    ],
    ["one of two words on both sides", "Einkauf Markt", "MARKT ZH", 0.5],
    ["one of two and three words", "Einkauf Markt", "Markt Zürich HB", 0.5],
    [
      "one of three words on both sides",
      "Einkauf Markt Bern",
      "Markt Zürich HB",
      1 / 3,
    ],
    ["nothing in common", "Elektro Müller", "Beispiel Energie", 0],
    ["only a legal form in common", "Muster AG", "Beispiel AG", 0],
    ["only a year in common", "Strom 2026", "Telefon 2026", 0],
    [
      "a long reference in common",
      "Rechnung 20260412",
      "Zahlung 20260412",
      0.5,
    ],
    ["no text on one side", "", "Beispiel Markt", 0],
    ["no text on either side", "", "", 0],
  ])("%s", (_name, a, b, expected) => {
    expect(textSimilarity(a, b)).toBeCloseTo(expected, 10);
    expect(textSimilarity(b, a)).toBeCloseTo(expected, 10);
  });
});

const side = (over: Partial<MatchSide> = {}): MatchSide => ({
  amountMinor: 4250,
  currency: "CHF",
  date: "2026-06-10",
  title: "Einkauf Beispiel Markt",
  payee: null,
  ...over,
});

describe("transactionMatchesEntry", () => {
  it("the thresholds are the documented ones", () => {
    expect(MATCH_DAYS).toBe(3);
    expect(MATCH_MIN_SIMILARITY).toBe(0.5);
  });

  it.each<[string, Partial<MatchSide>, Partial<MatchSide>, boolean]>([
    ["the same day, amount and text", {}, {}, true],
    ["three days later", {}, { date: "2026-06-13" }, true],
    ["three days earlier", {}, { date: "2026-06-07" }, true],
    ["four days later", {}, { date: "2026-06-14" }, false],
    ["four days earlier", {}, { date: "2026-06-06" }, false],
    [
      "three days across a month end",
      { date: "2026-06-29" },
      { date: "2026-07-02" },
      true,
    ],
    [
      "four days across a month end",
      { date: "2026-06-29" },
      { date: "2026-07-03" },
      false,
    ],
    [
      "three days across a leap day",
      { date: "2028-02-27" },
      { date: "2028-03-01" },
      true,
    ],
    ["an amount one minor unit off", {}, { amountMinor: 4251 }, false],
    ["another currency", {}, { currency: "EUR" }, false],
    ["the same amount as a refund", {}, { amountMinor: -4250 }, false],
    [
      "a refund on both sides",
      { amountMinor: -4250 },
      { amountMinor: -4250 },
      true,
    ],
    ["text at the threshold", {}, { title: "Markt Zürich" }, true],
    [
      "text below the threshold",
      { title: "Einkauf Beispiel Markt Bern" },
      { title: "Markt Zürich HB" },
      false,
    ],
    [
      "another shop",
      {},
      { title: "Muster Laden", payee: "Muster Laden" },
      false,
    ],
    [
      "the payee carries the match",
      {},
      { title: "Karte 1234", payee: "Einkauf Beispiel Markt" },
      true,
    ],
    ["no text on the bank side", {}, { title: "", payee: null }, false],
    ["no text on the entry side", { title: "" }, {}, false],
  ])("%s", (_name, entry, tx, expected) => {
    expect(transactionMatchesEntry(side(entry), side(tx))).toBe(expected);
  });

  it("is symmetric in its two sides", () => {
    const a = side();
    const b = side({ date: "2026-06-12", title: "BEISPIEL MARKT ZUERICH" });
    expect(transactionMatchesEntry(a, b)).toBe(transactionMatchesEntry(b, a));
  });
});
