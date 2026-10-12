import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import PendingReceiptsCard from "./pending-receipts-card.svelte";

const html = (count: number) =>
  render(PendingReceiptsCard as never, { props: { count } as never }).body;

describe("the dashboard's card for receipts that wait", () => {
  it("counts them and opens the ones that wait", () => {
    const body = html(3);
    expect(body).toContain("Belege warten");
    expect(body).toContain("3 offene Belege");
    expect(body).toContain('href="/costs/receipts?status=pending"');
  });

  it("says one receipt in the singular", () => {
    expect(html(1)).toContain("1 offener Beleg");
  });
});
