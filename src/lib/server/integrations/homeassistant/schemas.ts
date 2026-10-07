import { z } from "zod";
import { isValidDate } from "$lib/dates";

const nullableString = z
  .string()
  .nullish()
  .transform((v) => v ?? null);

export const ENTITY_ID_RE = /^[a-z0-9_]+\.[a-z0-9_]+$/;
export const SLUG_RE = /^[a-z0-9_]+$/;

export interface HaConfig {
  version: string;
  timeZone: string;
  locationName: string;
}

/** Latitude, longitude, elevation and the component list are deliberately not kept. */
export const configSchema = z
  .object({
    version: z.string().min(1),
    time_zone: z.string().min(1),
    location_name: z.string(),
  })
  .transform((c): HaConfig => ({
    version: c.version,
    timeZone: c.time_zone,
    locationName: c.location_name,
  }));

export interface HaState {
  entityId: string;
  state: string;
  attributes: Record<string, unknown>;
  /** ISO 8601 as sent by Home Assistant. */
  lastChanged: string;
  lastUpdated: string;
}

export const stateSchema = z
  .object({
    entity_id: z.string().regex(ENTITY_ID_RE),
    state: z.string(),
    attributes: z.record(z.string(), z.unknown()).nullish(),
    last_changed: z.string(),
    last_updated: z.string().nullish(),
  })
  .transform((s): HaState => ({
    entityId: s.entity_id,
    state: s.state,
    attributes: s.attributes ?? {},
    lastChanged: s.last_changed,
    lastUpdated: s.last_updated ?? s.last_changed,
  }));

export const stateListSchema = z.array(stateSchema);

const dateField = z
  .string()
  .refine(isValidDate, { message: "not a YYYY-MM-DD date" });
const dateTimeField = z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
  message: "not an ISO 8601 datetime",
});
const eventTime = z.union([
  z.object({ date: dateField }),
  z.object({ dateTime: dateTimeField }),
]);

export type HaEventTime = { date: string } | { dateTime: string };

export interface HaCalendarEvent {
  summary: string;
  start: HaEventTime;
  end: HaEventTime | null;
  description: string | null;
  location: string | null;
  uid: string | null;
}

export const calendarEventSchema = z
  .object({
    summary: z.string().nullish(),
    start: eventTime,
    end: eventTime.nullish(),
    description: nullableString,
    location: nullableString,
    uid: nullableString,
  })
  .transform((e): HaCalendarEvent => ({
    summary: e.summary ?? "",
    start: e.start,
    end: e.end ?? null,
    description: e.description,
    location: e.location,
    uid: e.uid,
  }));

export const calendarEventListSchema = z.array(calendarEventSchema);

export interface HaCalendar {
  entityId: string;
  name: string;
}

export const calendarListSchema = z
  .array(
    z.object({
      entity_id: z.string().regex(ENTITY_ID_RE),
      name: z.string().nullish(),
    }),
  )
  .transform((list) =>
    list.map((c): HaCalendar => ({
      entityId: c.entity_id,
      name: c.name ?? c.entity_id,
    })),
  );

export const serviceListSchema = z.array(
  z.object({
    domain: z.string(),
    services: z.record(z.string(), z.unknown()),
  }),
);

/** `POST /api/services/...` answers a list of changed states (or an object with `return_response`). */
export const serviceCallResponseSchema = z.union([
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);

export interface HaDevice {
  id: string;
  name: string | null;
  nameByUser: string | null;
  manufacturer: string | null;
  model: string | null;
  areaId: string | null;
  disabled: boolean;
}

export const deviceRegistrySchema = z.array(
  z
    .object({
      id: z.string(),
      name: nullableString,
      name_by_user: nullableString,
      manufacturer: nullableString,
      model: nullableString,
      area_id: nullableString,
      disabled_by: nullableString,
    })
    .transform((d): HaDevice => ({
      id: d.id,
      name: d.name,
      nameByUser: d.name_by_user,
      manufacturer: d.manufacturer,
      model: d.model,
      areaId: d.area_id,
      disabled: d.disabled_by !== null,
    })),
);

export interface HaArea {
  areaId: string;
  name: string;
  floorId: string | null;
}

export const areaRegistrySchema = z.array(
  z
    .object({
      area_id: z.string(),
      name: z.string(),
      floor_id: nullableString,
    })
    .transform((a): HaArea => ({
      areaId: a.area_id,
      name: a.name,
      floorId: a.floor_id,
    })),
);

export interface HaFloor {
  floorId: string;
  name: string;
  level: number | null;
}

export const floorRegistrySchema = z.array(
  z
    .object({
      floor_id: z.string(),
      name: z.string(),
      level: z.number().nullish(),
    })
    .transform((f): HaFloor => ({
      floorId: f.floor_id,
      name: f.name,
      level: f.level ?? null,
    })),
);

export interface HaEntityRegistryEntry {
  entityId: string;
  name: string | null;
  originalName: string | null;
  platform: string | null;
  deviceId: string | null;
  areaId: string | null;
  disabled: boolean;
  hidden: boolean;
}

export const entityRegistrySchema = z.array(
  z
    .object({
      entity_id: z.string().regex(ENTITY_ID_RE),
      name: nullableString,
      original_name: nullableString,
      platform: nullableString,
      device_id: nullableString,
      area_id: nullableString,
      disabled_by: nullableString,
      hidden_by: nullableString,
    })
    .transform((e): HaEntityRegistryEntry => ({
      entityId: e.entity_id,
      name: e.name,
      originalName: e.original_name,
      platform: e.platform,
      deviceId: e.device_id,
      areaId: e.area_id,
      disabled: e.disabled_by !== null,
      hidden: e.hidden_by !== null,
    })),
);
