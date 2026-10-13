import { describe, expect, it } from "vitest";
import { nameKey } from "./names";

describe("nameKey", () => {
  it.each<[string, string, string]>([
    ["case in ASCII", "Ferien", "FERIEN"],
    ["case of an umlaut", "Übernachtung", "übernachtung"],
    ["a composed and a decomposed umlaut", "Übernachtung", "Übernachtung"],
    ["a decomposed umlaut in lower case", "übernachtung", "ÜBERNACHTUNG"],
    ["spaces around the name", "Ferien", "  Ferien "],
    ["accents", "Café", "CAFÉ"],
  ])("is the same for %s", (_name, a, b) => {
    expect(nameKey(a)).toBe(nameKey(b));
  });

  it.each<[string, string, string]>([
    ["letters with and without an umlaut", "Übernachtung", "Ubernachtung"],
    ["a sharp s and ss", "Strasse", "Straße"],
    ["other words", "Ferien", "Ferienhaus"],
  ])("tells %s apart", (_name, a, b) => {
    expect(nameKey(a)).not.toBe(nameKey(b));
  });
});
