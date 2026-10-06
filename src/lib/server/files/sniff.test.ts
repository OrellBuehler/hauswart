import { describe, expect, it } from "vitest";
import { FileError } from "./errors";
import { extFor, isAllowedMime, sniffMime } from "./sniff";
import { plainJpeg, plainPng, plainWebp } from "./test-images";

function ftyp(major: string, compatible: string[] = []): Uint8Array {
  const brands = [major, ...compatible];
  const size = 16 + compatible.length * 4;
  const out = new Uint8Array(size + 8);
  new DataView(out.buffer).setUint32(0, size);
  out.set(new TextEncoder().encode("ftyp"), 4);
  out.set(new TextEncoder().encode(brands[0]!), 8);
  compatible.forEach((brand, i) =>
    out.set(new TextEncoder().encode(brand), 16 + i * 4),
  );
  return out;
}

const text = (value: string) => new TextEncoder().encode(value);

function code(bytes: Uint8Array): string | undefined {
  try {
    sniffMime(bytes);
  } catch (error) {
    expect(error).toBeInstanceOf(FileError);
    return (error as FileError).code;
  }
  return undefined;
}

describe("sniffMime", () => {
  it("detects jpeg, png, webp and pdf from magic bytes", () => {
    expect(sniffMime(plainJpeg())).toEqual({ mime: "image/jpeg", ext: "jpg" });
    expect(sniffMime(plainPng())).toEqual({ mime: "image/png", ext: "png" });
    expect(sniffMime(plainWebp())).toEqual({ mime: "image/webp", ext: "webp" });
    expect(sniffMime(text("%PDF-1.7\n%âãÏÓ\n"))).toEqual({
      mime: "application/pdf",
      ext: "pdf",
    });
  });

  it("detects jpeg regardless of the marker after the signature", () => {
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 0]))).toEqual({
      mime: "image/jpeg",
      ext: "jpg",
    });
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]))).toEqual({
      mime: "image/jpeg",
      ext: "jpg",
    });
  });

  it("rejects empty input", () => {
    expect(code(new Uint8Array())).toBe("empty");
  });

  it("rejects gif", () => {
    expect(code(text("GIF89a\x01\x00\x01\x00"))).toBe("unsupported_type");
    expect(code(text("GIF87a\x01\x00\x01\x00"))).toBe("unsupported_type");
  });

  it("rejects svg, html and other text formats", () => {
    const rejected = [
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>',
      "<!DOCTYPE html><html><script>alert(1)</script></html>",
      "<html><body onload=alert(1)>",
      "  <script>alert(1)</script>",
      "#!/bin/sh\nrm -rf /",
      "PK\x03\x04",
      "MZ\x90\x00",
      "plain text",
      '{"json":true}',
    ];
    for (const value of rejected)
      expect(code(text(value)), value).toBe("unsupported_type");
  });

  it("requires the pdf header at offset zero", () => {
    expect(code(text("<script>x</script>%PDF-1.4"))).toBe("unsupported_type");
    expect(code(text(" %PDF-1.4"))).toBe("unsupported_type");
    expect(code(text("%PDF"))).toBe("unsupported_type");
  });

  it("rejects truncated signatures", () => {
    expect(code(new Uint8Array([0xff]))).toBe("unsupported_type");
    expect(code(new Uint8Array([0xff, 0xd8]))).toBe("unsupported_type");
    expect(code(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(
      "unsupported_type",
    );
    expect(code(text("RIFF"))).toBe("unsupported_type");
    expect(code(text("RIFF\0\0\0\0WAVE"))).toBe("unsupported_type");
  });

  it("rejects heic and heif by ftyp brand with the dedicated code", () => {
    for (const brand of [
      "heic",
      "heix",
      "hevc",
      "hevx",
      "heim",
      "heis",
      "mif1",
      "msf1",
    ]) {
      expect(code(ftyp(brand)), brand).toBe("unsupported_heic");
    }
    expect(code(ftyp("mif1", ["heic", "mif1"]))).toBe("unsupported_heic");
    expect(code(ftyp("isom", ["iso2", "heic"]))).toBe("unsupported_heic");
  });

  it("rejects avif and other ftyp containers as unsupported", () => {
    expect(code(ftyp("avif", ["mif1", "avif"]))).toBe("unsupported_type");
    expect(code(ftyp("avis"))).toBe("unsupported_type");
    expect(code(ftyp("mp42", ["isom"]))).toBe("unsupported_type");
    expect(code(ftyp("qt  "))).toBe("unsupported_type");
  });

  it("ignores filenames: only bytes decide", () => {
    expect(code(text("<svg/>"))).toBe("unsupported_type");
  });
});

describe("helpers", () => {
  it("maps mimes to extensions and checks the allowlist", () => {
    expect(extFor("image/jpeg")).toBe("jpg");
    expect(extFor("application/pdf")).toBe("pdf");
    expect(isAllowedMime("image/webp")).toBe(true);
    for (const mime of [
      "image/svg+xml",
      "text/html",
      "image/gif",
      "image/heic",
      "",
    ]) {
      expect(isAllowedMime(mime)).toBe(false);
    }
  });
});
