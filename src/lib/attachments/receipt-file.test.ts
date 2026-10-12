import { describe, expect, it, vi } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "./files";
import {
  CONVERTED_MAX_SIDE,
  fitWithin,
  heicPlan,
  jpegName,
  prepareReceiptFile,
  receiptProblemMessage,
  type JpegConverter,
  type ReceiptProblem,
} from "./receipt-file";

const file = (name: string, type: string, size = 100) =>
  new File([new Uint8Array(size)], name, { type });

const jpeg: JpegConverter = async () =>
  new Blob([new Uint8Array(50)], { type: "image/jpeg" });

describe("what to do with a HEIC photo", () => {
  it.each([
    ["IMG_1.HEIC", "image/heic", true, "convert"],
    ["IMG_1.heif", "image/heif", true, "convert"],
    ["IMG_1.heic", "", true, "convert"],
    ["IMG_1.heic", "image/heic", false, "refuse"],
    ["IMG_1.jpg", "image/heic", false, "refuse"],
    ["IMG_1.jpg", "image/jpeg", true, "keep"],
    ["beleg.pdf", "application/pdf", false, "keep"],
    ["scan.png", "image/png", false, "keep"],
  ] as const)("%s (%s, converter: %s) -> %s", (name, type, can, plan) => {
    expect(heicPlan({ name, type }, can)).toBe(plan);
  });
});

describe("the name of a converted photo", () => {
  it("swaps the extension for jpg", () => {
    expect(jpegName("IMG_0001.HEIC")).toBe("IMG_0001.jpg");
    expect(jpegName("Foto 1.final.heif")).toBe("Foto 1.final.jpg");
    expect(jpegName("noext")).toBe("noext.jpg");
    expect(jpegName(".heic")).toBe("photo.jpg");
  });
});

describe("scaling a picture down", () => {
  it("keeps what fits and scales the rest to the longest side", () => {
    expect(fitWithin(3000, 2000, CONVERTED_MAX_SIDE)).toEqual({
      width: 3000,
      height: 2000,
    });
    expect(fitWithin(8000, 6000, 4000)).toEqual({ width: 4000, height: 3000 });
    expect(fitWithin(1000, 12000, 4000)).toEqual({ width: 333, height: 4000 });
  });

  it("never reaches zero pixels", () => {
    expect(fitWithin(1, 100000, 4000)).toEqual({ width: 1, height: 4000 });
  });
});

describe("preparing a receipt file", () => {
  it("accepts a JPEG, PNG, WebP or PDF as it is", async () => {
    for (const [name, type] of [
      ["a.jpg", "image/jpeg"],
      ["a.png", "image/png"],
      ["a.webp", "image/webp"],
      ["a.pdf", "application/pdf"],
    ]) {
      const f = file(name!, type!);
      expect(await prepareReceiptFile(f, jpeg)).toEqual({
        ok: true,
        file: f,
        converted: false,
      });
    }
  });

  it("takes the type from the extension when the browser gives none", async () => {
    const result = await prepareReceiptFile(file("scan.PDF", ""), null);
    expect(result.ok).toBe(true);
  });

  it("converts a HEIC photo to a JPEG file with the new name", async () => {
    const result = await prepareReceiptFile(
      file("IMG_0001.HEIC", "image/heic", 4000),
      jpeg,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.converted).toBe(true);
    expect(result.file.name).toBe("IMG_0001.jpg");
    expect(result.file.type).toBe("image/jpeg");
    expect(result.file.size).toBe(50);
  });

  it("refuses HEIC with the server's own wording where the browser cannot decode it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cannot: JpegConverter = async () => {
      throw new DOMException("cannot decode", "InvalidStateError");
    };
    expect(
      await prepareReceiptFile(file("IMG.heic", "image/heic"), cannot),
    ).toEqual({ ok: false, problem: "heic" });
    expect(
      await prepareReceiptFile(file("IMG.heic", "image/heic"), null),
    ).toEqual({
      ok: false,
      problem: "heic",
    });
    // the log names the error, never the file
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("IMG");
    warn.mockRestore();
    expect(receiptProblemMessage("heic")).toBe(
      "HEIC-Bilder werden nicht unterstützt. Bitte als JPEG aufnehmen/teilen.",
    );
  });

  it("refuses an empty file, a type the server does not take and a file that is too large", async () => {
    expect(
      await prepareReceiptFile(file("a.jpg", "image/jpeg", 0), jpeg),
    ).toEqual({
      ok: false,
      problem: "empty",
    });
    expect(await prepareReceiptFile(file("a.gif", "image/gif"), jpeg)).toEqual({
      ok: false,
      problem: "unsupported_type",
    });
    expect(
      await prepareReceiptFile(file("a.svg", "image/svg+xml"), jpeg),
    ).toEqual({
      ok: false,
      problem: "unsupported_type",
    });
    const big = {
      name: "big.pdf",
      type: "application/pdf",
      size: MAX_ATTACHMENT_BYTES + 1,
    } as File;
    expect(await prepareReceiptFile(big, jpeg)).toEqual({
      ok: false,
      problem: "too_large",
    });
  });

  it("words every problem", () => {
    const problems: ReceiptProblem[] = [
      "empty",
      "too_large",
      "unsupported_type",
      "heic",
    ];
    const words = problems.map(receiptProblemMessage);
    expect(new Set(words).size).toBe(problems.length);
    for (const text of words) expect(text.length).toBeGreaterThan(10);
  });
});
