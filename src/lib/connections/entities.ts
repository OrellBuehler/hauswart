import { api } from "$lib/api/browser";
import { endpoints } from "$lib/api/registry";
import type { ExternalEntity } from "$lib/connections/types";
import { formatNumber } from "$lib/format";
import { m } from "$lib/paraglide/messages";

export const ENTITY_ID_PATTERN = /^[a-z0-9_]+\.[a-z0-9_]+$/;

const READING_TTL_MS = 15_000;

const readings = new Map<
  string,
  { at: number; promise: Promise<ExternalEntity | null> }
>();

export async function searchEntities(
  q: string,
  domain?: string,
): Promise<{ items: ExternalEntity[]; total: number }> {
  return api.call(endpoints.integrationsEntities, {
    params: { kind: "homeassistant" },
    query: {
      ...(q.trim() ? { q: q.trim() } : {}),
      ...(domain ? { domain } : {}),
      limit: 30,
    },
  });
}

/** The entity with exactly this id, or null when the connected system does not know it. */
export function lookupEntity(id: string): Promise<ExternalEntity | null> {
  const cached = readings.get(id);
  if (cached && Date.now() - cached.at < READING_TTL_MS) return cached.promise;
  const promise = api
    .call(endpoints.integrationsEntities, {
      params: { kind: "homeassistant" },
      query: { q: id, limit: 20 },
    })
    .then((result) => result.items.find((e) => e.id === id) ?? null);
  readings.set(id, { at: Date.now(), promise });
  promise.catch(() => {
    if (readings.get(id)?.promise === promise) readings.delete(id);
  });
  return promise;
}

export function forgetReadings(): void {
  readings.clear();
}

/** "42 cycles", "on", "unavailable" as people read them; numbers get the locale's separators. */
export function formatReading(entity: {
  state: string;
  unit: string | null;
}): string {
  if (entity.state === "unavailable") return m.entity_state_unavailable();
  if (entity.state === "unknown") return m.entity_state_unknown();
  const numeric = Number(entity.state);
  const text =
    entity.state.trim() !== "" && Number.isFinite(numeric)
      ? formatNumber(numeric)
      : entity.state;
  return entity.unit ? `${text} ${entity.unit}` : text;
}

/** States a switch-like entity can take, offered as shortcuts next to a free text field. */
export function commonStates(domain: string): string[] {
  switch (domain) {
    case "binary_sensor":
    case "switch":
    case "light":
    case "input_boolean":
    case "fan":
      return ["on", "off"];
    case "lock":
      return ["locked", "unlocked"];
    case "cover":
      return ["open", "closed"];
    case "person":
    case "device_tracker":
      return ["home", "not_home"];
    default:
      return [];
  }
}
