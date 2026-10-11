import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { zonedTimeToInstant } from "$lib/dates";
import { IntegrationError } from "$lib/server/connections/errors";
import type { ResolvedConnection } from "$lib/server/connections/registry";
import type {
  CalendarItem,
  CalendarProvider,
} from "$lib/server/calendar-sync/provider";
import { createCalendarProvider } from "./calendar-provider";
import {
  CREATE_DELETE_CALENDAR,
  CREATE_ONLY_CALENDAR,
  FULL_CALENDAR,
  startFakeHomeAssistant,
} from "./fake-server";

const fake = startFakeHomeAssistant();
afterAll(() => fake.stop());
beforeEach(async () => {
  await fake.waitIdle();
  fake.reset();
});

const CAL = "calendar.example_household";
const ZURICH = "Europe/Zurich";
const at = (date: string, time: string) =>
  zonedTimeToInstant(date, time, ZURICH);
const WIDE = { from: at("2026-01-01", "00:00"), to: at("2028-01-01", "00:00") };

const connection = (
  over: Partial<ResolvedConnection> = {},
): ResolvedConnection => ({
  id: "connection-1",
  kind: "homeassistant",
  userId: null,
  baseUrl: fake.baseUrl,
  token: fake.token,
  allowInsecureTls: false,
  allowLoopback: true,
  config: {},
  ...over,
});

const sleeps: number[] = [];
const provider = (
  over: Parameters<typeof createCalendarProvider>[0] = {},
): CalendarProvider =>
  createCalendarProvider({
    retry: {
      baseDelayMs: 10,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    },
    ...over,
  });
beforeEach(() => {
  sleeps.length = 0;
});

function item(over: Partial<CalendarItem> = {}): CalendarItem {
  return {
    ref: "appointment-example-1",
    summary: "Kaminfeger",
    description: "Gerät: Heizung",
    location: null,
    when: {
      allDay: false,
      startsAt: at("2026-06-20", "09:00"),
      endsAt: at("2026-06-20", "10:30"),
    },
    path: "/appointments/example-1",
    alarmMinutes: null,
    ...over,
  };
}

async function failure(promise: Promise<unknown>): Promise<IntegrationError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof IntegrationError) return err;
    throw err;
  }
  throw new Error("expected a failure");
}
const codeOf = async (promise: Promise<unknown>) =>
  (await failure(promise)).code;

const open = (calendar = CAL, p = provider()) => p.open(connection(), calendar);

describe("the calendars of Home Assistant", () => {
  it("lists them with what each allows, from the bits of supported_features", async () => {
    fake.addCalendar("calendar.example_full", [], "Local", FULL_CALENDAR);
    fake.addCalendar(
      "calendar.example_google",
      [],
      "Google",
      CREATE_DELETE_CALENDAR,
    );
    fake.addCalendar("calendar.example_dav", [], "DAV", CREATE_ONLY_CALENDAR);
    fake.addCalendar("calendar.example_waste", [], "Waste");
    const list = await provider().listCalendars(connection());
    expect(
      Object.fromEntries(list.map((c) => [c.id, [c.name, c.capabilities]])),
    ).toEqual({
      "calendar.example_full": [
        "Local",
        { create: true, update: true, delete: true, alarms: false },
      ],
      "calendar.example_google": [
        "Google",
        { create: true, update: false, delete: true, alarms: false },
      ],
      "calendar.example_dav": [
        "DAV",
        { create: true, update: false, delete: false, alarms: false },
      ],
      "calendar.example_waste": [
        "Waste",
        { create: false, update: false, delete: false, alarms: false },
      ],
    });
  });

  it("says a calendar without a state can do nothing, instead of failing the list", async () => {
    fake.addCalendar("calendar.example_full", [], "Local", FULL_CALENDAR);
    fake.addCalendar("calendar.example_hidden", [], "Hidden", FULL_CALENDAR);
    fake.failNext("/api/states/calendar.example_hidden", 404);
    const list = await provider().listCalendars(connection());
    expect(
      list.find((c) => c.id === "calendar.example_hidden")!.capabilities,
    ).toEqual({
      create: false,
      update: false,
      delete: false,
      alarms: false,
    });
    expect(
      list.find((c) => c.id === "calendar.example_full")!.capabilities.create,
    ).toBe(true);
  });

  it("fails as a whole when Home Assistant refuses", async () => {
    fake.addCalendar(CAL, [], "Local", FULL_CALENDAR);
    expect(
      await codeOf(
        provider().listCalendars(connection({ token: "wrong-token" })),
      ),
    ).toBe("unauthorized");
    fake.failNext(`/api/states/${CAL}`, 403);
    expect(await codeOf(provider().listCalendars(connection()))).toBe(
      "forbidden",
    );
  });
});

