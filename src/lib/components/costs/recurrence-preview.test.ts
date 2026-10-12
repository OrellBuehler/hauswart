import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import type { RecurrenceRule } from "$lib/costs/recurrence";
import RecurrencePreview from "./recurrence-preview.svelte";

const TODAY = "2026-10-12";

const rule = (over: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  frequency: "monthly",
  interval: 1,
  dayOfMonth: 15,
  startDate: "2026-10-12",
  endDate: null,
  ...over,
});

const html = (props: Record<string, unknown>) =>
  render(RecurrencePreview as never, {
    props: { today: TODAY, ...props } as never,
  }).body;

describe("RecurrencePreview", () => {
  it("says the rhythm in words and lists the next three dates", () => {
    const body = html({ rule: rule() });
    expect(body).toContain("Monatlich am 15.");
    expect(body).toContain("Die nächsten Buchungen");
    expect(body.match(/<li>/g)).toHaveLength(3);
    expect(body).toContain("15. Okt");
    expect(body).toContain("15. Dez");
  });

  it("waits for a valid rhythm", () => {
    const body = html({ rule: null });
    expect(body).toContain("Sobald der Rhythmus stimmt");
    expect(body).not.toContain("<ol");
  });

  it("explains month-end clamping for a day beyond the 28th", () => {
    expect(html({ rule: rule({ dayOfMonth: 31 }) })).toContain(
      "Gibt es den 31. in einem Monat nicht",
    );
    expect(html({ rule: rule() })).not.toContain("letzten Tag");
  });

  it("warns how many entries saving books at once for a start date in the past", () => {
    const body = html({
      rule: rule({ startDate: "2026-07-20", dayOfMonth: 5 }),
    });
    expect(body).toContain("Bucht sofort 3 Einträge seit 05.08.2026");
    expect(body).toContain('role="status"');
  });

  it("does not warn for a recurring cost that books nothing when saved", () => {
    const body = html({
      rule: rule({ startDate: "2026-07-20", dayOfMonth: 5 }),
      booking: false,
    });
    expect(body).not.toContain("Bucht sofort");
  });

  it("says when nothing is left to book", () => {
    const body = html({ rule: rule({ endDate: "2026-10-12", dayOfMonth: 1 }) });
    expect(body).toContain("keine weitere Buchung");
  });

  it("shows a hint under the dates", () => {
    expect(
      html({ rule: rule(), ruleHint: "Ein geänderter Rhythmus." }),
    ).toContain("Ein geänderter Rhythmus.");
  });
});
