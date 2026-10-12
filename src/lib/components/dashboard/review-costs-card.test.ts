import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import ReviewCostsCard from "./review-costs-card.svelte";

const html = (count: number) =>
  render(ReviewCostsCard as never, { props: { count } as never }).body;

describe("the dashboard's review card", () => {
  it("counts the entries and opens them in every book and year", () => {
    const body = html(3);
    expect(body).toContain("Ausgaben prüfen");
    expect(body).toContain("3 Einträge zu prüfen");
    expect(body).toContain('href="/costs?book=all&amp;year=all&amp;review=1"');
  });

  it("says one entry in the singular", () => {
    expect(html(1)).toContain("1 Eintrag zu prüfen");
  });
});