describe("opening a calendar", () => {
  it("knows its name and what it allows", async () => {
    fake.addCalendar(CAL, [], "Haushalt", FULL_CALENDAR);
    const session = await open();
    expect(session.name).toBe("Haushalt");
    expect(session.capabilities).toEqual({
      create: true,
      update: true,
      delete: true,
      alarms: false,
    });
  });

  it("reads the state and the zone of the system once", async () => {
    fake.addCalendar(CAL, [], "Haushalt", FULL_CALENDAR);
    await open();
    expect(fake.requestsTo("/api/config")).toHaveLength(1);
    expect(fake.requestsTo(`/api/states/${CAL}`)).toHaveLength(1);
  });

  it("is not found for anything but a calendar entity, without asking Home Assistant", async () => {
    fake.setState("light.example_lamp", "on");
    for (const id of [
      "light.example_lamp",
      "calendar",
      "Calendar.Example",
      "calendar.",
      "../calendar.x",
    ]) {
      expect(await codeOf(open(id)), id).toBe("not_found");
    }
    expect(fake.requests).toEqual([]);
  });

  it("is not found for a calendar Home Assistant does not know", async () => {
    expect(await codeOf(open("calendar.example_missing"))).toBe("not_found");
  });

  it("names the problem when Home Assistant answers badly", async () => {
    fake.addCalendar(CAL, [], "Haushalt", FULL_CALENDAR);
    fake.timeZone = "Mars/Olympus_Mons";
    expect(await codeOf(open())).toBe("invalid_response");
    fake.timeZone = ZURICH;
    expect(
      await codeOf(provider().open(connection({ token: "wrong-token" }), CAL)),
    ).toBe("unauthorized");
    fake.failNext("/api/config", 200);
    expect(await codeOf(open())).toBe("invalid_response");
  });

  it("does not put the token into what it throws", async () => {
    fake.addCalendar(CAL, [], "Haushalt", FULL_CALENDAR);
    const err = await failure(
      provider().open(connection({ token: "wrong-token-1234" }), CAL),
    );
    expect(err.message).not.toContain("wrong-token-1234");
    expect(String(err.cause ?? "")).not.toContain("wrong-token-1234");
  });
});

describe("events", () => {
  it("lists them with the id and our marker, and foreign events without", async () => {
    fake.addCalendar(
      CAL,
      [
        {
          summary: "Zahnarzt",
          start: { date: "2026-06-20" },
          end: { date: "2026-06-21" },
          description:
            "mention of hw-ref: appointment-x@sync.hauswart inside a line",
          uid: "foreign-1",
        },
        {
          summary: "Ohne Id",
          start: { date: "2026-06-21" },
          end: { date: "2026-06-22" },
        },
      ],
      "Haushalt",
      FULL_CALENDAR,
    );
    const session = await open();
    await session.create(item());
    const events = await session.listEvents(WIDE);
    expect(events).toHaveLength(3);
    expect(events.filter((e) => e.ref === null)).toEqual([
      { uid: "foreign-1", ref: null },
      { uid: null, ref: null },
    ]);
    expect(events.filter((e) => e.ref !== null)).toEqual([
      { uid: expect.stringMatching(/^uid-/), ref: "appointment-example-1" },
    ]);
  });

  it("asks only for the span it is given", async () => {
    fake.addCalendar(CAL, [], "Haushalt", FULL_CALENDAR);
    const session = await open();
    await session.listEvents({
      from: Date.UTC(2026, 0, 1),
      to: Date.UTC(2026, 11, 31),
    });
    const request = fake.requestsTo(`/api/calendars/${CAL}`)[0]!;
    expect(request.query.get("start")).toBe("2026-01-01T00:00:00.000Z");
    expect(request.query.get("end")).toBe("2026-12-31T00:00:00.000Z");
  });

  it("only lists events that overlap the span", async () => {
    fake.addCalendar(CAL, [], "Haushalt", FULL_CALENDAR);
    const session = await open();
    await session.create(item({ ref: "appointment-a" }));
    await session.create(
      item({
        ref: "appointment-b",
        when: {
          allDay: false,
          startsAt: at("2027-03-01", "09:00"),
          endsAt: at("2027-03-01", "10:00"),
        },
      }),
    );
    const events = await session.listEvents({
      from: at("2026-06-01", "00:00"),
      to: at("2026-07-01", "00:00"),
    });
    expect(events.map((e) => e.ref)).toEqual(["appointment-a"]);
  });
});

