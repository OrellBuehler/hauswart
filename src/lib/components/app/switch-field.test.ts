import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import SwitchField from "./switch-field.svelte";

function anchor(link: { label: string; sameTab?: boolean }): string {
  const { body } = render(SwitchField as never, {
    props: {
      id: "guest",
      label: "Guest visible",
      hint: "Shown on guest links.",
      link: { href: "/settings/guest-links", ...link },
    } as never,
  });
  return body.match(/<a\b[^>]*>/)?.[0] ?? "";
}

describe("switch field link", () => {
  // The switch sits in forms whose unsaved input would be lost by following a link in the same tab.
  it("opens in a tab of its own by default", () => {
    const a = anchor({ label: "Manage guest links" });
    expect(a).toMatch(/\shref="\/settings\/guest-links"/);
    expect(a).toMatch(/\starget="_blank"/);
    expect(a).toMatch(/\srel="noopener"/);
  });

  it("stays in the same tab when the form guards against leaving", () => {
    const a = anchor({ label: "Manage guest links", sameTab: true });
    expect(a).not.toMatch(/target=/);
    expect(a).not.toMatch(/rel=/);
  });

  it("is only left in the same tab where the form asks before it is left", () => {
    const sameTab = [
      "../docs/doc-editor.svelte",
      "../hints/hint-form-dialog.svelte",
      "../contacts/contact-form-dialog.svelte",
    ].filter((file) =>
      readFileSync(new URL(file, import.meta.url), "utf8").includes("sameTab"),
    );
    expect(sameTab).toEqual(["../docs/doc-editor.svelte"]);
  });
});
