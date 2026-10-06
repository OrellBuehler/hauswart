import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function keys(locale: string): string[] {
  const raw = readFileSync(`messages/${locale}.json`, "utf8");
  return Object.keys(JSON.parse(raw)).sort();
}

describe("messages", () => {
  it("has identical key sets in de and en", () => {
    const de = keys("de");
    const en = keys("en");
    expect(de.filter((k) => !en.includes(k))).toEqual([]);
    expect(en.filter((k) => !de.includes(k))).toEqual([]);
    expect(de).toEqual(en);
  });

  it("has no empty translations", () => {
    for (const locale of ["de", "en"]) {
      const messages = JSON.parse(
        readFileSync(`messages/${locale}.json`, "utf8"),
      ) as Record<string, string>;
      for (const [key, value] of Object.entries(messages)) {
        expect(value.trim(), `${locale}:${key}`).not.toBe("");
      }
    }
  });
});
