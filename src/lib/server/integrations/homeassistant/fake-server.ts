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

interface SocketData {
  authenticated: boolean;
}

export class FakeHomeAssistant {
  token = "test-token";
  version = "2026.1.0";
  timeZone = "Europe/Zurich";
  locationName = "Example Home";
  states = new Map<string, FakeState>();
  calendars = new Map<string, { name: string; events: FakeCalendarEvent[] }>();
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

  addCalendar(
    entityId: string,
    events: FakeCalendarEvent[],
    name = entityId,
  ): void {
    this.calendars.set(entityId, { name, events });
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
      if (!second) return this.json([...this.states.values()]);
      const state = this.states.get(second);
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
