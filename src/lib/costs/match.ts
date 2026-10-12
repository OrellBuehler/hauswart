import { diffDays } from "../dates";

/**
 * Whether a transaction of a finance system is the cost entry somebody booked by hand. The rule is deliberately plain:
 *
 * 1. the same amount (sign included: a refund never matches an expense) in the same currency,
 * 2. a booking date at most `MATCH_DAYS` days from the entry's date (a bank books a day or two after the purchase),
 * 3. similar text: the words of title and payee on both sides share at least `MATCH_MIN_SIMILARITY` of the words of the
 *    shorter side (the overlap coefficient, so a short "Migros" is found inside a long bank text).
 *
 * Words are lower case with umlauts spelled as people and banks write them (`Zürich`, `Zuerich`), other accents
 * removed, split at everything that is not a letter or digit. Single characters, numbers of up to four digits (years,
 * house numbers) and a few fillers and legal forms (`AG`, `GmbH`, `und`) carry no weight. No typo tolerance, no stemming.
 */
export const MATCH_DAYS = 3;
export const MATCH_MIN_SIMILARITY = 0.5;

const FILLERS = new Set([
  "ag",
  "gmbh",
  "sa",
  "sarl",
  "ltd",
  "llc",
  "inc",
  "kg",
  "und",
  "and",
  "the",
  "der",
  "die",
  "das",
  "fuer",
  "for",
  "von",
  "bei",
  "zum",
  "zur",
  "mit",
  "nach",
]);

const UMLAUTS: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  ß: "ss",
};

/** The words of a text that count for a match (see the rule above). */
export function matchTokens(text: string): Set<string> {
  const folded = text
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => UMLAUTS[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
  const out = new Set<string>();
  for (const word of folded.split(/[^a-z0-9]+/)) {
    if (word.length < 2) continue;
    if (/^\d{1,4}$/.test(word)) continue;
    if (FILLERS.has(word)) continue;
    out.add(word);
  }
  return out;
}

/** 0 to 1: the words two texts share, as a part of the words of the shorter one; 0 when either has none. */
export function textSimilarity(a: string, b: string): number {
  const left = matchTokens(a);
  const right = matchTokens(b);
  const smaller = Math.min(left.size, right.size);
  if (smaller === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / smaller;
}

/** The facts of one side of a match: a cost entry or a transaction offered as a cost. */
export interface MatchSide {
  amountMinor: number;
  currency: string;
  /** `YYYY-MM-DD` */
  date: string;
  title: string;
  payee: string | null;
}

const textOf = (side: MatchSide) => `${side.title} ${side.payee ?? ""}`;

/** How alike the texts of two sides are, 0 to 1 (see `textSimilarity`). */
export function matchSimilarity(a: MatchSide, b: MatchSide): number {
  return textSimilarity(textOf(a), textOf(b));
}

export function transactionMatchesEntry(
  entry: MatchSide,
  transaction: MatchSide,
): boolean {
  return (
    entry.amountMinor === transaction.amountMinor &&
    entry.currency === transaction.currency &&
    Math.abs(diffDays(entry.date, transaction.date)) <= MATCH_DAYS &&
    matchSimilarity(entry, transaction) >= MATCH_MIN_SIMILARITY
  );
}
