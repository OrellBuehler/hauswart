import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import Page from "./+page.svelte";

const { body } = render(Page as never, {
  props: { data: { tokenRequired: true } } as never,
});

const form = body.match(/<form\b[^>]*>/)?.[0] ?? "";

describe("setup page", () => {
  it("posts its form: without JavaScript a native GET would put the password in the address", () => {
    expect(form).toMatch(/\smethod="post"/);
    expect(form).not.toMatch(/\smethod="get"/i);
  });

  it("asks the phone keyboard for the right keys", () => {
    expect(body).toMatch(/<input[^>]*id="username"[^>]*enterkeyhint="next"/);
    expect(body).toMatch(/<input[^>]*id="username"[^>]*autocorrect="off"/);
    expect(body).toMatch(/<input[^>]*id="displayName"[^>]*enterkeyhint="next"/);
    expect(body).toMatch(/<input[^>]*id="password"[^>]*enterkeyhint="next"/);
    expect(body).toMatch(/<input[^>]*id="confirm"[^>]*enterkeyhint="go"/);
  });

  it("names the confirmation field so password managers pair it with the password", () => {
    expect(body).toMatch(/<input[^>]*id="confirm"[^>]*name="confirm"/);
  });
});
