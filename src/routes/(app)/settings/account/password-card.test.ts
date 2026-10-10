import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import PasswordCard from "./password-card.svelte";

const { body } = render(PasswordCard as never, {
  props: { username: "demo" } as never,
});

const form = body.match(/<form\b[^>]*>/)?.[0] ?? "";

describe("password card", () => {
  it("posts its form: before the script has loaded a native GET would put both passwords in the address", () => {
    expect(form).toMatch(/\smethod="post"/);
    expect(form).not.toMatch(/\smethod="get"/i);
  });

  it("holds the password fields the browser's password manager expects", () => {
    expect(body).toMatch(/autocomplete="current-password"/);
    expect(body).toMatch(/autocomplete="new-password"/);
  });
});
