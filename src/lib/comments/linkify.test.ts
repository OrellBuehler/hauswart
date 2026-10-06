import { describe, expect, it } from "vitest";
import { linkify } from "./linkify";

describe("linkify", () => {
  it("returns plain text as one segment", () => {
    expect(linkify("kein Link\nzweite Zeile")).toEqual([
      { text: "kein Link\nzweite Zeile" },
    ]);
  });

  it("returns nothing for an empty string", () => {
    expect(linkify("")).toEqual([]);
  });

  it("links http and https urls and keeps the surrounding text", () => {
    expect(
      linkify("siehe https://example.org/a?b=1 und http://example.net"),
    ).toEqual([
      { text: "siehe " },
      { text: "https://example.org/a?b=1", href: "https://example.org/a?b=1" },
      { text: " und " },
      { text: "http://example.net", href: "http://example.net/" },
    ]);
  });

  it("leaves sentence punctuation outside the link", () => {
    expect(linkify("Mehr unter https://example.org/x.")).toEqual([
      { text: "Mehr unter " },
      { text: "https://example.org/x", href: "https://example.org/x" },
      { text: "." },
    ]);
    expect(linkify("(https://example.org/x)")).toEqual([
      { text: "(" },
      { text: "https://example.org/x", href: "https://example.org/x" },
      { text: ")" },
    ]);
  });

  it("keeps balanced brackets inside the link", () => {
    const [link] = linkify("https://example.org/a_(b)");
    expect(link).toEqual({
      text: "https://example.org/a_(b)",
      href: "https://example.org/a_(b)",
    });
  });

  it("never links other schemes or markup", () => {
    expect(
      linkify('javascript:alert(1) <a href="https://example.org">x</a>'),
    ).toEqual([
      { text: 'javascript:alert(1) <a href="' },
      { text: "https://example.org", href: "https://example.org/" },
      { text: '">x</a>' },
    ]);
  });

  it("does not link a scheme without a host", () => {
    expect(linkify("https://")).toEqual([{ text: "https://" }]);
  });
});
