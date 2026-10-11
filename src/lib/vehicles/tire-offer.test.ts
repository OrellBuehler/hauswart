import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TireOffers } from "./tire-offer.svelte";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("TireOffers", () => {
  it("offers to mount a set once a tire change is completed, after the dialog has closed", () => {
    const offers = new TireOffers();
    offers.offer({ title: "Winterreifen aufziehen", assetId: "a1" });
    expect(offers.current).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(offers.current).toEqual({
      assetId: "a1",
      taskTitle: "Winterreifen aufziehen",
      season: "winter",
    });
  });

  it("offers nothing for any other task or a task without an asset", () => {
    const offers = new TireOffers();
    offers.offer({ title: "Service", assetId: "a1" });
    offers.offer({ title: "Reifenwechsel", assetId: null });
    offers.offer({ title: "Reifenwechsel" });
    vi.advanceTimersByTime(1000);
    expect(offers.current).toBeNull();
  });

  it("takes an offer back before it shows", () => {
    const offers = new TireOffers();
    offers.offer({ title: "Reifenwechsel", assetId: "a1" });
    offers.dismiss();
    vi.advanceTimersByTime(1000);
    expect(offers.current).toBeNull();
  });

  it("closes the offer that is showing", () => {
    const offers = new TireOffers();
    offers.offer({ title: "Reifenwechsel", assetId: "a1" });
    vi.advanceTimersByTime(1000);
    expect(offers.current?.season).toBeNull();
    offers.dismiss();
    expect(offers.current).toBeNull();
  });

  it("keeps the latest of two offers", () => {
    const offers = new TireOffers();
    offers.offer({ title: "Winterreifen aufziehen", assetId: "a1" });
    offers.offer({ title: "Sommerreifen aufziehen", assetId: "a2" });
    vi.advanceTimersByTime(1000);
    expect(offers.current).toMatchObject({ assetId: "a2", season: "summer" });
  });
});
