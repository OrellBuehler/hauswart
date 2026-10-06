import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  it("reads the URL and token and drops trailing slashes", () => {
    expect(
      loadConfig({
        HAUSWART_URL: "https://hauswart.example.org///",
        HAUSWART_TOKEN: " hw_abc ",
      }),
    ).toEqual({ url: "https://hauswart.example.org", token: "hw_abc" });
  });

  it("keeps a path prefix", () => {
    expect(
      loadConfig({
        HAUSWART_URL: "http://localhost:3000/base/",
        HAUSWART_TOKEN: "hw_abc",
      }).url,
    ).toBe("http://localhost:3000/base");
  });

  it("says what is missing and where to get it", () => {
    expect(() => loadConfig({})).toThrow(
      /HAUSWART_URL: is not set; HAUSWART_TOKEN: is not set.*Settings > API tokens/,
    );
  });

  it("rejects other protocols without echoing the token", () => {
    const run = () =>
      loadConfig({
        HAUSWART_URL: "ftp://example.org",
        HAUSWART_TOKEN: "hw_secret",
      });
    expect(run).toThrow(/HAUSWART_URL/);
    try {
      run();
    } catch (err) {
      expect((err as Error).message).not.toContain("hw_secret");
    }
  });
});
