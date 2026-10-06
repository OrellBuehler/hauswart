import { z } from "zod";
import {
  assertToken,
  checkStatus,
  fetchOnce,
  normalizeBaseUrl as normalizeUrl,
  readJson,
} from "../http";
import { HomeAssistantError, haFail } from "./errors";
import {
  ENTITY_ID_RE,
  SLUG_RE,
  calendarEventListSchema,
  calendarListSchema,
  configSchema,
  serviceCallResponseSchema,
  serviceListSchema,
  stateListSchema,
  stateSchema,
  type HaCalendar,
  type HaCalendarEvent,
  type HaConfig,
  type HaState,
} from "./schemas";
import { haWsCommand, type WsRegistryCommand, type WsResultMap } from "./ws";

/**
 * http/https only, no credentials. The URL is entered by an administrator;
 * Home Assistant normally lives on the LAN, so private and loopback
 * addresses are accepted on purpose (no SSRF host filter).
 */
export function normalizeBaseUrl(input: string): string {
  return normalizeUrl(input, haFail);
}

export const DEFAULT_TIMEOUT_MS = 10_000;
/** `/api/states` of a large installation is several megabytes. */
export const MAX_JSON_BYTES = 20 * 1024 * 1024;

export interface ClientOptions {
  baseUrl: string;
  /** Long-lived access token. */
  token: string;
  allowInsecureTls?: boolean;
  /** Administrators' and household-wide connections only; see `net/host-policy.ts`. */
  allowLoopback?: boolean;
  timeoutMs?: number;
  maxJsonBytes?: number;
}

function invalid(detail: string): HomeAssistantError {
  return new HomeAssistantError("invalid_input", { detail });
}

function assertEntityId(entityId: string, domain?: string): string {
  if (!ENTITY_ID_RE.test(entityId) || entityId.length > 255) {
    throw invalid("entity id is not valid");
  }
  if (domain && !entityId.startsWith(`${domain}.`)) {
    throw invalid(`entity id must be a ${domain} entity`);
  }
  return entityId;
}

function assertSlug(value: string, what: string): string {
  if (!SLUG_RE.test(value) || value.length > 100) {
    throw invalid(`${what} name is not valid`);
  }
  return value;
}

function isoInstant(value: Date | string, what: string): string {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(ms)) throw invalid(`${what} is not a date`);
  return new Date(ms).toISOString();
}

/** Every call to Home Assistant's REST API: bearer auth, redirects, timeouts, size limits, Zod parsing. */
export class HomeAssistantClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly allowInsecureTls: boolean;
  private readonly allowLoopback: boolean;
  private readonly timeoutMs: number;
  private readonly maxJsonBytes: number;

  constructor(options: ClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    assertToken(options.token, haFail);
    this.token = options.token;
    this.allowInsecureTls = options.allowInsecureTls ?? false;
    this.allowLoopback = options.allowLoopback ?? false;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxJsonBytes = options.maxJsonBytes ?? MAX_JSON_BYTES;
  }

  private async request<S extends z.ZodType>(
    path: string,
    schema: S,
    options: {
      method?: "GET" | "POST";
      query?: URLSearchParams;
      json?: unknown;
    } = {},
  ): Promise<z.output<S>> {
    const search = options.query?.toString();
    const url = `${this.baseUrl}/api/${path}${search ? `?${search}` : ""}`;
    const headers = new Headers({
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
    });
    if (options.json !== undefined)
      headers.set("Content-Type", "application/json");
    const res = await checkStatus(
      await fetchOnce(
        url,
        {
          method: options.method ?? "GET",
          headers,
          body:
            options.json === undefined
              ? undefined
              : JSON.stringify(options.json),
          timeoutMs: this.timeoutMs,
          allowInsecureTls: this.allowInsecureTls,
          allowLoopback: this.allowLoopback,
        },
        haFail,
      ),
      "homeassistant",
      haFail,
    );
    return readJson(res, schema, this.maxJsonBytes, "homeassistant", haFail);
  }

  /** Connection test: version, time zone and location name (no coordinates). */
  getConfig(): Promise<HaConfig> {
    return this.request("config", configSchema);
  }

  getStates(): Promise<HaState[]> {
    return this.request("states", stateListSchema);
  }

  /** `not_found` when the entity does not exist. */
  async getState(entityId: string): Promise<HaState> {
    return this.request(`states/${assertEntityId(entityId)}`, stateSchema);
  }

  /**
   * States of the given entities. Home Assistant has no bulk filter, so this
   * reads all states once and filters; `missing` lists ids it does not know.
   */
  async getEntitiesStates(
    entityIds: readonly string[],
  ): Promise<{ states: Map<string, HaState>; missing: string[] }> {
    const wanted = [...new Set(entityIds.map((id) => assertEntityId(id)))];
    const all = await this.getStates();
    const byId = new Map(all.map((s) => [s.entityId, s]));
    const states = new Map<string, HaState>();
    const missing: string[] = [];
    for (const id of wanted) {
      const s = byId.get(id);
      if (s) states.set(id, s);
      else missing.push(id);
    }
    return { states, missing };
  }

  listCalendars(): Promise<HaCalendar[]> {
    return this.request("calendars", calendarListSchema);
  }

  /**
   * Events of a calendar entity between `start` and `end`. All-day events
   * have `start.date`, timed events `start.dateTime`.
   */
  async getCalendarEvents(
    entityId: string,
    start: Date | string,
    end: Date | string,
  ): Promise<HaCalendarEvent[]> {
    const id = assertEntityId(entityId, "calendar");
    const from = isoInstant(start, "start");
    const to = isoInstant(end, "end");
    if (Date.parse(to) <= Date.parse(from))
      throw invalid("end must be after start");
    return this.request(`calendars/${id}`, calendarEventListSchema, {
      query: new URLSearchParams({ start: from, end: to }),
    });
  }

  /** Calls `domain.service`; `data` is the service data. */
  async callService(
    domain: string,
    service: string,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    await this.request(
      `services/${assertSlug(domain, "domain")}/${assertSlug(service, "service")}`,
      serviceCallResponseSchema,
      { method: "POST", json: data },
    );
  }

  /** `notify.<service>`, e.g. `mobile_app_example_phone`. */
  sendNotification(
    service: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    return this.callService("notify", service, payload);
  }

  /** Names of the `notify` services (without the domain), sorted. */
  async listNotifyServices(): Promise<string[]> {
    const domains = await this.request("services", serviceListSchema);
    return domains
      .filter((d) => d.domain === "notify")
      .flatMap((d) => Object.keys(d.services))
      .filter((name) => SLUG_RE.test(name))
      .sort();
  }

  /** Device, area or entity registry. Home Assistant offers these over WebSocket only. */
  registry<T extends WsRegistryCommand["type"]>(
    type: T,
  ): Promise<WsResultMap[T]> {
    return haWsCommand(
      this.baseUrl,
      this.token,
      { type },
      {
        timeoutMs: this.timeoutMs,
        allowInsecureTls: this.allowInsecureTls,
        allowLoopback: this.allowLoopback,
      },
    );
  }
}
