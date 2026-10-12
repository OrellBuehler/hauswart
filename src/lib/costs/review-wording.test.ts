import { describe, expect, it } from "vitest";
import { m } from "$lib/paraglide/messages";

describe("the words of the review flag", () => {
  it("calls the badge 'Zu prüfen' (an entry waits for a person) and the button says what it does", () => {
    expect(m.cost_badge_review()).toBe("Zu prüfen");
    expect(m.cost_badge_review({}, { locale: "en" })).toBe("To review");
    expect(m.cost_review_action()).toBe("Als geprüft markieren");
    expect(m.cost_review_action({}, { locale: "en" })).toBe("Mark as reviewed");
  });

  it("keeps 'Geprüft' for the state of an entry that was reviewed", () => {
    expect(m.cost_reviewed()).toBe("Geprüft");
    expect(m.cost_reviewed({}, { locale: "en" })).toBe("Reviewed");
  });
});
