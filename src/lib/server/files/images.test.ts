import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { FileError } from "./errors";
import { processImage, readImageSize } from "./images";
import {
  drawQuadrants,
  jpegMarkers,
  plainJpeg,
  plainPng,
  plainWebp,
  pngWithMetadata,
  readCorners,
  SECRET_COMMENT,
  SECRET_MAKE,
  withExif,
  withJpegComment,
} from "./test-images";

async function decode(bytes: Uint8Array) {
  const image = await loadImage(Buffer.from(bytes));
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  return {
    width: image.width,
    height: image.height,
    corners: readCorners(image, (x, y) => ctx.getImageData(x, y, 1, 1).data),
  };
}

function contains(bytes: Uint8Array, needle: string): boolean {
  return Buffer.from(bytes).includes(Buffer.from(needle, "latin1"));
}

async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(FileError);
    return (error as FileError).code;
  }
  throw new Error("expected rejection");
}

describe("readImageSize", () => {
  it("reads png, jpeg and webp headers", () => {
    expect(readImageSize(plainPng(40, 30), "image/png")).toEqual({
      width: 40,
      height: 30,
    });
    expect(readImageSize(plainJpeg(40, 30), "image/jpeg")).toEqual({
      width: 40,
      height: 30,
    });
    expect(readImageSize(plainWebp(40, 30), "image/webp")).toEqual({
      width: 40,
      height: 30,
    });
  });

  it("reads extended and lossless webp headers", () => {
    const riff = (chunk: string, fill: (b: Buffer) => void) => {
      const b = Buffer.alloc(40);
      b.write("RIFF", 0, "latin1");
      b.write("WEBP", 8, "latin1");
      b.write(chunk, 12, "latin1");
      fill(b);
      return b;
    };
    const vp8x = riff("VP8X", (b) => {
      b.writeUIntLE(5000 - 1, 24, 3);
      b.writeUIntLE(3000 - 1, 27, 3);
    });
    expect(readImageSize(vp8x, "image/webp")).toEqual({
      width: 5000,
      height: 3000,
    });
    const vp8l = riff("VP8L", (b) => {
      b[20] = 0x2f;
      b.writeUInt32LE((640 - 1) | ((480 - 1) << 14), 21);
    });
    expect(readImageSize(vp8l, "image/webp")).toEqual({
      width: 640,
      height: 480,
    });
    const lossy = riff("VP8 ", (b) => {
      b.set([0x9d, 0x01, 0x2a], 23);
      b.writeUInt16LE(320, 26);
      b.writeUInt16LE(200, 28);
    });
    expect(readImageSize(lossy, "image/webp")).toEqual({
      width: 320,
      height: 200,
    });
    expect(() =>
      readImageSize(
        riff("VP8L", () => {}),
        "image/webp",
      ),
    ).toThrow(FileError);
    expect(() =>
      readImageSize(
        riff("VP8 ", () => {}),
        "image/webp",
      ),
    ).toThrow(FileError);
    expect(() =>
      readImageSize(
        riff("ABCD", () => {}),
        "image/webp",
      ),
    ).toThrow(FileError);
  });

  it("rejects oversized extended webp before decoding", async () => {
    const b = Buffer.alloc(40);
    b.write("RIFF", 0, "latin1");
    b.write("WEBP", 8, "latin1");
    b.write("VP8X", 12, "latin1");
    b.writeUIntLE(16000 - 1, 24, 3);
    b.writeUIntLE(16000 - 1, 27, 3);
    expect(await rejection(processImage(b, "image/webp"))).toBe(
      "image_too_large",
    );
  });

  it("finds the jpeg frame header behind exif and comment segments", () => {
    const jpeg = withJpegComment(withExif(plainJpeg(48, 24), 6), "hello");
    expect(readImageSize(jpeg, "image/jpeg")).toEqual({
      width: 48,
      height: 24,
    });
  });

  it("throws corrupt_image for truncated or malformed headers", () => {
    const cases: [Uint8Array, "image/jpeg" | "image/png" | "image/webp"][] = [
      [plainPng().subarray(0, 20), "image/png"],
      [plainJpeg().subarray(0, 4), "image/jpeg"],
      [new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg"],
      [Buffer.from("RIFF\0\0\0\0WEBPVP8 "), "image/webp"],
      [plainWebp().subarray(0, 12), "image/webp"],
    ];
    for (const [bytes, mime] of cases) {
      expect(() => readImageSize(bytes, mime)).toThrow(FileError);
    }
  });

  it("rejects zero dimensions", () => {
    const png = Buffer.from(plainPng());
    png.writeUInt32BE(0, 16);
    expect(() => readImageSize(png, "image/png")).toThrow(FileError);
  });
});

describe("processImage: orientation", () => {
  // original quadrants: TL red, TR green, BL blue, BR white (32x16)
  const expected: Record<number, { size: [number, number]; corners: string }> =
    {
      1: { size: [32, 16], corners: "RGBW" },
      2: { size: [32, 16], corners: "GRWB" },
      3: { size: [32, 16], corners: "WBGR" },
      4: { size: [32, 16], corners: "BWRG" },
      5: { size: [16, 32], corners: "RBGW" },
      6: { size: [16, 32], corners: "BRWG" },
      7: { size: [16, 32], corners: "WGBR" },
      8: { size: [16, 32], corners: "GWRB" },
    };

  for (const [orientation, want] of Object.entries(expected)) {
    it(`applies exif orientation ${orientation} to the pixels`, async () => {
      const source = withExif(plainJpeg(32, 16), Number(orientation));
      const result = await processImage(source, "image/jpeg");
      expect([result.width, result.height]).toEqual(want.size);
      const decoded = await decode(result.bytes);
      expect([decoded.width, decoded.height]).toEqual(want.size);
      expect(decoded.corners).toBe(want.corners);
    });
  }

  it("also rotates the thumbnail", async () => {
    const result = await processImage(
      withExif(plainJpeg(64, 32), 6),
      "image/jpeg",
    );
    const thumb = await decode(result.thumbnail);
    expect([thumb.width, thumb.height]).toEqual([32, 64]);
    expect(thumb.corners).toBe("BRWG");
  });
});

describe("processImage: metadata", () => {
  it("strips exif including gps and the camera make from jpeg", async () => {
    const source = withJpegComment(
      withExif(plainJpeg(64, 32), 1),
      "gps 52.52N 13.40E",
    );
    expect(contains(source, SECRET_MAKE)).toBe(true);
    expect(contains(source, "Exif")).toBe(true);
    expect(jpegMarkers(source)).toContain(0xe1);

    const result = await processImage(source, "image/jpeg");
    for (const needle of [
      SECRET_MAKE,
      "Exif",
      "gps 52.52N",
      "MM\0*",
      "II*\0",
    ]) {
      expect(contains(result.bytes, needle), needle).toBe(false);
    }
    const markers = jpegMarkers(result.bytes);
    expect(markers).not.toContain(0xe1);
    expect(markers).not.toContain(0xfe);
    // Skia writes its own generic sRGB ICC profile (APP2); nothing from the source survives.
    expect(markers.filter((m) => m >= 0xe1 && m <= 0xef)).toEqual([0xe2]);
    const app2 = result.bytes.indexOf(Buffer.from([0xff, 0xe2]));
    expect(result.bytes.subarray(app2 + 4, app2 + 15).toString("latin1")).toBe(
      "ICC_PROFILE",
    );
    expect(readImageSize(result.bytes, "image/jpeg")).toEqual({
      width: 64,
      height: 32,
    });
  });

  it("strips text and exif chunks from png", async () => {
    const source = pngWithMetadata(plainPng(32, 16));
    expect(contains(source, SECRET_COMMENT)).toBe(true);
    expect(contains(source, "eXIf")).toBe(true);
    const result = await processImage(source, "image/png");
    expect(contains(result.bytes, SECRET_COMMENT)).toBe(false);
    expect(contains(result.bytes, "SecretCam")).toBe(false);
    for (const chunk of ["eXIf", "tEXt", "iTXt", "zTXt", "iCCP"]) {
      expect(contains(result.bytes, chunk), chunk).toBe(false);
    }
    const decoded = await decode(result.bytes);
    expect(decoded.corners).toBe("RGBW");
  });

  it("strips metadata from the thumbnail too", async () => {
    const result = await processImage(
      withExif(plainJpeg(64, 32), 1),
      "image/jpeg",
    );
    expect(contains(result.thumbnail, SECRET_MAKE)).toBe(false);
    expect(contains(result.thumbnail, "EXIF")).toBe(false);
  });
});

describe("processImage: output format", () => {
  it("emits jpeg for jpeg input", async () => {
    const result = await processImage(plainJpeg(), "image/jpeg");
    expect(result.mime).toBe("image/jpeg");
    expect([...result.bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  it("keeps png for png input including transparency", async () => {
    const canvas = createCanvas(16, 16);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgba(255,0,0,0.5)";
    ctx.fillRect(0, 0, 8, 16);
    const result = await processImage(
      canvas.toBuffer("image/png"),
      "image/png",
    );
    expect(result.mime).toBe("image/png");
    expect(result.bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
    const decoded = await loadImage(result.bytes);
    const out = createCanvas(16, 16);
    const octx = out.getContext("2d");
    octx.drawImage(decoded, 0, 0);
    expect(octx.getImageData(12, 8, 1, 1).data[3]).toBe(0);
    expect(octx.getImageData(2, 8, 1, 1).data[3]).toBeGreaterThan(100);
    expect(octx.getImageData(2, 8, 1, 1).data[3]).toBeLessThan(160);
  });

  it("keeps webp for webp input", async () => {
    const result = await processImage(plainWebp(), "image/webp");
    expect(result.mime).toBe("image/webp");
    expect(result.bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(result.bytes.subarray(8, 12).toString("latin1")).toBe("WEBP");
    expect((await decode(result.bytes)).corners).toBe("RGBW");
  });

  it("is deterministic for identical input", async () => {
    const a = await processImage(plainJpeg(), "image/jpeg");
    const b = await processImage(plainJpeg(), "image/jpeg");
    expect(Buffer.compare(a.bytes, b.bytes)).toBe(0);
    expect(Buffer.compare(a.thumbnail, b.thumbnail)).toBe(0);
  });
});

describe("processImage: sizes", () => {
  it("caps the longest side at 4000 px by default, keeping the aspect ratio", async () => {
    const jpeg = drawQuadrants(5000, 2500).toBuffer("image/jpeg", 60);
    const result = await processImage(jpeg, "image/jpeg");
    expect([result.width, result.height]).toEqual([4000, 2000]);
    expect(readImageSize(result.bytes, "image/jpeg")).toEqual({
      width: 4000,
      height: 2000,
    });
  });

  it("caps portrait images and honours a custom limit", async () => {
    const result = await processImage(plainJpeg(100, 300), "image/jpeg", {
      maxDimension: 150,
    });
    expect([result.width, result.height]).toEqual([50, 150]);
  });

  it("does not upscale small images", async () => {
    const result = await processImage(plainJpeg(32, 16), "image/jpeg");
    expect([result.width, result.height]).toEqual([32, 16]);
    const thumb = await decode(result.thumbnail);
    expect([thumb.width, thumb.height]).toEqual([32, 16]);
  });

  it("creates a 480 px webp thumbnail", async () => {
    const result = await processImage(plainJpeg(1920, 1080), "image/jpeg");
    expect(result.thumbnail.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(result.thumbnail.subarray(8, 12).toString("latin1")).toBe("WEBP");
    const thumb = await decode(result.thumbnail);
    expect([thumb.width, thumb.height]).toEqual([480, 270]);
    expect(thumb.corners).toBe("RGBW");
    expect(result.thumbnail.length).toBeLessThan(result.bytes.length);
  });

  it("keeps extreme aspect ratios at least one pixel high", async () => {
    const canvas = createCanvas(4000, 2);
    canvas.getContext("2d").fillRect(0, 0, 4000, 2);
    const result = await processImage(
      canvas.toBuffer("image/png"),
      "image/png",
    );
    const thumb = await loadImage(result.thumbnail);
    expect(thumb.width).toBe(480);
    expect(thumb.height).toBeGreaterThanOrEqual(1);
  });

  it("rejects images over the pixel budget before decoding", async () => {
    const png = Buffer.from(plainPng());
    png.writeUInt32BE(20000, 16);
    png.writeUInt32BE(20000, 20);
    expect(await rejection(processImage(png, "image/png"))).toBe(
      "image_too_large",
    );

    const jpeg = Buffer.from(plainJpeg());
    const sof = jpeg.indexOf(Buffer.from([0xff, 0xc0]));
    jpeg.writeUInt16BE(30000, sof + 5);
    jpeg.writeUInt16BE(30000, sof + 7);
    expect(await rejection(processImage(jpeg, "image/jpeg"))).toBe(
      "image_too_large",
    );
  });

  it("honours a custom pixel budget", async () => {
    expect(
      await rejection(
        processImage(plainJpeg(100, 100), "image/jpeg", {
          maxInputPixels: 5000,
        }),
      ),
    ).toBe("image_too_large");
  });
});

describe("processImage: broken input", () => {
  it("throws corrupt_image for undecodable data behind a valid header", async () => {
    const png = Buffer.concat([
      plainPng().subarray(0, 33),
      Buffer.from("not really png data"),
    ]);
    expect(await rejection(processImage(png, "image/png"))).toBe(
      "corrupt_image",
    );

    const jpeg = Buffer.concat([
      plainJpeg().subarray(0, 200),
      Buffer.alloc(50, 0xab),
    ]);
    expect(await rejection(processImage(jpeg, "image/jpeg"))).toBe(
      "corrupt_image",
    );
  });

  it("throws corrupt_image for a bare signature", async () => {
    expect(
      await rejection(
        processImage(
          new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0]),
          "image/jpeg",
        ),
      ),
    ).toBe("corrupt_image");
  });

  it("does not accept pdfs", async () => {
    await expect(
      processImage(Buffer.from("%PDF-1.4"), "application/pdf"),
    ).rejects.toThrow();
  });

  it("neutralizes a polyglot: html appended to a valid jpeg does not survive", async () => {
    const polyglot = Buffer.concat([
      plainJpeg(),
      Buffer.from("<script>alert(1)</script>"),
    ]);
    const result = await processImage(polyglot, "image/jpeg");
    expect(contains(result.bytes, "<script>")).toBe(false);
  });
});
