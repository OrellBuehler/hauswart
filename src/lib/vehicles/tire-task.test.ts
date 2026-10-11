import { describe, expect, it } from "vitest";
import { USER_LOCALES } from "$lib/api/enums";
import { m } from "$lib/paraglide/messages";
import { tireChange } from "./tire-task";

describe("tireChange", () => {
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
  ])("knows %j as a tire change (season %j)", (title, season) => {
    expect(tireChange(title)).toEqual({ season });
  });

  it("knows the titles of the vehicle templates in every language", () => {
    for (const locale of USER_LOCALES) {
      expect(
        tireChange(m.vehicle_task_tires_winter_title({}, { locale })),
      ).toEqual({ season: "winter" });
      expect(
        tireChange(m.vehicle_task_tires_summer_title({}, { locale })),
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
  ])("does not take %j for one", (title) => {
    expect(tireChange(title)).toBeNull();
  });
});
