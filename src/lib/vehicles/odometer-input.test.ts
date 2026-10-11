import { describe, expect, it } from "vitest";
import { readingText, readingToSend } from "./odometer-input";

const MAX = 10_000_000;

describe("readingToSend", () => {
  it("sends a number that differs from the known reading", () => {
    expect(readingToSend("45300", 45200, MAX)).toEqual({
      ok: true,
      value: 45300,
    });
    expect(readingToSend("45'300.5", 45200, MAX)).toEqual({
      ok: true,
      value: 45300.5,
    });
  });

  it("sends nothing for an empty field", () => {
    expect(readingToSend("", 45200, MAX)).toEqual({ ok: true, value: null });
    expect(readingToSend("   ", null, MAX)).toEqual({ ok: true, value: null });
  });

  it("sends nothing for the reading the field was filled in with", () => {
    expect(readingToSend("45200", 45200, MAX)).toEqual({
      ok: true,
      value: null,
    });
    expect(readingToSend("45 200", 45200, MAX)).toEqual({
      ok: true,
      value: null,
    });
  });

  it("sends the first reading of a vehicle that has none", () => {
    expect(readingToSend("120", null, MAX)).toEqual({ ok: true, value: 120 });
    expect(readingToSend("0", undefined, MAX)).toEqual({ ok: true, value: 0 });
  });

  it("refuses text that is no reading", () => {
    expect(readingToSend("abc", 45200, MAX)).toEqual({ ok: false });
    expect(readingToSend("-5", 45200, MAX)).toEqual({ ok: false });
    expect(readingToSend(String(MAX + 1), 45200, MAX)).toEqual({ ok: false });
  });
});

describe("readingText", () => {
  it("writes the known reading as the field starts with it", () => {
    expect(readingText(45200)).toBe("45200");
    expect(readingText(45200.5)).toBe("45200.5");
    expect(readingText(null)).toBe("");
    expect(readingText(undefined)).toBe("");
  });
});
