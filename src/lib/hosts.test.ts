import { describe, expect, it } from "vitest";
import { isHostAllowed, normalizeHostEntry } from "./hosts";

describe("normalizeHostEntry", () => {
  it.each([
    ["docs.example.org", "docs.example.org"],
    ["  Docs.Example.ORG ", "docs.example.org"],
    ["docs.example.org.", "docs.example.org"],
    ["docs.example.org:8000", "docs.example.org:8000"],
    ["docs.example.org:80", "docs.example.org:80"],
    ["docs.example.org:443", "docs.example.org:443"],
    ["bücher.example.org", "xn--bcher-kva.example.org"],
    ["BÜCHER.example.org:8443", "xn--bcher-kva.example.org:8443"],
    ["192.168.1.20", "192.168.1.20"],
    ["192.168.1.20:8080", "192.168.1.20:8080"],
    ["[::1]", "[::1]"],
    ["[FD00::5]:8000", "[fd00::5]:8000"],
  ])("normalises %s", (input, expected) => {
    expect(normalizeHostEntry(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "https://docs.example.org",
    "docs.example.org/path",
    "user@docs.example.org",
    "docs.example.org?x=1",
    "docs.example.org#frag",
    "docs example.org",
    "docs.example.org:",
    "docs.example.org:0",
    "docs.example.org:65536",
    "docs.example.org:abc",
    "*.example.org",
    "a:b:c",
  ])("rejects %j", (input) => {
    expect(normalizeHostEntry(input)).toBeNull();
  });
});

describe("isHostAllowed", () => {
  const list = ["docs.example.org", "kept.example.org:8443", "[fd00::5]"];

  it("matches the host exactly and ignores case", () => {
    expect(isHostAllowed("https://DOCS.example.org/sub", list)).toBe(true);
    expect(isHostAllowed("http://docs.example.org:8000", list)).toBe(true);
  });

  it("does not match subdomains, parents or look-alikes", () => {
    expect(isHostAllowed("https://a.docs.example.org", list)).toBe(false);
    expect(isHostAllowed("https://example.org", list)).toBe(false);
    expect(isHostAllowed("https://docs.example.org.evil.test", list)).toBe(
      false,
    );
    expect(isHostAllowed("https://xdocs.example.org", list)).toBe(false);
  });

  it("an entry with a port matches that port only, the default port included", () => {
    expect(isHostAllowed("https://kept.example.org:8443", list)).toBe(true);
    expect(isHostAllowed("https://kept.example.org", list)).toBe(false);
    expect(isHostAllowed("https://kept.example.org:9000", list)).toBe(false);
    expect(isHostAllowed("https://x.example.org", ["x.example.org:443"])).toBe(
      true,
    );
    expect(isHostAllowed("http://x.example.org", ["x.example.org:443"])).toBe(
      false,
    );
    expect(isHostAllowed("http://x.example.org", ["x.example.org:80"])).toBe(
      true,
    );
  });

  it("compares internationalised names in their ascii form", () => {
    expect(
      isHostAllowed("https://BÜCHER.example.org", ["bücher.example.org"]),
    ).toBe(true);
    expect(
      isHostAllowed("https://xn--bcher-kva.example.org", [
        "BÜCHER.example.org",
      ]),
    ).toBe(true);
  });

  it("matches IP literals in every spelling the URL parser knows", () => {
    expect(isHostAllowed("http://[FD00:0:0:0:0:0:0:5]:9000", list)).toBe(true);
    expect(isHostAllowed("http://192.168.1.20", ["192.168.1.20"])).toBe(true);
    expect(isHostAllowed("http://3232235796", ["192.168.1.20"])).toBe(true);
  });

  it("an empty list allows nothing and a bad address allows nothing", () => {
    expect(isHostAllowed("https://docs.example.org", [])).toBe(false);
    expect(isHostAllowed("not a url", list)).toBe(false);
  });
});