describe("creating an event", () => {
  it("writes a timed item as wall-clock time in the zone of Home Assistant, which is not the household's", async () => {
    fake.timeZone = "America/New_York";
    fake.addCalendar(CAL, [], "Haushalt", FULL_CALENDAR);
    const session = await open();
    expect(await session.create(item({ location: "Keller" }))).toEqual({
      uid: null,
    });
    expect(fake.serviceCalls.at(-1)).toEqual({
      domain: "calendar",
      service: "create_event",
      data: {
        entity_id: CAL,
        summary: "Kaminfeger",
        description:
          "Gerät: Heizung\n\nhw-ref: appointment-example-1@sync.hauswart",
        location: "Keller",
        start_date_time: "2026-06-20T03:00:00",
        end_date_time: "2026-06-20T04:30:00",
      },
    });
    // Home Assistant took it as New York time: the same instants as the item.
    const [stored] = fake.calendarEvents(CAL);
    expect(stored!.start).toEqual({ dateTime: "2026-06-20T03:00:00-04:00" });
    expect(Date.parse((stored!.start as { dateTime: string }).dateTime)).toBe(
      at("2026-06-20", "09:00"),
    );
    expect(Date.parse((stored!.end as { dateTime: string }).dateTime)).toBe(
      at("2026-06-20", "10:30"),
    );
  });

  it("writes an all-day item as dates, the end being the day after the last day", async () => {
    fake.addCalendar(CAL, [], "Haushalt", FULL_CALENDAR);
    const session = await open();
    await session.create(
      item({
        ref: "task-example-1-2026-06-20",
        when: { allDay: true, startDate: "2026-06-20", endDate: "2026-06-21" },
      }),
    );
    await session.create(
      item({
        ref: "appointment-example-2",
        when: { allDay: true, startDate: "2026-06-22", endDate: "2026-06-25" },
      }),
    );
    const data = fake.serviceCalls.map((c) => c.data as Record<string, string>);
    expect(data.map((d) => [d.start_date, d.end_date])).toEqual([
      ["2026-06-20", "2026-06-21"],
      ["2026-06-22", "2026-06-25"],
    ]);
    expect(data.some((d) => "start_date_time" in d)).toBe(false);
    expect(fake.calendarEvents(CAL).map((e) => [e.start, e.end])).toEqual([
      [{ date: "2026-06-20" }, { date: "2026-06-21" }],
      [{ date: "2026-06-22" }, { date: "2026-06-25" }],
    ]);
  });

  it("writes only what Home Assistant's service takes: no reminder, no unknown field", async () => {
    fake.addCalendar(CAL, [], "Haushalt", FULL_CALENDAR);
    const session = await open();
    await session.create(item({ alarmMinutes: 15 }));
    const keys = Object.keys(fake.serviceCalls[0]!.data as object).sort();
    expect(keys).toEqual(
      [
        "description",
        "end_date_time",
        "entity_id",
        "start_date_time",
        "summary",
      ].sort(),
    );
  });

  it("adds a link into the app when the address is known", async () => {
    fake.addCalendar(CAL, [], "Haushalt", FULL_CALENDAR);
    const session = await provider().open(
      connection({ config: { appUrl: "https://hauswart.example.org" } }),
      CAL,
    );
    await session.create(item());
    expect(
      (fake.serviceCalls[0]!.data as { description: string }).description,
    ).toBe(
      "Gerät: Heizung\nhttps://hauswart.example.org/appointments/example-1\n\nhw-ref: appointment-example-1@sync.hauswart",
    );
  });

  it("is refused by a calendar that cannot create events", async () => {
    fake.addCalendar(CAL, [], "Waste");
    const session = await open();
    expect(await codeOf(session.create(item()))).toBe("bad_request");
    expect(fake.calendarEvents(CAL)).toEqual([]);
  });

  it("is not repeated after a failure, because the event may have been written", async () => {
    fake.addCalendar(CAL, [], "Haushalt", FULL_CALENDAR);
    const session = await open();
    fake.failNext("/api/services/calendar/create_event", 500, 1);
    expect(await codeOf(session.create(item()))).toBe("server");
    expect(fake.requestsTo("/api/services/calendar/create_event")).toHaveLength(
      1,
    );
    expect(sleeps).toEqual([]);
  });
});

