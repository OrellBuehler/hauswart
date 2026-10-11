import { describe, expect, it } from "vitest";
import {
  CREATE_ONLY_CAPABILITIES,
  FULL_CAPABILITIES,
  configDto,
  targetDto,
} from "$lib/testing/calendar-targets";
import {
  DEFAULT_KINDS,
  alarmsSupported,
  createBody,
  defaultDraft,
  draftFromTarget,
  orderedKinds,
  updateBody,
  validateDraft,
  type TargetDraft,
} from "./form";

const WITH_ALARMS = { ...FULL_CAPABILITIES, alarms: true };
const household = {
  level: "household" as const,
  capabilities: FULL_CAPABILITIES,
};

function draft(over: Partial<TargetDraft> = {}): TargetDraft {
  return { ...defaultDraft("de"), ...over };
}

describe("defaultDraft", () => {
  it("starts with the deadlines and visits, all-day, in the given language", () => {
    const d = defaultDraft("en");
    expect(d.kinds).toEqual([
      "appointments",
      "task_due",
      "defect_deadlines",
      "insurance_deadlines",
    ]);
    expect(d.kinds).toEqual(orderedKinds(DEFAULT_KINDS));
    expect(d.timedMode).toBe("all_day");
    expect(d.alarmOn).toBe(false);
    expect(d.onRemoteDelete).toBe("recreate");
    expect(d.locale).toBe("en");
    expect(d.name).toBe("");
  });
});

describe("orderedKinds", () => {
  it("puts the kinds in the order the server lists them", () => {
    expect(orderedKinds(["warranty_ends", "appointments", "task_due"])).toEqual(
      ["appointments", "task_due", "warranty_ends"],
    );
  });
});

describe("draftFromTarget", () => {
  it("reads the name and every setting the form shows", () => {
    const target = targetDto({
      name: "Familienkalender",
      config: configDto({
        kinds: ["preparations", "appointments"],
        timedMode: "timed",
        dueTime: "07:30",
        dueDurationMinutes: 45,
        alarmMinutes: 120,
        titlePrefix: "hauswart: ",
        onRemoteDelete: "forget",
        locale: "en",
      }),
    });
    expect(draftFromTarget(target)).toEqual({
      name: "Familienkalender",
      kinds: ["appointments", "preparations"],
      scope: "all",
      timedMode: "timed",
      dueTime: "07:30",
      dueDurationMinutes: 45,
      alarmOn: true,
      alarmMinutes: 120,
      titlePrefix: "hauswart: ",
      onRemoteDelete: "forget",
      locale: "en",
    });
  });

  it("offers a sensible reminder time when there is none", () => {
    const d = draftFromTarget(targetDto());
    expect(d.alarmOn).toBe(false);
    expect(d.alarmMinutes).toBe(60);
  });
});

describe("alarmsSupported", () => {
  it("is true only when the calendar says it keeps reminders", () => {
    expect(alarmsSupported(WITH_ALARMS)).toBe(true);
    expect(alarmsSupported(FULL_CAPABILITIES)).toBe(false);
    expect(alarmsSupported(null)).toBe(false);
    expect(alarmsSupported(undefined)).toBe(false);
  });
});

