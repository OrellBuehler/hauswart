import { afterEach, beforeEach } from "vitest";
import { CALENDAR_PROVIDERS, type CalendarItemKind } from "$lib/api/enums";
import { calendarTargetConfigSchema } from "$lib/api/schemas/calendar-sync";
import { saveConnection } from "$lib/server/connections/connections";
import { IntegrationError } from "$lib/server/connections/errors";
import type { ServiceContext } from "$lib/server/service";
import {
  registerCalendarProvider,
  type CalendarCapabilities,
  type CalendarItem,
  type CalendarProvider,
  type CalendarSession,
  type RemoteCalendar,
  type RemoteEvent,
} from "./provider";
import { markerLine, parseMarker } from "./ref";
import { createTarget, type Caller, type TargetView } from "./targets";

export const PROVIDER = CALENDAR_PROVIDERS[0];
export const CALENDAR_ID = "calendar.example_household";
/** An administrator, who may manage the household's targets. */
export const ADMIN: Caller = { id: "admin-user", admin: true, locale: "de" };

/** The household's connection to the calendar system (switched on or off), the way the settings API stores it. */
export function connectCalendarSystem(ctx: ServiceContext, enabled = true) {
  return saveConnection(ctx, PROVIDER, null, {
    baseUrl: "https://calendars.example.org",
    token: "test-token",
    allowInsecureTls: false,
    enabled,
  });
}

/** A target of the household for a calendar of the fake system (added if needed). */
export function addTarget(
  ctx: ServiceContext,
  fake: FakeCalendars,
  over: {
    calendarId?: string;
    kinds?: CalendarItemKind[];
    config?: Record<string, unknown>;
    enabled?: boolean;
    capabilities?: CalendarCapabilities;
  } = {},
): Promise<TargetView> {
  const calendarId = over.calendarId ?? CALENDAR_ID;
  if (!fake.calendars.has(calendarId)) {
    fake.add(calendarId, { capabilities: over.capabilities });
  }
  return createTarget(ctx, ADMIN, {
    provider: PROVIDER,
    remoteCalendarId: calendarId,
    enabled: over.enabled ?? true,
    config: calendarTargetConfigSchema.parse({
      kinds: over.kinds ?? ["appointments", "task_due"],
      ...over.config,
    }),
  });
}

/** What a calendar can do in these tests. */
export const FULL_CAPABILITIES: CalendarCapabilities = {
  create: true,
  update: true,
  delete: true,
  alarms: false,
};

export interface StoredEvent {
  uid: string;
  /** What is in the calendar's description field: the item's text and our marker line. */
  description: string;
  item: CalendarItem | null;
  foreign: boolean;
}

interface FakeCalendar {
  id: string;
  name: string;
  capabilities: CalendarCapabilities;
  events: StoredEvent[];
}

type Step = "open" | "list" | "create" | "update" | "delete";

export interface Call {
  step: Step;
  ref?: string;
  uid?: string;
}

/**
 * A calendar system in memory, registered as the provider of the one calendar kind: calendars with
 * capabilities, events that carry our marker in their description, ids the calendar assigns, and
 * failures that can be injected per step. `reportsIds: false` behaves like a calendar that does not
 * tell the id of a new event (it is found again by its marker).
 */
export class FakeCalendars {
  readonly provider: CalendarProvider;
  calendars = new Map<string, FakeCalendar>();
  calls: Call[] = [];
  reportsIds = true;
  /** New events lose the marker, like a calendar that does not keep the description. */
  dropsMarker = false;
  /** Events are listed without their ids, like a calendar that has none. */
  hidesIds = false;
  /** Every call takes this long. */
  delayMs = 0;
  /** How many calls were going on at once, at most. */
  maxActive = 0;
  private active = 0;
  private injected: { step: Step; code: string; remaining: number }[] = [];
  private next = 1;

  constructor() {
    this.provider = {
      kind: CALENDAR_PROVIDERS[0],
      listCalendars: async () => {
        this.calls.push({ step: "open" });
        return [...this.calendars.values()].map((c): RemoteCalendar => ({
          id: c.id,
          name: c.name,
          capabilities: c.capabilities,
        }));
      },
      open: async (_connection, calendarId) => this.open(calendarId),
    };
  }

  /** Takes the provider away, like an adapter that does not run. */
  detach: () => void = () => {};

  reset(): void {
    this.calendars.clear();
    this.calls = [];
    this.reportsIds = true;
    this.dropsMarker = false;
    this.hidesIds = false;
    this.delayMs = 0;
    this.maxActive = 0;
    this.injected = [];
    this.next = 1;
  }