describe("changing and deleting events", () => {
  async function written(features = FULL_CALENDAR) {
    fake.addCalendar(CAL, [], "Haushalt", features);
    const session = await open();
    await session.create(item({ location: "Keller" }));
    const [{ uid }] = await session.listEvents(WIDE);
    return { session, uid: uid! };
  }

  it("replaces an event with the WebSocket command, in the zone of Home Assistant", async () => {
    fake.timeZone = "America/New_York";
    const { session, uid } = await written();
    await session.update(
      uid,
      item({
        summary: "Kaminfeger kommt",
        location: null,
        when: {
          allDay: false,
          startsAt: at("2026-06-21", "08:00"),
          endsAt: at("2026-06-21", "09:00"),
        },
      }),
    );
    expect(fake.wsMessages.at(-1)).toEqual({
      id: 1,
      type: "calendar/event/update",
      entity_id: CAL,
      uid,
      event: {
        dtstart: "2026-06-21T02:00:00",
        dtend: "2026-06-21T03:00:00",
        summary: "Kaminfeger kommt",
        description:
          "Gerät: Heizung\n\nhw-ref: appointment-example-1@sync.hauswart",
        location: "",
      },
    });
    const [stored] = fake.calendarEvents(CAL);
    expect(stored).toMatchObject({ uid, summary: "Kaminfeger kommt" });
    expect(stored!.location).toBeUndefined();
    expect(Date.parse((stored!.start as { dateTime: string }).dateTime)).toBe(
      at("2026-06-21", "08:00"),
    );
    expect(fake.calendarEvents(CAL)).toHaveLength(1);
  });

  it("can turn a timed event into an all-day one", async () => {
    const { session, uid } = await written();
    await session.update(
      uid,
      item({
        when: { allDay: true, startDate: "2026-06-22", endDate: "2026-06-23" },
      }),
    );
    expect(fake.calendarEvents(CAL)[0]).toMatchObject({
      start: { date: "2026-06-22" },
      end: { date: "2026-06-23" },
    });
  });

  it("removes an event with the WebSocket command", async () => {
    const { session, uid } = await written();
    await session.delete(uid);
    expect(fake.wsMessages.at(-1)).toEqual({
      id: 1,
      type: "calendar/event/delete",
      entity_id: CAL,
      uid,
    });
    expect(fake.calendarEvents(CAL)).toEqual([]);
  });

  it("is refused where the calendar lacks the ability, and the event stays", async () => {
    const { session, uid } = await written(CREATE_ONLY_CALENDAR);
    expect(await codeOf(session.update(uid, item({ summary: "x" })))).toBe(
      "bad_request",
    );
    expect(await codeOf(session.delete(uid))).toBe("bad_request");
    expect(fake.calendarEvents(CAL)).toHaveLength(1);
  });

  it("a calendar that deletes but cannot change refuses a change and takes a delete", async () => {
    const { session, uid } = await written(CREATE_DELETE_CALENDAR);
    expect(await codeOf(session.update(uid, item({ summary: "x" })))).toBe(
      "bad_request",
    );
    await session.delete(uid);
    expect(fake.calendarEvents(CAL)).toEqual([]);
  });

  it("names an event that does not exist", async () => {
    const { session } = await written();
    expect(await codeOf(session.update("missing", item()))).toBe("bad_request");
    expect(await codeOf(session.delete("missing"))).toBe("bad_request");
  });

  it("is not found when the calendar disappeared meanwhile", async () => {
    const { session, uid } = await written();
    fake.calendars.delete(CAL);
    expect(await codeOf(session.delete(uid))).toBe("not_found");
  });

  it("refuses an id that cannot be one, without calling Home Assistant", async () => {
    const { session } = await written();
    const before = fake.wsConnections;
    for (const uid of ["", "a\nb", "x".repeat(300)]) {
      expect(await codeOf(session.delete(uid)), JSON.stringify(uid)).toBe(
        "invalid_input",
      );
    }
    expect(fake.wsConnections).toBe(before);
  });
});

