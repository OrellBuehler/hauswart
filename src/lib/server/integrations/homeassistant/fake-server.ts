import { localDateOf, localTimeOf, zonedTimeToInstant } from "$lib/dates";

/**
 * A small fake Home Assistant for tests (local `Bun.serve`, port 0): REST
 * states, calendars, services and notify capture, plus the WebSocket API for
 * the registries. Every body is written by hand from the Home Assistant
 * developer documentation; nothing talks to a real instance.
 */
export interface FakeState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

export interface FakeCalendarEvent {
  summary: string;
  start: { date: string } | { dateTime: string };
  end: { date: string } | { dateTime: string };
  description?: string;
  location?: string;
  uid?: string;
}

/** `supported_features` bits of a calendar entity, as Home Assistant defines them. */
export const CALENDAR_FEATURES = { create: 1, delete: 2, update: 4 } as const;
/** A calendar like the Local Calendar: creates, updates and deletes. */
export const FULL_CALENDAR = 7;
/** A calendar that only takes new events (the CalDAV integration). */
export const CREATE_ONLY_CALENDAR = CALENDAR_FEATURES.create;
/** A calendar that creates and deletes but cannot change an event (Google Calendar). */
export const CREATE_DELETE_CALENDAR =
  CALENDAR_FEATURES.create | CALENDAR_FEATURES.delete;

interface FakeCalendarStore {
  name: string;
  events: FakeCalendarEvent[];
  /** `supported_features` of the entity. */
  features: number;
}

export interface RecordedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Headers;
  json?: unknown;
}

export interface ServiceCall {
  domain: string;
  service: string;
  data: unknown;
}

export type WsMode =
  /** Normal behaviour. */
  | "normal"
  /** Never sends `auth_required`. */
  | "silent"
  /** Authenticates, then never answers the command. */
  | "no-reply"
  /** Authenticates, then closes the socket. */
  | "drop"
  /** Answers the command with `success: false`. */
  | "command-error"
  /** Answers the command with an unexpected result shape. */
  | "bad-result"
  /** Answers the command with a very large result. */
  | "huge-result";

interface Injection {
  pathPart: string;
  status: number;
  remaining: number;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

interface WsCalendarMessage {
  type: string;
  id?: number;
  entity_id?: unknown;
  uid?: unknown;
  event?: unknown;
}

interface SocketData {
  authenticated: boolean;
}

export class FakeHomeAssistant {
  token = "test-token";
  version = "2026.1.0";
  timeZone = "Europe/Zurich";
  locationName = "Example Home";
  states = new Map<string, FakeState>();
  calendars = new Map<string, FakeCalendarStore>();
  private nextEventId = 1;
  private wsFailures: { type: string; code: string; remaining: number }[] = [];
  /** domain → service names. */
  services = new Map<string, string[]>([
    [
      "notify",
      ["notify", "mobile_app_example_phone", "persistent_notification"],
    ],
    ["light", ["turn_on", "turn_off"]],
  ]);
  devices: unknown[] = [];
  areas: unknown[] = [];
  /** `null` answers like a Home Assistant older than 2024.4, which has no floor registry. */
  floors: unknown[] | null = [];
  entityRegistry: unknown[] = [];
  delayMs = 0;
  redirectAll = false;
  wsMode: WsMode = "normal";
  requests: RecordedRequest[] = [];
  serviceCalls: ServiceCall[] = [];
  /** Every WebSocket message received, parsed. */
  wsMessages: unknown[] = [];
  wsConnections = 0;
  wsClosed = 0;
  server!: ReturnType<typeof Bun.serve<SocketData>>;
  private injections: Injection[] = [];

