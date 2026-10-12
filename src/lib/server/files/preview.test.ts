import { randomFillSync } from "node:crypto";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { previewImage, previewSize } from "./preview";
import { plainJpeg, plainPng } from "./test-images";

const OPTIONS = { maxSide: 1600, maxBytes: 1_500_000 };

/** Random pixels: they do not compress, so a few megapixels are megabytes. */
function noise(width: number, height: number): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const data = ctx.createImageData(width, height);
  randomFillSync(data.data);
  for (let i = 3; i < data.data.length; i += 4) data.data[i] = 255;
  ctx.putImageData(data, 0, 0);
  return canvas.toBuffer("image/jpeg", 95);
}

describe("previewSize", () => {
  it.each([
    ["a small image stays as it is", 800, 600, 800, 600],
    ["the longest side of a photo is brought to 1600", 4000, 3000, 1600, 1200],
    ["a portrait photo likewise", 3000, 4000, 1200, 1600],
    ["a square", 3000, 3000, 1600, 1600],
    ["an image exactly at the limit is untouched", 1600, 1200, 1600, 1200],
    [
      "a moderately tall receipt keeps a short side of 600",
      1000,
      2400,
      667,
      1600,
    ],
    ["a thin receipt is allowed a longer side", 800, 3000, 600, 2250],
    ["a very thin receipt stops at twice the limit", 500, 4000, 400, 3200],
    [
      "a thin image that is small already is not enlarged",
      300,
      2000,
      300,
      2000,
    ],
  ])("%s", (_name, w, h, expectedW, expectedH) => {
    expect(previewSize(w, h, 1600)).toEqual({
      width: expectedW,
      height: expectedH,
    });
  });
});

describe("previewImage", () => {
  const stored = (
    bytes: Buffer,
    width: number,
    height: number,
    mime: string,
  ) => ({
    bytes,
    mime,
    width,
    height,
  });

  it("returns an image that fits as stored, byte for byte", async () => {
    const png = plainPng(640, 480);
    const out = await previewImage(stored(png, 640, 480, "image/png"), OPTIONS);
    expect(out.scaled).toBe(false);
    expect(out.mime).toBe("image/png");
    expect(Buffer.from(out.bytes).equals(png)).toBe(true);
  });

  it("scales a large image down to JPEG within the limits and keeps its proportions", async () => {
    const png = plainPng(4000, 3000);
    const out = await previewImage(
      stored(png, 4000, 3000, "image/png"),
      OPTIONS,
    );
    expect(out.scaled).toBe(true);
    expect(out.mime).toBe("image/jpeg");
    expect([out.width, out.height]).toEqual([1600, 1200]);
    expect(out.bytes.byteLength).toBeLessThanOrEqual(OPTIONS.maxBytes);
    const decoded = await loadImage(Buffer.from(out.bytes));
    expect([decoded.width, decoded.height]).toEqual([1600, 1200]);
  });

  it("puts a transparent PNG on white, not black", async () => {
    const canvas = createCanvas(2000, 1000);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000000";
    ctx.fillRect(900, 400, 200, 200);
    const out = await previewImage(
      stored(canvas.toBuffer("image/png"), 2000, 1000, "image/png"),
      OPTIONS,
    );
    const decoded = await loadImage(Buffer.from(out.bytes));
    const probe = createCanvas(decoded.width, decoded.height);
    const pctx = probe.getContext("2d");
    pctx.drawImage(decoded, 0, 0);
    const corner = pctx.getImageData(2, 2, 1, 1).data;
    expect([corner[0], corner[1], corner[2]].every((c) => c > 245)).toBe(true);
  });

  it("lowers the quality, then the size, until a heavy image fits the byte limit", async () => {
    const heavy = noise(1500, 1000);
    expect(heavy.byteLength).toBeGreaterThan(OPTIONS.maxBytes);
    const out = await previewImage(
      stored(heavy, 1500, 1000, "image/jpeg"),
      OPTIONS,
    );
    expect(out.scaled).toBe(true);
    expect(out.mime).toBe("image/jpeg");
    expect(out.bytes.byteLength).toBeLessThanOrEqual(OPTIONS.maxBytes);
    expect(out.width).toBeLessThanOrEqual(1500);
    expect(out.width / out.height).toBeCloseTo(1.5, 1);
  });

  it("keeps a long receipt readable instead of squeezing it to 1600 px", async () => {
    const out = await previewImage(
      stored(plainJpeg(800, 3000), 800, 3000, "image/jpeg"),
      { ...OPTIONS, maxBytes: 10_000_000 },
    );
    expect([out.width, out.height]).toEqual([600, 2250]);
  });

  it("refuses bytes that are no image", async () => {
    await expect(
      previewImage(
        stored(Buffer.from("not an image"), 4000, 3000, "image/png"),
        OPTIONS,
      ),
    ).rejects.toMatchObject({ code: "corrupt_image" });
  });
});
