import { describe, expect, it } from "vitest";
import {
  contentDisposition,
  sanitizeFilename,
  withExtension,
} from "./filename";

describe("sanitizeFilename", () => {
  it("keeps ordinary names and umlauts", () => {
    expect(sanitizeFilename("Bedienungsanleitung.pdf")).toBe(
      "Bedienungsanleitung.pdf",
    );
    expect(sanitizeFilename("Rechnung Küche äöü ß.pdf")).toBe(
      "Rechnung Küche äöü ß.pdf",
    );
    expect(sanitizeFilename("Foto 🏠.jpg")).toBe("Foto 🏠.jpg");
  });

  it("normalizes decomposed umlauts to NFC", () => {
    expect(sanitizeFilename("U\u0308bergabe.pdf")).toBe("Übergabe.pdf");
  });

  it("strips path components of both separators", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("..\\..\\windows\\system32\\evil.dll")).toBe(
      "evil.dll",
    );
    expect(sanitizeFilename("C:\\Users\\x\\foto.jpg")).toBe("foto.jpg");
    expect(sanitizeFilename("/abs/path/file.pdf")).toBe("file.pdf");
    expect(sanitizeFilename("dir/")).toBe("file");
  });

  it("removes control characters, newlines and null bytes", () => {
    expect(sanitizeFilename("a\r\nb.pdf")).toBe("ab.pdf");
    expect(sanitizeFilename("a\u0000b\u0007c\u001f.pdf")).toBe("abc.pdf");
    expect(sanitizeFilename("x\u0085y\u009f.pdf")).toBe("xy.pdf");
    expect(sanitizeFilename("a\u2028b\u2029.pdf")).toBe("ab.pdf");
  });

  it("removes bidi overrides and zero-width characters (extension spoofing)", () => {
    expect(sanitizeFilename("invoice\u202Efdp.exe")).toBe("invoicefdp.exe");
    expect(sanitizeFilename("a\u200bb\u200e\u2066c\ufeff.pdf")).toBe("abc.pdf");
  });

  it("removes the Arabic letter mark and invisible word joiners", () => {
    expect(sanitizeFilename("a\u061Cb.pdf")).toBe("ab.pdf");
    expect(sanitizeFilename("a\u2060b\u2061c\u2062d\u2063e\u2064f.pdf")).toBe(
      "abcdef.pdf",
    );
  });

  it("replaces quotes and reserved characters", () => {
    expect(sanitizeFilename('a"b.pdf')).toBe("a_b.pdf");
    expect(sanitizeFilename("a<b>c:d|e?f*g.pdf")).toBe("a_b_c_d_e_f_g.pdf");
  });

  it("removes leading and trailing dots and spaces", () => {
    expect(sanitizeFilename(".htaccess")).toBe("htaccess");
    expect(sanitizeFilename("...hidden.pdf")).toBe("hidden.pdf");
    expect(sanitizeFilename("  name.pdf  ")).toBe("name.pdf");
    expect(sanitizeFilename("name.")).toBe("name");
    expect(sanitizeFilename("name. . .")).toBe("name");
  });

  it("collapses whitespace", () => {
    expect(sanitizeFilename("a \t  b.pdf")).toBe("a b.pdf");
  });

  it("falls back when nothing is left", () => {
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename("....")).toBe("file");
    expect(sanitizeFilename("\u0000\u0001")).toBe("file");
    expect(sanitizeFilename("///")).toBe("file");
    expect(sanitizeFilename("", "scan")).toBe("scan");
  });

  it("prefixes windows reserved device names", () => {
    expect(sanitizeFilename("CON.txt")).toBe("_CON.txt");
    expect(sanitizeFilename("nul")).toBe("_nul");
    expect(sanitizeFilename("com1.pdf")).toBe("_com1.pdf");
    expect(sanitizeFilename("console.pdf")).toBe("console.pdf");
  });

  it("limits the length and keeps the extension", () => {
    const result = sanitizeFilename(`${"a".repeat(500)}.pdf`);
    expect([...result].length).toBe(120);
    expect(result.endsWith(".pdf")).toBe(true);
  });

  it("does not split surrogate pairs when truncating", () => {
    const result = sanitizeFilename(`${"🏠".repeat(300)}.jpg`);
    expect([...result].length).toBe(120);
    expect(result).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(result.endsWith(".jpg")).toBe(true);
    expect(result.slice(0, -4)).toBe("🏠".repeat(116));
  });

  it("treats absurdly long extensions as part of the name", () => {
    const result = sanitizeFilename(`name.${"x".repeat(200)}`);
    expect([...result].length).toBe(120);
  });

  it("is idempotent", () => {
    for (const name of [
      "a\r\nb.pdf",
      "../x.pdf",
      "Küche  .pdf",
      "..",
      "x".repeat(300) + ".pdf",
    ]) {
      const once = sanitizeFilename(name);
      expect(sanitizeFilename(once)).toBe(once);
    }
  });
});

