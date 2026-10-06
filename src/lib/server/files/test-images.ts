import { createCanvas } from "@napi-rs/canvas";

/** Synthetic image builders for tests: no real-device files, all metadata is made up. */

const RED = "#ff0000";
const GREEN = "#00ff00";
const BLUE = "#0000ff";
const WHITE = "#ffffff";

/** Quadrants: top-left red, top-right green, bottom-left blue, bottom-right white. */
export function drawQuadrants(width: number, height: number) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const w = width / 2;
  const h = height / 2;
  ctx.fillStyle = RED;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = GREEN;
  ctx.fillRect(w, 0, w, h);
  ctx.fillStyle = BLUE;
  ctx.fillRect(0, h, w, h);
  ctx.fillStyle = WHITE;
  ctx.fillRect(w, h, w, h);
  return canvas;
}

export function plainJpeg(width = 32, height = 16): Buffer {
  return drawQuadrants(width, height).toBuffer("image/jpeg", 100);
}

export function plainPng(width = 32, height = 16): Buffer {
  return drawQuadrants(width, height).toBuffer("image/png");
}

export function plainWebp(width = 32, height = 16): Buffer {
  return drawQuadrants(width, height).toBuffer("image/webp", 90);
}

export const SECRET_MAKE = "SecretCamMake9000";
export const SECRET_COMMENT = "secret-gps-comment-52.5200N";

function ascii(value: string): Buffer {
  return Buffer.from(`${value}\0`, "latin1");
}

/** Little-endian TIFF block with Make, Orientation and a GPS IFD with latitude/longitude. */
export function buildExifTiff(orientation = 1): Buffer {
  const make = ascii(SECRET_MAKE);
  const latRef = Buffer.from("N\0\0\0", "latin1");
  const lonRef = Buffer.from("E\0\0\0", "latin1");

  const ifd0Count = 3;
  const ifd0Offset = 8;
  const ifd0Size = 2 + ifd0Count * 12 + 4;
  const makeOffset = ifd0Offset + ifd0Size;
  const gpsOffset = makeOffset + make.length + (make.length % 2);
  const gpsEntries = 4;
  const gpsSize = 2 + gpsEntries * 12 + 4;
  const rationalsOffset = gpsOffset + gpsSize;

  const buf = Buffer.alloc(rationalsOffset + 48);
  buf.write("II", 0, "latin1");
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(ifd0Offset, 4);

  let o = ifd0Offset;
  buf.writeUInt16LE(ifd0Count, o);
  o += 2;
  const entry = (
    tag: number,
    type: number,
    count: number,
    value: () => void,
  ) => {
    buf.writeUInt16LE(tag, o);
    buf.writeUInt16LE(type, o + 2);
    buf.writeUInt32LE(count, o + 4);
    value();
    o += 12;
  };
  entry(0x010f, 2, make.length, () => buf.writeUInt32LE(makeOffset, o + 8));
  entry(0x0112, 3, 1, () => buf.writeUInt16LE(orientation, o + 8));
  entry(0x8825, 4, 1, () => buf.writeUInt32LE(gpsOffset, o + 8));
  buf.writeUInt32LE(0, o);
  make.copy(buf, makeOffset);

  o = gpsOffset;
  buf.writeUInt16LE(gpsEntries, o);
  o += 2;
  entry(0x0001, 2, 2, () => latRef.copy(buf, o + 8));
  entry(0x0002, 5, 3, () => buf.writeUInt32LE(rationalsOffset, o + 8));
  entry(0x0003, 2, 2, () => lonRef.copy(buf, o + 8));
  entry(0x0004, 5, 3, () => buf.writeUInt32LE(rationalsOffset + 24, o + 8));
  buf.writeUInt32LE(0, o);
  // 52 deg 31 min 12 sec, 13 deg 24 min 18 sec
  [52, 1, 31, 1, 1200, 100, 13, 1, 24, 1, 1800, 100].forEach((value, i) =>
    buf.writeUInt32LE(value, rationalsOffset + i * 4),
  );
  return buf;
}

/** Inserts an APP1 EXIF segment (orientation + GPS) after the SOI marker. */
export function withExif(jpeg: Buffer, orientation = 1): Buffer {
  const payload = Buffer.concat([
    ascii("Exif").subarray(0, 5),
    Buffer.from([0]),
    buildExifTiff(orientation),
  ]);
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = 0xe1;
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([
    jpeg.subarray(0, 2),
    header,
    payload,
    jpeg.subarray(2),
  ]);
}

/** Inserts a COM segment carrying text. */
export function withJpegComment(jpeg: Buffer, text: string): Buffer {
  const body = Buffer.from(text, "latin1");
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = 0xfe;
  header.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), header, body, jpeg.subarray(2)]);
}

/** Lists the marker bytes of the segments before the scan data. */
export function jpegMarkers(jpeg: Buffer): number[] {
  const markers: number[] = [];
  let i = 2;
  while (i + 4 <= jpeg.length && jpeg[i] === 0xff) {
    const marker = jpeg[i + 1]!;
    markers.push(marker);
    if (marker === 0xda) break;
    i += 2 + jpeg.readUInt16BE(i + 2);
  }
  return markers;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

/** Inserts tEXt and eXIf chunks after IHDR. */
export function pngWithMetadata(png: Buffer, orientation = 1): Buffer {
  const text = pngChunk(
    "tEXt",
    Buffer.from(`Comment\0${SECRET_COMMENT}`, "latin1"),
  );
  const exif = pngChunk("eXIf", buildExifTiff(orientation));
  const ihdrEnd = 8 + 12 + 13;
  return Buffer.concat([
    png.subarray(0, ihdrEnd),
    text,
    exif,
    png.subarray(ihdrEnd),
  ]);
}

export function readCorners(
  image: { width: number; height: number },
  pixels: (x: number, y: number) => Uint8ClampedArray,
) {
  const name = (d: Uint8ClampedArray) =>
    d[0]! > 200 && d[1]! < 90 && d[2]! < 90
      ? "R"
      : d[1]! > 200 && d[0]! < 90 && d[2]! < 90
        ? "G"
        : d[2]! > 200 && d[0]! < 90 && d[1]! < 90
          ? "B"
          : d[0]! > 200 && d[1]! > 200 && d[2]! > 200
            ? "W"
            : "?";
  const { width: w, height: h } = image;
  const inset = Math.max(1, Math.floor(Math.min(w, h) / 8));
  return (
    name(pixels(inset, inset)) +
    name(pixels(w - 1 - inset, inset)) +
    name(pixels(inset, h - 1 - inset)) +
    name(pixels(w - 1 - inset, h - 1 - inset))
  );
}
