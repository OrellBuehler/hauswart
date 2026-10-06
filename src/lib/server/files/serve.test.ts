import { describe, expect, it } from "vitest";
import { defaultDisposition, fileResponse } from "./serve";

const body = () => new Blob([new Uint8Array([1, 2, 3, 4, 5])]);

describe("fileResponse", () => {
  it("serves inline images with security headers", async () => {
    const response = fileResponse(body(), {
      mime: "image/jpeg",
      filename: "Küche.jpg",
      disposition: "inline",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Disposition")).toBe(
      "inline; filename=\"Kueche.jpg\"; filename*=UTF-8''K%C3%BCche.jpg",
    );
    expect(response.headers.get("Content-Length")).toBe("5");
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    const csp = response.headers.get("Content-Security-Policy")!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("img-src 'self'");
    expect(csp).toContain("style-src 'unsafe-inline'");
    expect(csp).toContain("sandbox");
    expect(csp).toContain("frame-ancestors 'self'");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it("uses immutable private caching by default", () => {
    const response = fileResponse(body(), {
      mime: "image/png",
      filename: "a.png",
      disposition: "inline",
    });
    expect(response.headers.get("Cache-Control")).toBe(
      "private, max-age=31536000, immutable",
    );
  });

  it("supports no-store", () => {
    const response = fileResponse(body(), {
      mime: "image/png",
      filename: "a.png",
      disposition: "inline",
      cache: "no-store",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("serves attachments with a sandboxed csp", () => {
    const response = fileResponse(body(), {
      mime: "application/pdf",
      filename: "Handbuch.pdf",
      disposition: "attachment",
    });
    expect(response.headers.get("Content-Disposition")).toMatch(
      /^attachment; /,
    );
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "sandbox",
    );
  });

  it("serves pdfs inline without the csp sandbox (browser pdf viewers cannot run sandboxed)", () => {
    const response = fileResponse(body(), {
      mime: "application/pdf",
      filename: "Handbuch.pdf",
      disposition: "inline",
    });
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toMatch(/^inline; /);
    const csp = response.headers.get("Content-Security-Policy")!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("sandbox");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("forces unknown or dangerous mime types to an octet-stream attachment", () => {
    for (const mime of [
      "text/html",
      "image/svg+xml",
      "application/javascript",
      "image/gif",
      "",
      "image/jpeg; charset=x",
    ]) {
      const response = fileResponse(body(), {
        mime,
        filename: "x.html",
        disposition: "inline",
      });
      expect(response.headers.get("Content-Type"), mime).toBe(
        "application/octet-stream",
      );
      expect(response.headers.get("Content-Disposition"), mime).toMatch(
        /^attachment; /,
      );
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
  });

  it("keeps hostile filenames out of the headers", () => {
    const response = fileResponse(body(), {
      mime: "image/png",
      filename: 'a"\r\nSet-Cookie: x=1\r\n\r\n<script>.png',
      disposition: "inline",
    });
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("Content-Disposition")).not.toMatch(/[\r\n]/);
  });

  it("answers matching conditional requests with 304 and no body", async () => {
    const etag = '"abc"';
    const make = (header: string) =>
      fileResponse(body(), {
        mime: "image/png",
        filename: "a.png",
        disposition: "inline",
        etag,
        request: new Request("https://example.org/f", {
          headers: { "If-None-Match": header },
        }),
      });
    for (const header of ['"abc"', 'W/"abc"', '"x", "abc"', "*"]) {
      const response = make(header);
      expect(response.status, header).toBe(304);
      expect(response.headers.get("ETag")).toBe(etag);
      expect(response.headers.get("Cache-Control")).toContain("immutable");
      expect(await response.text()).toBe("");
    }
    expect(make('"other"').status).toBe(200);
  });

  it("sets the etag on 200 responses and ignores conditional headers without one", () => {
    const withTag = fileResponse(body(), {
      mime: "image/png",
      filename: "a.png",
      disposition: "inline",
      etag: '"abc"',
    });
    expect(withTag.headers.get("ETag")).toBe('"abc"');
    const request = new Request("https://example.org/f", {
      headers: { "If-None-Match": "*" },
    });
    expect(
      fileResponse(body(), {
        mime: "image/png",
        filename: "a.png",
        disposition: "inline",
        request,
      }).status,
    ).toBe(200);
  });
});

describe("defaultDisposition", () => {
  it("is inline for the allowlisted types and attachment otherwise", () => {
    expect(defaultDisposition("image/jpeg")).toBe("inline");
    expect(defaultDisposition("application/pdf")).toBe("inline");
    expect(defaultDisposition("text/html")).toBe("attachment");
  });
});