  start(): void {
    this.server = Bun.serve<SocketData>({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req, server) => {
        const url = new URL(req.url);
        if (
          url.pathname === "/api/websocket" &&
          req.headers.get("upgrade")?.toLowerCase() === "websocket"
        ) {
          return server.upgrade(req, { data: { authenticated: false } })
            ? undefined
            : new Response("upgrade failed", { status: 400 });
        }
        return this.handle(req);
      },
      websocket: {
        open: (ws) => {
          this.wsConnections++;
          if (this.wsMode === "silent") return;
          ws.send(
            JSON.stringify({ type: "auth_required", ha_version: this.version }),
          );
        },
        message: (ws, raw) => {
          const msg = JSON.parse(String(raw)) as {
            type: string;
            id?: number;
            access_token?: string;
          };
          this.wsMessages.push(msg);
          if (!ws.data.authenticated) {
            if (msg.type === "auth" && msg.access_token === this.token) {
              ws.data.authenticated = true;
              ws.send(
                JSON.stringify({ type: "auth_ok", ha_version: this.version }),
              );
            } else {
              ws.send(
                JSON.stringify({
                  type: "auth_invalid",
                  message: "Invalid access token or password",
                }),
              );
              ws.close();
            }
            return;
          }
          this.wsCommand(ws, msg);
        },
        close: () => {
          this.wsClosed++;
        },
      },
    });
  }

  stop(): void {
    void this.server.stop(true);
  }

  reset(): void {
    this.token = "test-token";
    this.version = "2026.1.0";
    this.timeZone = "Europe/Zurich";
    this.states.clear();
    this.calendars.clear();
    this.nextEventId = 1;
    this.wsFailures = [];
    this.services = new Map([
      [
        "notify",
        ["notify", "mobile_app_example_phone", "persistent_notification"],
      ],
      ["light", ["turn_on", "turn_off"]],
    ]);
    this.devices = [];
    this.areas = [];
    this.floors = [];
    this.entityRegistry = [];
    this.delayMs = 0;
    this.redirectAll = false;
    this.wsMode = "normal";
    this.requests = [];
    this.serviceCalls = [];
    this.wsMessages = [];
    this.wsConnections = 0;
    this.wsClosed = 0;
    this.injections = [];
  }

  get origin(): string {
    return `http://127.0.0.1:${this.server.port}`;
  }

  get baseUrl(): string {
    return this.origin;
  }

  /** Creates or changes a state; `lastChanged` only moves when the state value changes. */
  setState(
    entityId: string,
    state: string,
    attributes: Record<string, unknown> = {},
    lastChanged?: string,
  ): FakeState {
    const now = new Date().toISOString();
    const old = this.states.get(entityId);
    const next: FakeState = {
      entity_id: entityId,
      state,
      attributes,
      last_changed:
        lastChanged ?? (old && old.state === state ? old.last_changed : now),
      last_updated: now,
    };
    this.states.set(entityId, next);
    return next;
  }

  /**
   * A calendar entity. `features` is its `supported_features` (0: it can only be read, like most of
   * them); the fake then also answers the entity's state and takes `calendar.create_event` and the
   * `calendar/event/*` commands as far as the bits allow.
   */
  addCalendar(
    entityId: string,
    events: FakeCalendarEvent[],
    name = entityId,
    features = 0,
  ): void {
    this.calendars.set(entityId, { name, events, features });
  }

  /** The events of a calendar as stored (ours and foreign ones). */
  calendarEvents(entityId: string): FakeCalendarEvent[] {
    const calendar = this.calendars.get(entityId);
    if (!calendar) throw new Error(`no fake calendar ${entityId}`);
    return calendar.events;
  }

  /** The next `times` commands of this type fail with this error code. */
  failWsCommand(type: string, code: string, times = 1): void {
    this.wsFailures.push({ type, code, remaining: times });
  }

  failNext(pathPart: string, status: number, times = 1): void {
    this.injections.push({ pathPart, status, remaining: times });
  }

  requestsTo(pathPart: string, method?: string): RecordedRequest[] {
    return this.requests.filter(
      (r) => r.path.includes(pathPart) && (!method || r.method === method),
    );
  }

  /** Resolves once every WebSocket opened so far has closed (or after a second). */
  async waitIdle(): Promise<void> {
    for (let i = 0; i < 100 && this.wsClosed < this.wsConnections; i++) {
      await sleep(10);
    }
  }

  /** Notify calls only. */
  get notifications(): ServiceCall[] {
    return this.serviceCalls.filter((c) => c.domain === "notify");
  }

