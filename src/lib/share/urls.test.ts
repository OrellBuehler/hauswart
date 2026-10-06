import { describe, expect, it } from "vitest";
import { absoluteUrl, webcalUrl } from "./urls";

describe("share urls", () => {
  it("keeps an absolute address and resolves a bare path", () => {
    expect(
      absoluteUrl("https://home.example.org/g/abc", "http://localhost:5173"),
    ).toBe("https://home.example.org/g/abc");
    expect(absoluteUrl("/g/abc", "https://home.example.org")).toBe(
      "https://home.example.org/g/abc",
    );
  });

  it("turns http and https into webcal", () => {
    expect(webcalUrl("https://home.example.org/api/public/cal/t.ics")).toBe(
      "webcal://home.example.org/api/public/cal/t.ics",
    );
    expect(webcalUrl("http://localhost:5191/api/public/cal/t.ics")).toBe(
      "webcal://localhost:5191/api/public/cal/t.ics",
    );
  });
});