  add(
    id: string,
    over: Partial<Pick<FakeCalendar, "name" | "capabilities">> = {},
  ): FakeCalendar {
    const calendar: FakeCalendar = {
      id,
      name: over.name ?? `Name of ${id}`,
      capabilities: over.capabilities ?? FULL_CAPABILITIES,
      events: [],
    };
    this.calendars.set(id, calendar);
    return calendar;
  }

  /** An event somebody else wrote, without our marker. */
  addForeign(id: string, summary: string, uid = `foreign-${this.next++}`) {
    const event: StoredEvent = {
      uid,
      description: summary,
      item: null,
      foreign: true,
    };
    this.get(id).events.push(event);
    return event;
  }

  get(id: string): FakeCalendar {
    const calendar = this.calendars.get(id);
    if (!calendar) throw new Error(`no fake calendar ${id}`);
    return calendar;
  }

  /** Our events in a calendar, by ref. */
  ours(id: string): Map<string, StoredEvent> {
    return new Map(
      this.get(id)
        .events.filter((e) => parseMarker(e.description) !== null)
        .map((e) => [parseMarker(e.description) as string, e]),
    );
  }

  /** The next `times` calls of this step fail with this code. */
  failNext(step: Step, code: string, times = 1): void {
    this.injected.push({ step, code, remaining: times });
  }

  callsOf(step: Step): Call[] {
    return this.calls.filter((c) => c.step === step);
  }

  /** Resolves once no call is going on (a run that was stopped may still be finishing its last one). */
  async idle(): Promise<void> {
    for (let i = 0; i < 200 && this.active > 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  private async busy(): Promise<void> {
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      if (this.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      }
    } finally {
      this.active--;
    }
  }

  private maybeFail(step: Step): void {
    const hit = this.injected.find((i) => i.step === step && i.remaining > 0);
    if (!hit) return;
    hit.remaining--;
    throw new IntegrationError(hit.code, `injected ${hit.code}`);
  }

  private open(calendarId: string): CalendarSession {
    this.calls.push({ step: "open" });
    this.maybeFail("open");
    const calendar = this.calendars.get(calendarId);
    if (!calendar) {
      throw new IntegrationError("not_found", "The calendar was not found.");
    }
    const unsupported = (what: string) =>
      new IntegrationError("bad_request", `The calendar cannot ${what}.`);
    return {
      name: calendar.name,
      capabilities: calendar.capabilities,
      listEvents: async () => {
        this.calls.push({ step: "list" });
        await this.busy();
        this.maybeFail("list");
        return calendar.events.map((e): RemoteEvent => ({
          uid: this.hidesIds ? null : e.uid,
          ref: parseMarker(e.description),
        }));
      },
      create: async (item) => {
        this.calls.push({ step: "create", ref: item.ref });
        await this.busy();
        this.maybeFail("create");
        if (!calendar.capabilities.create) throw unsupported("create events");
        const uid = `uid-${this.next++}`;
        calendar.events.push({
          uid,
          description: this.dropsMarker
            ? item.description
            : `${item.description}\n\n${markerLine(item.ref)}`,
          item,
          foreign: false,
        });
        return { uid: this.reportsIds ? uid : null };
      },
      update: async (uid, item) => {
        this.calls.push({ step: "update", ref: item.ref, uid });
        await this.busy();
        this.maybeFail("update");
        if (!calendar.capabilities.update) throw unsupported("change events");
        const event = calendar.events.find((e) => e.uid === uid);
        if (!event) throw new IntegrationError("bad_request", "Unknown event.");
        event.item = item;
        event.description = `${item.description}\n\n${markerLine(item.ref)}`;
      },
      delete: async (uid) => {
        this.calls.push({ step: "delete", uid });
        await this.busy();
        this.maybeFail("delete");
        if (!calendar.capabilities.delete) throw unsupported("delete events");
        const index = calendar.events.findIndex((e) => e.uid === uid);
        if (index < 0)
          throw new IntegrationError("not_found", "Unknown event.");
        calendar.events.splice(index, 1);
      },
    };
  }
}

/**
 * One fake calendar system per test file, registered as the calendar provider and emptied before
 * every test; call `register()` inside a test after `useTestDB()` has opened the database.
 */
export function useFakeCalendars(): FakeCalendars {
  const fake = new FakeCalendars();
  let off: (() => void) | null = null;
  beforeEach(() => {
    fake.reset();
    off = registerCalendarProvider(fake.provider);
    fake.detach = () => off?.();
  });
  afterEach(() => {
    off?.();
    off = null;
  });
  return fake;
}