  private wsCommand(
    ws: { send(data: string): void; close(): void },
    msg: { type: string; id?: number },
  ) {
    const reply = (success: boolean, body: Record<string, unknown>) =>
      ws.send(JSON.stringify({ id: msg.id, type: "result", success, ...body }));
    switch (this.wsMode) {
      case "no-reply":
        return;
      case "drop":
        ws.close();
        return;
      case "command-error":
        reply(false, {
          error: { code: "unknown_command", message: "Unknown command." },
        });
        return;
      case "bad-result":
        reply(true, { result: { not: "a list" } });
        return;
      case "huge-result":
        reply(true, {
          result: [{ area_id: "x", name: "y".repeat(2_000_000) }],
        });
        return;
    }
    if (msg.type.startsWith("calendar/event/")) {
      this.wsCalendarEvent(msg as WsCalendarMessage, reply);
      return;
    }
    const registry: Record<string, unknown[] | undefined> = {
      "config/device_registry/list": this.devices,
      "config/area_registry/list": this.areas,
      "config/floor_registry/list": this.floors ?? undefined,
      "config/entity_registry/list": this.entityRegistry,
    };
    const list = registry[msg.type];
    if (!list) {
      reply(false, {
        error: { code: "unknown_command", message: "Unknown command." },
      });
      return;
    }
    reply(true, { result: list });
  }

  /** The calendar entities as Home Assistant lists them among the states. */
  private calendarStates(): FakeState[] {
    const now = new Date().toISOString();
    return [...this.calendars]
      .filter(([id]) => !this.states.has(id))
      .map(([entity_id, c]) => ({
        entity_id,
        state: "off",
        attributes: { friendly_name: c.name, supported_features: c.features },
        last_changed: now,
        last_updated: now,
      }));
  }

  /**
   * A time as Home Assistant reads it: with an offset it is that instant, without one it is wall-clock
   * time in the configured zone. `null` for text that is no date or datetime.
   */
  private parseTime(
    value: unknown,
  ): { date: string } | { dateTime: string; aware: boolean } | null {
    if (typeof value !== "string") return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { date: value };
    const match =
      /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/.exec(
        value,
      );
    if (!match) return null;
    const aware = match[5] !== undefined;
    if (aware) return { dateTime: new Date(value).toISOString(), aware: true };
    const [, day, hour, minute, second] = match;
    const instant =
      zonedTimeToInstant(day!, `${hour}:${minute}`, this.timeZone) +
      Number(second ?? 0) * 1000;
    return { dateTime: this.localIso(instant), aware: false };
  }

