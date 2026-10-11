import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import AppointmentBadge from "./appointment-badge.svelte";

const appointment = {
  id: "appointment-1",
  allDay: false,
  startsAt: "2026-10-12T05:30:00.000Z",
  startDate: null,
};
const props = { appointment, timeZone: "Europe/Zurich", today: "2026-10-11" };
const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("appointment badge", () => {
  it("says when, in the household's zone, and links to the appointment", () => {
    const { body } = render(AppointmentBadge as never, {
      props: props as never,
    });
    expect(body).toMatch(/<a\b[^>]*href="\/appointments\/appointment-1"/);
    expect(text(body)).toContain("07:30");
  });

  it("is plain text inside a row that is a link itself", () => {
    const { body } = render(AppointmentBadge as never, {
      props: { ...props, linked: false } as never,
    });
    expect(body).not.toMatch(/<a\b/);
    expect(text(body)).toContain("07:30");
  });

  it("gives a screen reader the word for what the date is", () => {
    const { body } = render(AppointmentBadge as never, {
      props: props as never,
    });
    expect(body).toMatch(/class="sr-only"/);
  });

  it("names an all-day appointment by its day only", () => {
    const { body } = render(AppointmentBadge as never, {
      props: {
        ...props,
        appointment: {
          ...appointment,
          allDay: true,
          startsAt: null,
          startDate: "2026-10-12",
        },
      } as never,
    });
    expect(text(body)).not.toMatch(/\d\d:\d\d/);
  });
});
