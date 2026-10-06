import { describe, expect, it } from "vitest";
import { createAssetRequestSchema } from "$lib/api/schemas/assets";
import { createCostRequestSchema } from "$lib/api/schemas/costs";
import { createAsset } from "$lib/server/assets/assets";
import { createTestUser } from "$lib/testing/auth";
import { ctxAt } from "$lib/testing/domain";
import { useTestDB } from "$lib/testing/db";
import { createCost } from "./costs";
import { CSV_BOM, CSV_COLUMNS, costsCsv, csvAmount, csvField } from "./csv";

describe("csvField", () => {
  it("passes plain text through", () => {
    expect(csvField("Reparatur Küche")).toBe("Reparatur Küche");
    expect(csvField(null)).toBe("");
    expect(csvField("")).toBe("");
  });

  it("quotes separators, quotes and line breaks", () => {
    expect(csvField("a;b")).toBe('"a;b"');
    expect(csvField('Er sagte "ja"')).toBe('"Er sagte ""ja"""');
    expect(csvField("zwei\nZeilen")).toBe('"zwei\nZeilen"');
    expect(csvField("a\r\nb")).toBe('"a\r\nb"');
    // a comma is not a separator here
    expect(csvField("1,5 kg")).toBe("1,5 kg");
  });

  it.each(["=SUM(A1:A9)", "+1+1", "-2+3", "@cmd", "\tx", "\rx"])(
    "defuses a spreadsheet formula: %j",
    (text) => {
      const out = csvField(text);
      expect(out.replace(/^"/, "").startsWith("'")).toBe(true);
    },
  );

  it("keeps a formula-looking text that is quoted safe too", () => {
    expect(csvField('=HYPERLINK("http://x";"y")')).toBe(
      `"'=HYPERLINK(""http://x"";""y"")"`,
    );
  });
});

describe("csvAmount", () => {
  it("is a plain decimal with a point, no thousands separator, in the currency's precision", () => {
    expect(csvAmount(194975, "CHF")).toBe("1949.75");
    expect(csvAmount(-1250, "CHF")).toBe("-12.50");
    expect(csvAmount(5, "CHF")).toBe("0.05");
    expect(csvAmount(100000000, "CHF")).toBe("1000000.00");
    expect(csvAmount(1500, "JPY")).toBe("1500");
    expect(csvAmount(1234, "KWD")).toBe("1.234");
  });
});

describe("costsCsv", () => {
  const test = useTestDB();
  const ctx = () => ctxAt(test.db);

  it("starts with a byte order mark, a semicolon header and CRLF line ends", () => {
    const text = costsCsv(ctx(), 2026);
    expect(text.startsWith(CSV_BOM)).toBe(true);
    expect(text).toBe(`${CSV_BOM}${CSV_COLUMNS.join(";")}\r\n`);
    expect(new TextEncoder().encode(text).slice(0, 3)).toEqual(
      new Uint8Array([0xef, 0xbb, 0xbf]),
    );
  });

  it("writes one line per entry of the year, oldest first, with exact decimals", async () => {
    const a = await createTestUser({ displayName: "Anna" });
    const asset = createAsset(
      ctx(),
      createAssetRequestSchema.parse({ kind: "device", name: "Heizung; alt" }),
    );
    const book = (over: Record<string, unknown>) =>
      createCost(
        ctx(),
        createCostRequestSchema.parse({
          title: "x",
          amountMinor: 100,
          category: "repair",
          ...over,
        }),
        a.id,
      );
    book({
      title: "Service",
      date: "2026-05-01",
      amountMinor: 194975,
      assetId: asset.id,
      payee: 'Muster "AG"',
      paidByUserId: a.id,
      deductible: "maintenance",
      notes: "Zeile 1\nZeile 2",
    });
    book({
      title: "=cmd|' /C calc'!A0",
      date: "2026-01-02",
      amountMinor: -1250,
      splitMode: "none",
    });
    book({ title: "Letztes Jahr", date: "2025-12-31" });
    book({
      title: "Kredit",
      date: "2026-06-30",
      amountMinor: 500000,
      category: "mortgage_principal",
    });

    const text = costsCsv(ctx(), 2026);
    const lines = text.slice(1).split("\r\n");
    expect(lines.pop()).toBe("");
    // the note's line break lives inside a quoted field
    const records = text
      .slice(1)
      .match(/(?:[^\r\n"]|"(?:[^"]|"")*")+(?:\r\n|$)/g)!;
    expect(records.filter((r) => r !== "")).toHaveLength(4);
    expect(text).not.toContain("Letztes Jahr");

    const [header, first, second, third] = records;
    expect(header).toBe(`${CSV_COLUMNS.join(";")}\r\n`);
    expect(first).toContain(";-12.50;CHF;repair;");
    expect(first).toContain("'=cmd|' /C calc'!A0;");
    expect(first).toContain(";none;true;unknown;");
    expect(second).toContain(";1949.75;CHF;repair;");
    expect(second).toContain('"Muster ""AG"""');
    expect(second).toContain(";Anna;ownership;true;maintenance;");
    expect(second).toContain('"Heizung; alt"');
    expect(second).toContain('"Zeile 1\nZeile 2"');
    expect(third).toContain(";5000.00;CHF;mortgage_principal;");
    expect(third).toContain(";false;unknown;");
    for (const record of [first, second, third]) {
      expect(record).toMatch(/;manual;[0-9a-f-]{36}\r\n$/);
    }
  });
});