describe("validateDraft", () => {
  const create = {
    creating: true,
    remoteCalendarId: "calendar.example_household",
    ...household,
  };

  it("accepts the defaults of a new calendar", () => {
    expect(validateDraft(draft(), create)).toEqual({});
  });

  it("asks for a calendar when adding", () => {
    expect(
      Object.keys(validateDraft(draft(), { ...create, remoteCalendarId: "" })),
    ).toEqual(["remoteCalendarId"]);
  });

  it("does not ask for a calendar when editing, but for a name", () => {
    const errors = validateDraft(draft({ name: "  " }), {
      ...create,
      creating: false,
      remoteCalendarId: "",
    });
    expect(Object.keys(errors)).toEqual(["name"]);
  });

  it("lets a new calendar keep a blank name", () => {
    expect(validateDraft(draft({ name: "" }), create)).toEqual({});
  });

  it("wants at least one kind", () => {
    expect(Object.keys(validateDraft(draft({ kinds: [] }), create))).toEqual([
      "kinds",
    ]);
  });

  it("checks time and length only for events with a time", () => {
    const wrong = { dueTime: "25:99", dueDurationMinutes: 1 };
    expect(validateDraft(draft(wrong), create)).toEqual({});
    expect(
      Object.keys(
        validateDraft(draft({ ...wrong, timedMode: "timed" }), create),
      ),
    ).toEqual(["dueTime", "dueDurationMinutes"]);
  });

  it.each([
    [4, false],
    [5, true],
    [480, true],
    [481, false],
    [30.5, false],
    [undefined, false],
  ])("takes %s minutes as a length: %s", (minutes, ok) => {
    const errors = validateDraft(
      draft({ timedMode: "timed", dueDurationMinutes: minutes }),
      create,
    );
    expect("dueDurationMinutes" in errors).toBe(!ok);
  });

  it("checks the reminder only when the calendar can keep one", () => {
    const bad = draft({ alarmOn: true, alarmMinutes: -1 });
    expect(validateDraft(bad, create)).toEqual({});
    expect(
      Object.keys(validateDraft(bad, { ...create, capabilities: WITH_ALARMS })),
    ).toEqual(["alarmMinutes"]);
    expect(
      validateDraft(draft({ alarmOn: true, alarmMinutes: 40_321 }), {
        ...create,
        capabilities: WITH_ALARMS,
      }),
    ).toHaveProperty("alarmMinutes");
    expect(
      validateDraft(draft({ alarmOn: true, alarmMinutes: 0 }), {
        ...create,
        capabilities: WITH_ALARMS,
      }),
    ).toEqual({});
  });
});

describe("createBody", () => {
  it("sends the calendar and the settings, never direction or conflict policy", () => {
    const body = createBody(
      "homeassistant",
      "calendar.example_household",
      draft({ name: "  Haushalt ", titlePrefix: "hauswart: " }),
      household,
    );
    expect(body).toEqual({
      provider: "homeassistant",
      remoteCalendarId: "calendar.example_household",
      name: "Haushalt",
      config: {
        kinds: [
          "appointments",
          "task_due",
          "defect_deadlines",
          "insurance_deadlines",
        ],
        scope: "all",
        timedMode: "all_day",
        dueTime: "08:00",
        dueDurationMinutes: 30,
        alarmMinutes: null,
        titlePrefix: "hauswart: ",
        onRemoteDelete: "recreate",
        locale: "de",
      },
    });
    expect(body.config).not.toHaveProperty("direction");
    expect(body.config).not.toHaveProperty("conflictPolicy");
  });

  it("leaves a blank name out so the server takes the calendar's own", () => {
    const body = createBody("homeassistant", "calendar.x", draft(), household);
    expect(body).not.toHaveProperty("name");
  });

  it("keeps the household's calendar on everything, whatever the scope says", () => {
    const body = createBody(
      "homeassistant",
      "calendar.x",
      draft({ scope: "mine" }),
      household,
    );
    expect(body.config.scope).toBe("all");
    const personal = createBody(
      "homeassistant",
      "calendar.x",
      draft({ scope: "mine" }),
      { level: "user", capabilities: FULL_CAPABILITIES },
    );
    expect(personal.config.scope).toBe("mine");
  });

  it("writes a reminder only for a calendar that keeps one", () => {
    const on = draft({ alarmOn: true, alarmMinutes: 30 });
    expect(
      createBody("homeassistant", "calendar.x", on, household).config
        .alarmMinutes,
    ).toBeNull();
    expect(
      createBody("homeassistant", "calendar.x", on, {
        level: "household",
        capabilities: WITH_ALARMS,
      }).config.alarmMinutes,
    ).toBe(30);
    expect(
      createBody("homeassistant", "calendar.x", draft({ alarmOn: false }), {
        level: "household",
        capabilities: WITH_ALARMS,
      }).config.alarmMinutes,
    ).toBeNull();
  });

  it("replaces a half-typed time left behind in an all-day calendar", () => {
    const body = createBody(
      "homeassistant",
      "calendar.x",
      draft({ dueTime: "", dueDurationMinutes: undefined }),
      household,
    );
    expect(body.config.dueTime).toBe("08:00");
    expect(body.config.dueDurationMinutes).toBe(30);
  });

  it("orders the kinds like the server does", () => {
    const body = createBody(
      "homeassistant",
      "calendar.x",
      draft({ kinds: ["warranty_ends", "appointments"] }),
      household,
    );
    expect(body.config.kinds).toEqual(["appointments", "warranty_ends"]);
  });
});

