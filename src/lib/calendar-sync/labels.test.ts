import { describe, expect, it } from "vitest";
import { CALENDAR_ITEM_KINDS } from "$lib/api/enums";
import { m } from "$lib/paraglide/messages";
import {
  CREATE_ONLY_CAPABILITIES,
  FULL_CAPABILITIES,
} from "$lib/testing/calendar-targets";
import {
  calendarKindHints,
  calendarKindLabels,
  capabilityLabels,
  capabilityLevel,
  capabilityNotes,
} from "./labels";

describe("capabilityLevel", () => {
  it.each([
    ["nothing said", null, "unknown"],
    [
      "no create",
      { create: false, update: true, delete: true, alarms: false },
      "none",
    ],
    ["everything", FULL_CAPABILITIES, "full"],
    [
      "create and delete",
      { create: true, update: false, delete: true, alarms: false },
      "no_update",
    ],
    [
      "create and update",
      { create: true, update: true, delete: false, alarms: false },
      "no_delete",
    ],
    ["create only", CREATE_ONLY_CAPABILITIES, "create_only"],
  ] as const)("%s is %s", (_name, caps, expected) => {
    expect(capabilityLevel(caps)).toBe(expected);
  });

  it("has words for every level, and a note for those with limits", () => {
    for (const level of Object.keys(
      capabilityLabels,
    ) as (keyof typeof capabilityLabels)[]) {
      expect(capabilityLabels[level]().length).toBeGreaterThan(0);
    }
    expect(capabilityNotes.full).toBeNull();
    expect(capabilityNotes.unknown).toBeNull();
    expect(capabilityNotes.create_only?.()).toBe(
      m.caltargets_caps_create_only_note(),
    );
    expect(capabilityNotes.create_only?.()).toContain("nur anlegen");
  });
});

describe("kind labels", () => {
  it("name every kind a target can carry, with a hint", () => {
    for (const kind of CALENDAR_ITEM_KINDS) {
      expect(calendarKindLabels[kind]().length).toBeGreaterThan(0);
      expect(calendarKindHints[kind]().length).toBeGreaterThan(0);
    }
  });

  it("uses the wording people expect", () => {
    expect(calendarKindLabels.appointments()).toBe("Termine");
    expect(calendarKindLabels.task_due()).toBe("Fälligkeiten von Aufgaben");
    expect(calendarKindLabels.preparations()).toBe("Vorbereitungen");
    expect(calendarKindLabels.defect_deadlines()).toBe("Mängelfristen");
    expect(calendarKindLabels.insurance_deadlines()).toBe(
      "Kündigungsfristen von Versicherungen",
    );
    expect(calendarKindLabels.warranty_ends()).toBe("Garantieende");
  });
});
