import { z } from "zod";
import { and, isNull } from "drizzle-orm";
import { assets } from "$lib/server/db";
import { IntegrationError } from "$lib/server/connections/errors";
import type {
  IntegrationAdapter,
  IntegrationOperation,
  ResolvedConnection,
} from "$lib/server/connections/registry";
import { normalizeBaseUrl } from "./client";
import {
  EXTERNAL_SOURCE,
  KIND,
  clientFor,
  toIntegrationError,
} from "./connection";
import { HomeAssistantError, describeError, errorCode } from "./errors";
import type {
  HaArea,
  HaDevice,
  HaEntityRegistryEntry,
  HaFloor,
  HaState,
} from "./schemas";

/** The settings of this kind: the public address of this app as phones reach it (links in notifications). */
const configSchema = z.object({
  appUrl: z.string().trim().max(500).optional(),
});

function normalizeAppUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new IntegrationError(
      "invalid_input",
      "The app address must be a valid http:// or https:// address.",
      { cause },
    );
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    throw new IntegrationError(
      "invalid_input",
      "The app address must be a valid http:// or https:// address without credentials.",
    );
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** Normalises the address and keeps only the known settings. */
export function validateInput(input: {
  baseUrl: string;
  config: Record<string, unknown>;
}): { baseUrl: string; config: Record<string, unknown> } {
  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(input.baseUrl);
  } catch (err) {
    throw toIntegrationError(err);
  }
  const parsed = configSchema.safeParse(input.config);
  if (!parsed.success) {
    throw new IntegrationError("invalid_input", "The settings are not valid.");
  }
  const appUrl = parsed.data.appUrl;
  return {
    baseUrl,
    config: appUrl ? { appUrl: normalizeAppUrl(appUrl) } : {},
  };
}

/** The public address of this app for links in notifications: the setting, else `ORIGIN`, else none. */
export function appUrlOf(config: Record<string, unknown>): string | null {
  const parsed = configSchema.safeParse(config);
  const configured = parsed.success ? parsed.data.appUrl : undefined;
  const fallback = process.env.ORIGIN?.trim();
  const value = configured || fallback;
  if (!value) return null;
  try {
    return normalizeAppUrl(value);
  } catch (err) {
    if (err instanceof IntegrationError) return null;
    throw err;
  }
}

export interface ExternalEntity {
  id: string;
  domain: string;
  name: string;
  state: string;
  unit: string | null;
  area: string | null;
}

const CACHE_MS = 30_000;

interface Registries {
  entities: HaEntityRegistryEntry[];
  devices: HaDevice[];
  areas: HaArea[];
}

const entityCache = new Map<string, { at: number; items: ExternalEntity[] }>();

/** Area lookups are a convenience: a system that refuses the registry commands still gets its entities listed. */
async function loadRegistries(
  connection: ResolvedConnection,
): Promise<Registries | null> {
  const client = clientFor(connection);
  try {
    const [entities, devices, areas] = await Promise.all([
      client.registry("config/entity_registry/list"),
      client.registry("config/device_registry/list"),
      client.registry("config/area_registry/list"),
    ]);
    return { entities, devices, areas };
  } catch (err) {
    console.warn("homeassistant: area lookup unavailable", errorCode(err));
    return null;
  }
}

function areaNames(registries: Registries | null): Map<string, string> {
  const names = new Map<string, string>();
  if (!registries) return names;
  const area = new Map(registries.areas.map((a) => [a.areaId, a.name]));
  const deviceArea = new Map(
    registries.devices.map((d) => [d.id, d.areaId] as const),
  );
  for (const e of registries.entities) {
    const areaId =
      e.areaId ?? (e.deviceId ? (deviceArea.get(e.deviceId) ?? null) : null);
    const name = areaId ? area.get(areaId) : undefined;
    if (name) names.set(e.entityId, name);
  }
  return names;
}

function describeEntity(
  state: HaState,
  areas: Map<string, string>,
): ExternalEntity {
  const friendly = state.attributes.friendly_name;
  const unit = state.attributes.unit_of_measurement;
  return {
    id: state.entityId,
    domain: state.entityId.slice(0, state.entityId.indexOf(".")),
    name:
      typeof friendly === "string" && friendly !== ""
        ? friendly
        : state.entityId,
    state: state.state,
    unit: typeof unit === "string" && unit !== "" ? unit : null,
    area: areas.get(state.entityId) ?? null,
  };
}

async function allEntities(
  connection: ResolvedConnection,
  now: number,
): Promise<ExternalEntity[]> {
  const cached = entityCache.get(connection.id);
  if (cached && now - cached.at < CACHE_MS) return cached.items;
  const client = clientFor(connection);
  const [states, registries] = await Promise.all([
    client.getStates(),
    loadRegistries(connection),
  ]);
  const areas = areaNames(registries);
  const items = states
    .map((s) => describeEntity(s, areas))
    .sort((a, b) => a.id.localeCompare(b.id));
  entityCache.set(connection.id, { at: now, items });
  return items;
}

/** Forgets cached entity lists (a connection changed). */
export function clearEntityCache(): void {
  entityCache.clear();
}