describe("withExtension", () => {
  it("keeps a matching extension, case-insensitively and via aliases", () => {
    expect(withExtension("a.jpg", "jpg")).toBe("a.jpg");
    expect(withExtension("a.JPG", "jpg")).toBe("a.JPG");
    expect(withExtension("a.jpeg", "jpg", ["jpeg"])).toBe("a.jpeg");
  });

  it("replaces another well-known media extension", () => {
    expect(withExtension("plan.png", "jpg", ["jpeg"])).toBe("plan.jpg");
    expect(withExtension("virus.html", "pdf")).toBe("virus.pdf");
    expect(withExtension("photo.heic", "jpg", ["jpeg"])).toBe("photo.jpg");
  });

  it("appends when the extension is unknown or missing", () => {
    expect(withExtension("report.v2", "pdf")).toBe("report.v2.pdf");
    expect(withExtension("noext", "png")).toBe("noext.png");
    expect(withExtension("a.b.c", "webp")).toBe("a.b.c.webp");
  });
});

describe("contentDisposition", () => {
  it("emits an ascii fallback and an RFC 5987 filename*", () => {
    expect(contentDisposition("attachment", "Küche Größe.pdf")).toBe(
      "attachment; filename=\"Kueche Groesse.pdf\"; filename*=UTF-8''K%C3%BCche%20Gr%C3%B6%C3%9Fe.pdf",
    );
  });

  it("supports inline", () => {
    expect(contentDisposition("inline", "a.jpg")).toBe(
      "inline; filename=\"a.jpg\"; filename*=UTF-8''a.jpg",
    );
  });

  it("encodes characters that are not RFC 5987 attr-chars", () => {
    const value = contentDisposition("inline", "it's (1).pdf");
    expect(value).toContain("filename*=UTF-8''it%27s%20%281%29.pdf");
  });

  it("neutralizes quotes, backslashes, percent signs, newlines and header injection", () => {
    const value = contentDisposition(
      "attachment",
      'x";\r\nSet-Cookie: session=1\r\nContent-Type: text/html\r\n\r\n<script>.pdf',
    );
    expect(value).not.toMatch(/[\r\n]/);
    expect(value.match(/"/g)?.length).toBe(2);
    expect(value).not.toContain("\\");
    const fallback = /filename="([^"]*)"/.exec(value)![1]!;
    expect(fallback).not.toContain('"');
    expect(fallback).not.toContain(";");
    expect(fallback).toMatch(/^[\x20-\x7e]+$/);
  });

  it("uses underscores for characters without ascii fallback", () => {
    expect(contentDisposition("inline", "日本語.pdf")).toContain(
      'filename="___.pdf"',
    );
    expect(contentDisposition("inline", "Café.pdf")).toContain(
      'filename="Cafe.pdf"',
    );
    expect(contentDisposition("inline", "100%.pdf")).toContain(
      'filename="100_.pdf"',
    );
  });

  it("sanitizes path components and falls back for empty names", () => {
    expect(contentDisposition("inline", "../../x.pdf")).toContain(
      'filename="x.pdf"',
    );
    expect(contentDisposition("inline", "")).toContain('filename="file"');
  });

  it("round-trips the sanitized name through decodeURIComponent", () => {
    const value = contentDisposition("inline", "Übergabe Küche 🏠.pdf");
    const encoded = /filename\*=UTF-8''(.*)$/.exec(value)![1]!;
    expect(decodeURIComponent(encoded)).toBe("Übergabe Küche 🏠.pdf");
  });
});
