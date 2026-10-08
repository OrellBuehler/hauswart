import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import * as pageOptions from "./+page";
import Page from "./+page.svelte";

describe("offline page", () => {
  it("is rendered on the server only: nothing may hydrate on the address of the page that failed", () => {
    expect(pageOptions.csr).toBe(false);
  });

  const { body, head } = render(Page as never, { props: {} as never });

  it("says what is wrong and offers the way out, in the language of the visitor (German here)", () => {
    expect(head).toContain("<title>Keine Verbindung · hauswart</title>");
    expect(body).toContain("Keine Verbindung");
    expect(body).toContain("Erneut versuchen");
  });

  it("offers a retry without JavaScript: a link to the page that was asked for", () => {
    expect(body).toMatch(/<a href="\?"[\s\S]*?>Erneut versuchen<\/a>/);
  });

  it("holds no script and no user data", () => {
    expect(body).not.toContain("<script");
    expect(body).not.toMatch(/data-sveltekit/);
  });
});
