import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import type { RecurrenceRule } from "$lib/costs/recurrence";
import RecurrenceUpcoming from "./recurrence-upcoming.svelte";

const TODAY = "2026-10-12";

const rule = (over: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  frequency: "monthly",
  interval: 1,
  dayOfMonth: 15,
  startDate: "2026-01-15",
  endDate: null,
  ...over,
});

const html = (
  recurrence: { active: boolean; nextDate: string | null },
  over: Partial<RecurrenceRule> = {},
) =>
  render(RecurrenceUpcoming as never, {
    props: { recurrence, rule: rule(over), today: TODAY } as never,
  }).body;

describe("RecurrenceUpcoming", () => {
  it("lists the next three dates of a recurring cost that books", () => {
    const body = html({ active: true, nextDate: "2026-10-15" });
    expect(body).toContain("Nächste Buchungen");
    expect(body.match(/<li>/g)).toHaveLength(3);
    expect(body).toContain("15. Okt");
    expect(body).toContain("15. Dez");
    expect(body).not.toContain("Pausiert");
  });

  it("lists no dates for a paused one and says it goes on from the next date when resumed", () => {
    const body = html({ active: false, nextDate: "2026-10-15" });
    expect(body).toContain("Nächste Buchungen");
    expect(body).toContain(
      "Pausiert: Beim Fortsetzen geht es ab dem nächsten Termin weiter.",
    );
    expect(body).not.toContain("<li>");
    expect(body).not.toContain("15. Okt");
    expect(body).not.toContain("Die Wiederholung ist beendet");
  });

  it("says a finished one has no further booking", () => {
    const body = html(
      { active: true, nextDate: null },
      { endDate: "2026-06-15" },
    );
    expect(body).toContain("Keine weitere Buchung");
    expect(body).not.toContain("<li>");
    expect(body).not.toContain("Pausiert");
  });

  it("calls a paused one that is over finished, not paused", () => {
    const body = html(
      { active: false, nextDate: null },
      { endDate: "2026-06-15" },
    );
    expect(body).toContain("Keine weitere Buchung");
    expect(body).not.toContain("Pausiert");
  });

  it("always names where booked entries lead", () => {
    for (const recurrence of [
      { active: true, nextDate: "2026-10-15" },
      { active: false, nextDate: "2026-10-15" },
      { active: true, nextDate: null },
    ]) {
      expect(html(recurrence)).toContain("Wiederkehrend");
    }
  });
});
