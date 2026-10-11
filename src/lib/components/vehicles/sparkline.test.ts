import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import Sparkline from "./sparkline.svelte";

const points = [
  { date: "2026-01-01", value: 1.8 },
  { date: "2026-02-01", value: 1.9 },
  { date: "2026-03-01", value: 1.85 },
];

describe("Sparkline", () => {
  it("is a picture with a text for people who cannot see it", () => {
    const { body } = render(Sparkline as never, {
      props: { points, label: "Preis von 1.80 auf 1.85" } as never,
    });
    expect(body).toMatch(/<svg[^>]*role="img"/);
    expect(body).toMatch(/aria-label="Preis von 1.80 auf 1.85"/);
  });

  it("takes its colours from the theme, so dark mode follows", () => {
    const { body } = render(Sparkline as never, {
      props: { points, label: "x" } as never,
    });
    expect(body).toMatch(/class="[^"]*text-brand/);
    expect(body).toMatch(/stroke="currentColor"/);
    expect(body).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i);
  });

  it("draws nothing for a single point", () => {
    const { body } = render(Sparkline as never, {
      props: { points: points.slice(0, 1), label: "x" } as never,
    });
    expect(body).not.toContain("<svg");
  });
});