const entities: IntegrationOperation = async (connection, query, ctx) => {
  try {
    const q = query.q?.toLowerCase();
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
    const matches = (await allEntities(connection, ctx.now)).filter(
      (e) =>
        (!query.domain || e.domain === query.domain) &&
        (!q ||
          e.id.toLowerCase().includes(q) ||
          e.name.toLowerCase().includes(q)),
    );
    return { items: matches.slice(0, limit), total: matches.length };
  } catch (err) {
    throw toIntegrationError(err);
  }
};

const notifyServices: IntegrationOperation = async (connection) => {
  try {
    return { items: await clientFor(connection).listNotifyServices() };
  } catch (err) {
    throw toIntegrationError(err);
  }
};

const calendars: IntegrationOperation = async (connection) => {
  try {
    const list = await clientFor(connection).listCalendars();
    return { items: list.map((c) => ({ id: c.entityId, name: c.name })) };
  } catch (err) {
    throw toIntegrationError(err);
  }
};

/** Floors are optional (Home Assistant before 2024.4 has none): areas are listed without them rather than not at all. */
async function loadFloors(
  connection: ResolvedConnection,
): Promise<Map<string, HaFloor>> {
  try {
    const floors = await clientFor(connection).registry(
      "config/floor_registry/list",
    );
    return new Map(floors.map((f) => [f.floorId, f]));
  } catch (err) {
    console.warn("homeassistant: floor lookup unavailable", errorCode(err));
    return new Map();
  }
}

/** Every area with the name of its floor, ordered by floor level, then name; the core adds which room each one is. */
const areas: IntegrationOperation = async (connection) => {
  try {
    const [list, floors] = await Promise.all([
      clientFor(connection).registry("config/area_registry/list"),
      loadFloors(connection),
    ]);
    const items = list
      .map((a) => {
        const floor = a.floorId ? floors.get(a.floorId) : undefined;
        return {
          id: a.areaId,
          name: a.name,
          floor: floor?.name ?? null,
          level: floor?.level ?? null,
        };
      })
      .sort(
        (a, b) =>
          (a.level ?? Number.MAX_SAFE_INTEGER) -
            (b.level ?? Number.MAX_SAFE_INTEGER) ||
          a.name.localeCompare(b.name),
      )
      .map(({ id, name, floor }) => ({ id, name, floor }));
    return { items };
  } catch (err) {
    throw toIntegrationError(err);
  }
};

const normal = (value: string | null | undefined): string =>
  (value ?? "").trim().toLowerCase();

/**
 * Whether an inventory asset already stands for a device: the same external
 * reference, the same name, or the same model with a name that contains the
 * other (a second identical device is not hidden by a first one that has a
 * different name).
 */
export function deviceIsKnown(
  device: { id: string; name: string; model: string | null },
  asset: {
    name: string;
    model: string | null;
    externalSource: string | null;
    externalRef: string | null;
  },
): boolean {
  if (
    asset.externalSource === EXTERNAL_SOURCE &&
    asset.externalRef === device.id
  ) {
    return true;
  }
  const deviceName = normal(device.name);
  const assetName = normal(asset.name);
  if (deviceName !== "" && deviceName === assetName) return true;
  return (
    normal(device.model) !== "" &&
    normal(device.model) === normal(asset.model) &&
    deviceName !== "" &&
    assetName !== "" &&
    (deviceName.includes(assetName) || assetName.includes(deviceName))
  );
}

const devices: IntegrationOperation = async (connection, _query, ctx) => {
  try {
    const client = clientFor(connection);
    const [list, areas] = await Promise.all([
      client.registry("config/device_registry/list"),
      client.registry("config/area_registry/list"),
    ]);
    const areaName = new Map(areas.map((a) => [a.areaId, a.name]));
    const existing = ctx.db
      .select({
        name: assets.name,
        model: assets.model,
        externalSource: assets.externalSource,
        externalRef: assets.externalRef,
      })
      .from(assets)
      .where(and(isNull(assets.archivedAt)))
      .all();
    const items = list
      .filter((d) => !d.disabled)
      .map((d) => ({
        id: d.id,
        name: d.nameByUser ?? d.name ?? d.id,
        manufacturer: d.manufacturer,
        model: d.model,
        area: d.areaId ? (areaName.get(d.areaId) ?? null) : null,
        areaId: d.areaId && areaName.has(d.areaId) ? d.areaId : null,
      }))
      .filter((d) => !existing.some((a) => deviceIsKnown(d, a)))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { items };
  } catch (err) {
    throw toIntegrationError(err);
  }
};

export const homeAssistantIntegration: IntegrationAdapter = {
  kind: KIND,
  validate: validateInput,
  async test(connection) {
    try {
      const config = await clientFor(connection).getConfig();
      return {
        ok: true,
        info: {
          version: config.version,
          timeZone: config.timeZone,
          locationName: config.locationName,
        },
      };
    } catch (err) {
      if (err instanceof HomeAssistantError) {
        return { ok: false, error: { code: err.code, message: err.message } };
      }
      return {
        ok: false,
        error: { code: errorCode(err), message: describeError(err) },
      };
    }
  },
  describe: () => ({
    capabilities: [
      "entities",
      "notify-services",
      "calendars",
      "devices",
      "areas",
    ],
  }),
  operations: {
    entities,
    "notify-services": notifyServices,
    calendars,
    devices,
    areas,
  },
};
