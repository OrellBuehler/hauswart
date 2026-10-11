import { describe, expect, it } from "vitest";
import { USER_LOCALES } from "$lib/api/enums";
import { m } from "$lib/paraglide/messages";
import { templateMark } from "./template-mark";
import { tireChange, tireChangeByTitle } from "./tire-task";

describe("tireChangeByTitle", () => {
  it.each([
    ["Winterreifen aufziehen", "winter"],
    ["Sommerreifen aufziehen", "summer"],
    ["Reifenwechsel", null],
    ["Pneuwechsel Winter", "winter"],
    ["Räderwechsel im Frühling", null],
    ["Switch to winter tires", "winter"],
    ["Change tyres", null],
    ["Mount summer tires", "summer"],
    ["Ganzjahresreifen montieren", "all_season"],
    ["Winterreifen auf Sommerreifen wechseln", "summer"],
    ["Switch from winter to summer tires", "summer"],
    ["Radwechsel", null],
    ["Radwechsel Winter", "winter"],
    ["radwechsel im Frühling", null],
    ["Winterräder aufziehen", "winter"],
  ])("knows %j as a tire change (season %j)", (title, season) => {
    expect(tireChangeByTitle(title)).toEqual({ season });
  });

  it("knows the titles of the vehicle templates in every language", () => {
    for (const locale of USER_LOCALES) {
      expect(
        tireChangeByTitle(m.vehicle_task_tires_winter_title({}, { locale })),
      ).toEqual({ season: "winter" });
      expect(
        tireChangeByTitle(m.vehicle_task_tires_summer_title({}, { locale })),
      ).toEqual({ season: "summer" });
    }
  });

  it.each([
    "Reifendruck prüfen",
    "Check tire pressure",
    "Service",
    "MFK (Motorfahrzeugkontrolle)",
    "Bremsflüssigkeit wechseln",
    "Oil change",
    "Winterdienst",
    "Radiator wechseln",
    "Fahrradwechsel",
    "Radar prüfen",
  ])("does not take %j for one", (title) => {
    expect(tireChangeByTitle(title)).toBeNull();
  });
});

describe("tireChange", () => {
  const ASSET = "6f1c2d3e-0000-4000-8000-000000000001";
  const marked = (id: string, title: string, n = 1) => ({
    title,
    ...templateMark(ASSET, id, n),
  });

  it("knows the tire templates by their mark, whatever the title says now", () => {
    expect(tireChange(marked("tires_winter", "Garage"))).toEqual({
      season: "winter",
    });
    expect(tireChange(marked("tires_summer", "Garage", 3))).toEqual({
      season: "summer",
    });
  });

  it("takes the season from the mark, not from a title that says otherwise", () => {
    expect(
      tireChange(marked("tires_summer", "Winterreifen aufziehen")),
    ).toEqual({ season: "summer" });
  });

  it("offers nothing for the other templates, even with a title that sounds alike", () => {
    expect(
      tireChange(marked("service", "Service, Reifenwechsel inklusive")),
    ).toBeNull();
    expect(
      tireChange(marked("brake_fluid", "Winterreifen aufziehen")),
    ).toBeNull();
  });

  it("falls back on the title for a task without a mark", () => {
    expect(tireChange({ title: "Winterreifen aufziehen" })).toEqual({
      season: "winter",
    });
    expect(
      tireChange({
        title: "Radwechsel",
        externalSource: null,
        externalRef: null,
      }),
    ).toEqual({ season: null });
    expect(tireChange({ title: "Service" })).toBeNull();
  });

  it("falls back on the title for a mark that is not ours or not readable", () => {
    expect(
      tireChange({
        title: "Sommerreifen aufziehen",
        externalSource: "seed",
        externalRef: `${ASSET}:tires_winter`,
      }),
    ).toEqual({ season: "summer" });
    expect(
      tireChange({
        title: "Winterreifen aufziehen",
        externalSource: "vehicle_template",
        externalRef: "garbled",
      }),
    ).toEqual({ season: "winter" });
  });
});