describe("when Home Assistant is slow, broken or answers nonsense", () => {
  it("gives up on a call after the timeout and says so", async () => {
    fake.addCalendar(CAL, [], "Haushalt", FULL_CALENDAR);
    fake.delayMs = 300;
    expect(
      await codeOf(provider({ timeoutMs: 40 }).open(connection(), CAL)),
    ).toBe("timeout");
  });

  it("repeats reads that failed in a harmless way, at most twice, with growing pauses", async () => {
    fake.addCalendar(CAL, [], "Haushalt", FULL_CALENDAR);
    const session = await open();
    fake.failNext(`/api/calendars/${CAL}`, 500, 2);
    expect(await session.listEvents(WIDE)).toEqual([]);
    expect(fake.requestsTo(`/api/calendars/${CAL}`)).toHaveLength(3);
    expect(sleeps).toEqual([10, 20]);

    fake.requests = [];
    sleeps.length = 0;
    fake.failNext(`/api/calendars/${CAL}`, 500, 5);
    expect(await codeOf(session.listEvents(WIDE))).toBe("server");
    expect(fake.requestsTo(`/api/calendars/${CAL}`)).toHaveLength(3);
  });

  it("does not repeat a read that was refused for good", async () => {
    fake.addCalendar(CAL, [], "Haushalt", FULL_CALENDAR);
    const session = await open();
    fake.failNext(`/api/calendars/${CAL}`, 401, 5);
    expect(await codeOf(session.listEvents(WIDE))).toBe("unauthorized");
    expect(fake.requestsTo(`/api/calendars/${CAL}`)).toHaveLength(1);
  });

  it("repeats a change that sets the same state again, but not a delete", async () => {
    fake.addCalendar(CAL, [], "Haushalt", FULL_CALENDAR);
    const session = await open();
    await session.create(item());
    const [{ uid }] = await session.listEvents(WIDE);
    fake.wsMode = "drop";
    expect(await codeOf(session.update(uid!, item({ summary: "x" })))).toBe(
      "network",
    );
    expect(
      fake.wsMessages.filter(
        (m) => (m as { type: string }).type === "calendar/event/update",
      ),
    ).toHaveLength(3);
    fake.wsMessages = [];
    expect(await codeOf(session.delete(uid!))).toBe("network");
    expect(
      fake.wsMessages.filter(
        (m) => (m as { type: string }).type === "calendar/event/delete",
      ),
    ).toHaveLength(1);
  });

  it("gives up on a command that never gets an answer", async () => {
    fake.addCalendar(CAL, [], "Haushalt", FULL_CALENDAR);
    const session = await provider({ timeoutMs: 40 }).open(connection(), CAL);
    fake.wsMode = "no-reply";
    expect(await codeOf(session.delete("uid-1"))).toBe("timeout");
  });

  it("rejects an event list that is not what Home Assistant documents", async () => {
    fake.addCalendar(
      CAL,
      [
        {
          summary: "x",
          start: { dateTime: "garbage" },
          end: { dateTime: "garbage" },
        },
      ],
      "Haushalt",
      FULL_CALENDAR,
    );
    const session = await open();
    expect(await codeOf(session.listEvents(WIDE))).toBe("invalid_response");
    fake.calendarEvents(CAL).length = 0;
    fake.failNext(`/api/calendars/${CAL}`, 200, 5);
    expect(await codeOf(session.listEvents(WIDE))).toBe("invalid_response");
  });

  it("rejects a state that is not one, a refused command and a redirect", async () => {
    fake.addCalendar(CAL, [], "Haushalt", FULL_CALENDAR);
    fake.failNext(`/api/states/${CAL}`, 200, 5);
    expect(await codeOf(open())).toBe("invalid_response");
    fake.reset();
    fake.addCalendar(CAL, [], "Haushalt", FULL_CALENDAR);
    const session = await open();
    fake.failWsCommand("calendar/event/delete", "unauthorized");
    expect(await codeOf(session.delete("uid-1"))).toBe("forbidden");
    fake.redirectAll = true;
    expect(await codeOf(open())).toBe("redirect");
  });

  it("refuses a blocked address before any request", async () => {
    expect(
      await codeOf(
        provider().open(
          connection({
            baseUrl: "http://169.254.169.254",
            allowLoopback: true,
          }),
          CAL,
        ),
      ),
    ).toBe("blocked_host");
  });
});