  /** An instant as Home Assistant answers it: local time of the configured zone with its offset. */
  private localIso(instant: number): string {
    const offsetMin = Math.round(
      (Date.parse(
        `${localDateOf(this.timeZone, instant)}T${localTimeOf(this.timeZone, instant)}:00Z`,
      ) -
        Math.floor(instant / 60_000) * 60_000) /
        60_000,
    );
    const sign = offsetMin < 0 ? "-" : "+";
    const abs = Math.abs(offsetMin);
    const pad = (n: number) => String(n).padStart(2, "0");
    const seconds = pad(Math.floor(instant / 1000) % 60);
    return `${localDateOf(this.timeZone, instant)}T${localTimeOf(this.timeZone, instant)}:${seconds}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  }

  /**
   * Checks and stores an event the way the calendar component does: both ends of one type, a datetime
   * pair with the same kind of offset, at least a second (a day for dates) between them.
   */
  private storeEvent(
    calendar: FakeCalendarStore,
    fields: {
      summary: unknown;
      description: unknown;
      location: unknown;
      start: unknown;
      end: unknown;
    },
    uid: string,
  ): string | null {
    if (typeof fields.summary !== "string") return "summary is required";
    const start = this.parseTime(fields.start);
    const end = this.parseTime(fields.end);
    if (!start || !end) return "start and end must be a date or a datetime";
    if ("date" in start !== "date" in end) {
      return "Expected all values to be the same type";
    }
    if ("aware" in start && "aware" in end && start.aware !== end.aware) {
      return "Expected all values to have the same timezone";
    }
    const startMs =
      "date" in start
        ? Date.parse(`${start.date}T00:00:00Z`)
        : Date.parse(start.dateTime);
    const endMs =
      "date" in end
        ? Date.parse(`${end.date}T00:00:00Z`)
        : Date.parse(end.dateTime);
    if (endMs - startMs < ("date" in start ? 86_400_000 : 1000)) {
      return "Expected the end to be after the start";
    }
    const event: FakeCalendarEvent = {
      summary: fields.summary,
      start:
        "date" in start ? { date: start.date } : { dateTime: start.dateTime },
      end: "date" in end ? { date: end.date } : { dateTime: end.dateTime },
      ...(typeof fields.description === "string"
        ? { description: fields.description }
        : {}),
      ...(typeof fields.location === "string" && fields.location !== ""
        ? { location: fields.location }
        : {}),
      uid,
    };
    const index = calendar.events.findIndex((e) => e.uid === uid);
    if (index >= 0) calendar.events[index] = event;
    else calendar.events.push(event);
    return null;
  }

  /** `calendar.create_event`: an entity service for calendars that can create events. */
  private calendarService(service: string, data: unknown): Response {
    if (service !== "create_event") {
      return this.json({ message: "Service not found." }, 400);
    }
    const body = (data ?? {}) as Record<string, unknown>;
    this.serviceCalls.push({ domain: "calendar", service, data });
    const allowed = new Set([
      "entity_id",
      "summary",
      "description",
      "location",
      "start_date",
      "end_date",
      "start_date_time",
      "end_date_time",
      "in",
    ]);
    const extra = Object.keys(body).filter((k) => !allowed.has(k));
    if (extra.length > 0) {
      return this.json({ message: `extra keys not allowed: ${extra}` }, 400);
    }
    const calendar =
      typeof body.entity_id === "string"
        ? this.calendars.get(body.entity_id)
        : undefined;
    if (!calendar) {
      return this.json({ message: "Entity not found." }, 400);
    }
    if ((calendar.features & CALENDAR_FEATURES.create) === 0) {
      return this.json(
        { message: "Entity does not support this service." },
        400,
      );
    }
    const dates = "start_date" in body || "end_date" in body;
    const times = "start_date_time" in body || "end_date_time" in body;
    if (dates === times) {
      return this.json(
        { message: "Provide either dates or datetimes, both ends." },
        400,
      );
    }
    const problem = this.storeEvent(
      calendar,
      {
        summary: body.summary,
        description: body.description ?? "",
        location: body.location,
        start: dates ? body.start_date : body.start_date_time,
        end: dates ? body.end_date : body.end_date_time,
      },
      `uid-${this.nextEventId++}`,
    );
    return problem ? this.json({ message: problem }, 400) : this.json([]);
  }

  /** `calendar/event/create|update|delete`: the commands the calendar editor uses. */
  private wsCalendarEvent(
    msg: WsCalendarMessage,
    reply: (success: boolean, body: Record<string, unknown>) => void,
  ) {
    const error = (code: string, message: string) =>
      reply(false, { error: { code, message } });
    const injected = this.wsFailures.find(
      (f) => f.type === msg.type && f.remaining > 0,
    );
    if (injected) {
      injected.remaining--;
      return error(injected.code, "Injected failure.");
    }
    const calendar =
      typeof msg.entity_id === "string"
        ? this.calendars.get(msg.entity_id)
        : undefined;
    if (!calendar) return error("not_found", "Entity not found");
    const needs = {
      "calendar/event/create": CALENDAR_FEATURES.create,
      "calendar/event/update": CALENDAR_FEATURES.update,
      "calendar/event/delete": CALENDAR_FEATURES.delete,
    }[msg.type];
    if (needs === undefined)
      return error("unknown_command", "Unknown command.");
    if ((calendar.features & needs) === 0) {
      return error("not_supported", "Calendar does not support this feature");
    }
    if (msg.type === "calendar/event/delete") {
      const index = calendar.events.findIndex((e) => e.uid === msg.uid);
      if (typeof msg.uid !== "string" || index < 0) {
        return error("failed", "Unknown event");
      }
      calendar.events.splice(index, 1);
      return reply(true, { result: null });
    }
    const event = (msg.event ?? {}) as Record<string, unknown>;
    const uid =
      msg.type === "calendar/event/update"
        ? msg.uid
        : `uid-${this.nextEventId++}`;
    if (
      typeof uid !== "string" ||
      (msg.type === "calendar/event/update" &&
        !calendar.events.some((e) => e.uid === uid))
    ) {
      return error("failed", "Unknown event");
    }
    const problem = this.storeEvent(
      calendar,
      {
        summary: event.summary,
        description: event.description,
        location: event.location,
        start: event.dtstart,
        end: event.dtend,
      },
      uid,
    );
    if (problem) return error("invalid_format", problem);
    reply(true, { result: null });
  }

  private json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    let json: unknown;
    if (
      req.method !== "GET" &&
      req.headers.get("content-type")?.includes("json")
    ) {
      json = await req.clone().json();
    }
    this.requests.push({
      method: req.method,
      path: url.pathname,
      query: url.searchParams,
      headers: req.headers,
      json,
    });
    if (this.delayMs) await sleep(this.delayMs);
    if (this.redirectAll) {
      return new Response(null, {
        status: 301,
        headers: { location: "https://elsewhere.invalid/" },
      });
    }
    if (req.headers.get("authorization") !== `Bearer ${this.token}`) {
      return new Response("401: Unauthorized", { status: 401 });
    }
    const injection = this.injections.find(
      (i) => url.pathname.includes(i.pathPart) && i.remaining > 0,
    );
    if (injection) {
      injection.remaining--;
      return new Response("injected failure", { status: injection.status });
    }

    const parts = url.pathname
      .replace(/^\/api\/?/, "")
      .split("/")
      .filter(Boolean);
    const [root, second, third] = parts;

    if (parts.length === 0) return this.json({ message: "API running." });
    if (root === "config") {
      return this.json({
        version: this.version,
        time_zone: this.timeZone,
        location_name: this.locationName,
        latitude: 12.3456,
        longitude: 65.4321,
        elevation: 400,
        unit_system: { temperature: "°C" },
        components: ["api", "calendar"],
      });
    }
    if (root === "states") {
      if (!second) {
        return this.json([...this.states.values(), ...this.calendarStates()]);
      }
      const state =
        this.states.get(second) ??
        this.calendarStates().find((c) => c.entity_id === second);
      return state
        ? this.json(state)
        : this.json({ message: "Entity not found." }, 404);
    }
    if (root === "calendars") {
      if (!second) {
        return this.json(
          [...this.calendars].map(([entity_id, c]) => ({
            entity_id,
            name: c.name,
          })),
        );
      }
      const cal = this.calendars.get(second);
      if (!cal) return this.json({ message: "Calendar not found." }, 404);
      const start = Date.parse(url.searchParams.get("start") ?? "");
      const end = Date.parse(url.searchParams.get("end") ?? "");
      if (Number.isNaN(start) || Number.isNaN(end)) {
        return this.json({ message: "Invalid date range." }, 400);
      }
      const instant = (t: { date: string } | { dateTime: string }) =>
        "date" in t
          ? Date.parse(`${t.date}T00:00:00Z`)
          : Date.parse(t.dateTime);
      return this.json(
        cal.events.filter(
          (e) => !(instant(e.end) <= start || instant(e.start) >= end),
        ),
      );
    }
    if (root === "services") {
      if (req.method === "GET" && !second) {
        return this.json(
          [...this.services].map(([domain, names]) => ({
            domain,
            services: Object.fromEntries(
              names.map((n) => [n, { name: n, description: "", fields: {} }]),
            ),
          })),
        );
      }
      if (req.method === "POST" && second === "calendar" && third) {
        return this.calendarService(third, json);
      }
      if (req.method === "POST" && second && third) {
        if (!this.services.get(second)?.includes(third)) {
          return this.json({ message: "Service not found." }, 400);
        }
        this.serviceCalls.push({ domain: second, service: third, data: json });
        return this.json([]);
      }
    }
    return new Response("404: Not Found", { status: 404 });
  }
}

/** Starts a fake server; call `.stop()` when done. */
export function startFakeHomeAssistant(): FakeHomeAssistant {
  const fake = new FakeHomeAssistant();
  fake.start();
  return fake;
}
