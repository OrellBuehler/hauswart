import { describe, expect, it } from "vitest";
import {
  baseName,
  fileType,
  formatBytes,
  isHeic,
  matchesAccept,
} from "./files";

describe("file helpers", () => {
  it("recognises HEIC by type or extension", () => {
    expect(isHeic({ name: "a.HEIC", type: "" })).toBe(true);
    expect(isHeic({ name: "a.jpg", type: "image/heif" })).toBe(true);
    expect(isHeic({ name: "a.jpg", type: "image/jpeg" })).toBe(false);
  });

  it("falls back to the extension for the type", () => {
    expect(fileType({ name: "scan.PDF", type: "" })).toBe("application/pdf");
    expect(fileType({ name: "x.bin", type: "" })).toBe("");
  });

  it("matches accept lists", () => {
    const accept = "image/jpeg,application/pdf";
    expect(matchesAccept({ name: "a.jpg", type: "image/jpeg" }, accept)).toBe(
      true,
    );
    expect(matchesAccept({ name: "a.png", type: "image/png" }, accept)).toBe(
      false,
    );
    expect(matchesAccept({ name: "a.png", type: "image/png" }, "image/*")).toBe(
      true,
    );
  });

  it("formats sizes", () => {
    expect(formatBytes(512)).toMatch(/^512 B$/);
    expect(formatBytes(1536)).toMatch(/1[.,]5 KB$/);
    expect(formatBytes(25 * 1024 * 1024)).toMatch(/^25 MB$/);
  });

  it("strips the extension", () => {
    expect(baseName("Foto 1.final.jpg")).toBe("Foto 1.final");
    expect(baseName("noext")).toBe("noext");
  });
});
