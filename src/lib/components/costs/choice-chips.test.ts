import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import ChoiceChips from "./choice-chips.svelte";

const options = [
  { value: "a", label: "Anna" },
  { value: "b", label: "Ben" },
  { value: "c", label: "Cara" },
];

const html = (props: Record<string, unknown>) =>
  render(ChoiceChips as never, {
    props: { options, label: "Wer", ...props } as never,
  }).body;

describe("choice chips", () => {
  it("are a radio group for one choice, with the chosen chip checked and the only tab stop", () => {
    const body = html({ value: "b" });
    expect(body).toContain('role="radiogroup"');
    expect(body).toContain('aria-label="Wer"');
    expect(body.match(/role="radio"/g)).toHaveLength(3);
    expect(body.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(body.match(/tabindex="0"/g)).toHaveLength(1);
    expect(body).toMatch(/aria-checked="true"[^>]*>(?:(?!<button)[\s\S])*Ben/);
  });

  it("start with the first chip as the tab stop while none is chosen", () => {
    const body = html({ value: "" });
    expect(body.match(/aria-checked="true"/g)).toBeNull();
    expect(body.match(/tabindex="0"/g)).toHaveLength(1);
  });

  it("are toggle buttons for several, ticked rather than only coloured", () => {
    const body = html({ mode: "multiple", values: ["a", "c"] });
    expect(body).toContain('role="group"');
    expect(body).not.toContain('role="radio"');
    expect(body.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(body.match(/aria-pressed="false"/g)).toHaveLength(1);
    expect(body.match(/lucide-check/g)).toHaveLength(2);
  });

  it("end with a chip of their own that is pressed while it is on", () => {
    const extra = (on: boolean) => ({
      label: "Nicht teilen",
      on,
      onselect: () => {},
    });
    const off = html({ mode: "multiple", values: ["a"], extra: extra(false) });
    expect(off).toContain("Nicht teilen");
    expect(off.match(/aria-pressed="false"/g)).toHaveLength(3);
    expect(off.match(/aria-pressed="true"/g)).toHaveLength(1);
    const on = html({ mode: "multiple", values: [], extra: extra(true) });
    expect(on.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(on.match(/lucide-check/g)).toHaveLength(1);
    expect(html({ mode: "multiple", values: [] })).not.toContain(
      "Nicht teilen",
    );
  });

  it("are big enough to tap one-handed", () => {
    const body = html({ value: "a" });
    expect(body).toContain("min-h-11");
    expect(body).toContain("pointer-coarse:min-h-12");
  });

  it("show a problem on the group and can be switched off", () => {
    const body = html({ invalid: true, describedby: "err", disabled: true });
    expect(body).toContain('aria-invalid="true"');
    expect(body).toContain('aria-describedby="err"');
    expect(body.match(/disabled/g)!.length).toBeGreaterThanOrEqual(3);
  });
});
