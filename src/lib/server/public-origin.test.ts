import { describe, expect, it } from "vitest";
import {
  ORIGIN_HOST_HEADER,
  ORIGIN_PROTOCOL_HEADER,
  originAdapterEnv,
  parsePublicOrigin,
  stampPublicOrigin,
} from "./public-origin";

describe("parsePublicOrigin", () => {
  it("is null without ORIGIN", () => {
    expect(parsePublicOrigin(undefined)).toBeNull();
    expect(parsePublicOrigin("  ")).toBeNull();
  });

  it("takes an http or https origin, port included, with or without the trailing slash", () => {
    expect(parsePublicOrigin("https://hauswart.example.org")?.origin).toBe(
      "https://hauswart.example.org",
    );
    expect(parsePublicOrigin(" http://localhost:3000/ ")?.host).toBe(
      "localhost:3000",
    );
  });

  it("refuses anything that is not an origin", () => {
    for (const value of [
      "hauswart.example.org",
      "ftp://hauswart.example.org",
      "https://hauswart.example.org/app",
      "https://hauswart.example.org/?x=1",
      "https://user:pw@hauswart.example.org",
    ]) {
      expect(() => parsePublicOrigin(value), value).toThrow(/ORIGIN/);
    }
  });
});

describe("stamping the origin", () => {
  it("points the adapter at the stamped headers", () => {
    expect(originAdapterEnv()).toEqual({
      PROTOCOL_HEADER: ORIGIN_PROTOCOL_HEADER,
      HOST_HEADER: ORIGIN_HOST_HEADER,
    });
  });

  it("overwrites what a client sent under the same names", () => {
    const headers = new Headers({
      [ORIGIN_PROTOCOL_HEADER]: "https",
      [ORIGIN_HOST_HEADER]: "evil.example",
    });
    stampPublicOrigin(headers, parsePublicOrigin("http://localhost:3000")!);
    expect(headers.get(ORIGIN_PROTOCOL_HEADER)).toBe("http");
    expect(headers.get(ORIGIN_HOST_HEADER)).toBe("localhost:3000");
  });
});
