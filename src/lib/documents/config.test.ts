import { describe, expect, it } from "vitest";
import { isHttpUrl, readProviderConfig, sameIds } from "./config";

describe("readProviderConfig", () => {
  it("fills the defaults for a connection without settings", () => {
    expect(readProviderConfig({})).toEqual({
      sharedTagIds: [],
      uploadTagIds: [],
      shareGroupIds: [],
      receiptTagIds: [],
      manualTagIds: [],
      writeBackNotes: false,
    });
  });

  it("keeps what the connection stored and drops unknown keys", () => {
    const config = readProviderConfig({
      sharedTagIds: [1, 4],
      warrantyFieldId: 7,
      writeBackNotes: true,
      appUrl: "https://hauswart.example.org",
      somethingElse: "x",
    });
    expect(config.sharedTagIds).toEqual([1, 4]);
    expect(config.warrantyFieldId).toBe(7);
    expect(config.writeBackNotes).toBe(true);
    expect(config.appUrl).toBe("https://hauswart.example.org");
    expect(config).not.toHaveProperty("somethingElse");
  });

  it("falls back to the defaults when the stored value is not valid", () => {
    expect(readProviderConfig({ sharedTagIds: "nope" }).sharedTagIds).toEqual(
      [],
    );
  });
});

describe("sameIds", () => {
  it("ignores the order", () => {
    expect(sameIds([3, 1, 2], [1, 2, 3])).toBe(true);
  });

  it("sees a different length or a different id", () => {
    expect(sameIds([1, 2], [1, 2, 3])).toBe(false);
    expect(sameIds([1, 2], [1, 4])).toBe(false);
    expect(sameIds([], [])).toBe(true);
  });
});

describe("isHttpUrl", () => {
  it("accepts http and https addresses without credentials", () => {
    expect(isHttpUrl("https://hauswart.example.org")).toBe(true);
    expect(isHttpUrl("http://hauswart.example.org:3000/app")).toBe(true);
  });

  it("refuses everything else", () => {
    expect(isHttpUrl("hauswart.example.org")).toBe(false);
    expect(isHttpUrl("ftp://hauswart.example.org")).toBe(false);
    expect(isHttpUrl("https://user:secret@hauswart.example.org")).toBe(false);
  });
});
