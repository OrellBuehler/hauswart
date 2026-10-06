import { describe, expect, it } from "vitest";
import { createTestEvent } from "$lib/testing/event";
import { handle } from "./hooks.server";

async function renderedLang(headers: Record<string, string> = {}) {
  const event = createTestEvent({ url: "http://localhost/", headers });
  let html = "";
  const resolve = async (
    _event: unknown,
    opts?: {
      transformPageChunk?: (input: {
        html: string;
        done: boolean;
      }) => string | undefined;
    },
  ) => {
    html =
      opts?.transformPageChunk?.({
        html: '<html lang="%lang%">',
        done: true,
      }) ?? "";
    return new Response("ok");
  };
  await handle({ event: event as never, resolve: resolve as never });
  return html;
}

describe("handle", () => {
  it("falls back to the base locale", async () => {
    expect(await renderedLang()).toBe('<html lang="de">');
  });

  it("uses the preferred browser language when no cookie is set", async () => {
    expect(await renderedLang({ "accept-language": "en" })).toBe(
      '<html lang="en">',
    );
  });

  it("prefers the locale cookie over the browser language", async () => {
    expect(
      await renderedLang({
        cookie: "PARAGLIDE_LOCALE=de",
        "accept-language": "en",
      }),
    ).toBe('<html lang="de">');
  });
});