describe("updateBody", () => {
  const target = targetDto({
    name: "Haushaltskalender",
    config: configDto({ kinds: ["appointments", "task_due"], titlePrefix: "" }),
  });
  const caps = { capabilities: FULL_CAPABILITIES };

  it("is null when nothing differs", () => {
    expect(updateBody(target, draftFromTarget(target), caps)).toBeNull();
  });

  it("sends only what differs", () => {
    const d = draftFromTarget(target);
    d.titlePrefix = "hauswart: ";
    d.kinds = ["appointments", "task_due", "preparations"];
    expect(updateBody(target, d, caps)).toEqual({
      config: {
        titlePrefix: "hauswart: ",
        kinds: ["appointments", "task_due", "preparations"],
      },
    });
  });

  it("sends a new name trimmed, and not an unchanged one", () => {
    const renamed = { ...draftFromTarget(target), name: "  Familie " };
    expect(updateBody(target, renamed, caps)).toEqual({ name: "Familie" });
    const same = { ...draftFromTarget(target), name: " Haushaltskalender " };
    expect(updateBody(target, same, caps)).toBeNull();
  });

  it("treats the same kinds in another order as unchanged", () => {
    const d = {
      ...draftFromTarget(target),
      kinds: ["task_due", "appointments"] as TargetDraft["kinds"],
    };
    expect(updateBody(target, d, caps)).toBeNull();
  });

  it("changes the timing together with its time and length", () => {
    const d = {
      ...draftFromTarget(target),
      timedMode: "timed" as const,
      dueTime: "09:15",
      dueDurationMinutes: 60,
    };
    expect(updateBody(target, d, caps)).toEqual({
      config: { timedMode: "timed", dueTime: "09:15", dueDurationMinutes: 60 },
    });
  });

  it("does not send a time that was left invalid in an all-day calendar", () => {
    const d = {
      ...draftFromTarget(target),
      dueTime: "",
      dueDurationMinutes: undefined,
    };
    expect(updateBody(target, d, caps)).toBeNull();
  });

  it("never touches a reminder the calendar cannot keep", () => {
    const withAlarm = targetDto({ config: configDto({ alarmMinutes: 90 }) });
    const d = { ...draftFromTarget(withAlarm), alarmOn: false };
    expect(updateBody(withAlarm, d, caps)).toBeNull();
    expect(updateBody(withAlarm, d, { capabilities: WITH_ALARMS })).toEqual({
      config: { alarmMinutes: null },
    });
  });

  it("sends the scope of a personal calendar only", () => {
    const mine = targetDto({
      level: "user",
      ownerId: "user-1",
      config: configDto({ scope: "mine" }),
    });
    const d = { ...draftFromTarget(mine), scope: "all" as const };
    expect(updateBody(mine, d, caps)).toEqual({ config: { scope: "all" } });
    const shared = { ...draftFromTarget(target), scope: "mine" as const };
    expect(updateBody(target, shared, caps)).toBeNull();
  });

  it("works for a calendar that can only create", () => {
    const limited = targetDto({ capabilities: CREATE_ONLY_CAPABILITIES });
    const d = {
      ...draftFromTarget(limited),
      onRemoteDelete: "forget" as const,
    };
    expect(
      updateBody(limited, d, { capabilities: CREATE_ONLY_CAPABILITIES }),
    ).toEqual({ config: { onRemoteDelete: "forget" } });
  });

  it("sends the language", () => {
    const d = { ...draftFromTarget(target), locale: "en" as const };
    expect(updateBody(target, d, caps)).toEqual({ config: { locale: "en" } });
  });
});
