import { z } from "zod";
import { INTEGRATION_KINDS, INTEGRATION_STATUSES } from "../enums";
import { isoTimestampSchema, paginated } from "./common";

export const integrationKindSchema = z.enum(INTEGRATION_KINDS);

export const integrationKindParamsSchema = z.object({
  kind: integrationKindSchema,
});

const configSchema = z.record(z.string(), z.unknown());

/** A connection as the API shows it: never the access token. */
export const integrationSchema = z
  .object({
    kind: integrationKindSchema,
    /** `household`: one connection for everybody, changed by administrators. `user`: everyone connects their own. */
    level: z.enum(["household", "user"]),
    /** An adapter for this kind runs in this server. */
    available: z.boolean(),
    /** What the adapter can answer: `entities`, `notify-services`, `calendars`, `devices`, ... */
    capabilities: z.array(z.string()),
    configured: z.boolean(),
    enabled: z.boolean(),
    /** Only administrators see the address of a household connection. */
    baseUrl: z.string().nullable(),
    allowInsecureTls: z.boolean(),
    config: configSchema,
    status: z.enum(INTEGRATION_STATUSES),
    /** Short machine-readable code of the last failure (`unauthorized`, `timeout`, `tls`, ...). */
    lastError: z.string().nullable(),
    lastOkAt: isoTimestampSchema.nullable(),
    lastCheckedAt: isoTimestampSchema.nullable(),
    consecutiveFailures: z.number().int().min(0),
  })
  .meta({ id: "Integration" });
export type Integration = z.infer<typeof integrationSchema>;

export const listIntegrationsResponseSchema = paginated(integrationSchema);

export const saveIntegrationRequestSchema = z.strictObject({
  baseUrl: z.string().trim().min(1).max(500),
  /** Required for a new connection and whenever the address changes; blank keeps the stored token. */
  token: z.string().max(4096).optional(),
  allowInsecureTls: z.boolean().default(false),
  /** Kind-specific settings, checked by the adapter; unknown keys are dropped. */
  config: configSchema.optional(),
  enabled: z.boolean().optional(),
});
export type SaveIntegrationRequest = z.output<
  typeof saveIntegrationRequestSchema
>;

export const testIntegrationResponseSchema = z
  .object({
    ok: z.boolean(),
    error: z.object({ code: z.string(), message: z.string() }).nullable(),
    info: z
      .record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean(), z.null()]),
      )
      .nullable(),
    integration: integrationSchema,
  })
  .meta({ id: "IntegrationTest" });

export const listEntitiesQuerySchema = z.object({
  /** Matches the entity id or name, case-insensitively. */
  q: z.string().trim().min(1).max(100).optional(),
  /** `sensor`, `binary_sensor`, ...: only entities of this domain. */
  domain: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]+$/)
    .max(64)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const externalEntitySchema = z
  .object({
    id: z.string(),
    domain: z.string(),
    name: z.string(),
    state: z.string(),
    unit: z.string().nullable(),
    area: z.string().nullable(),
  })
  .meta({ id: "ExternalEntity" });

export const listEntitiesResponseSchema = z.object({
  items: z.array(externalEntitySchema),
  /** Matches before `limit` was applied. */
  total: z.number().int().min(0),
});

export const listNotifyServicesResponseSchema = z.object({
  /** Service names without the domain, e.g. `mobile_app_example_phone`. */
  items: z.array(z.string()),
});

export const externalCalendarSchema = z
  .object({ id: z.string(), name: z.string() })
  .meta({ id: "ExternalCalendar" });

export const listCalendarsResponseSchema = z.object({
  items: z.array(externalCalendarSchema),
});

/** A device of the connected system that no asset represents yet; creating an asset from it is the caller's choice. */
export const externalDeviceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    manufacturer: z.string().nullable(),
    model: z.string().nullable(),
    area: z.string().nullable(),
    /** The id of that area in the connected system, to match a room by what it stores in `haAreaId`. */
    areaId: z.string().nullable(),
  })
  .meta({ id: "ExternalDevice" });

export const listDevicesResponseSchema = z.object({
  items: z.array(externalDeviceSchema),
});

/** What an adapter reports for an area (a room or zone of the connected system). */
export const providerAreaSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  floor: z.string().nullable(),
});

/** An area of the connected system, with the room that already stands for it. */
export const externalAreaSchema = providerAreaSchema
  .extend({
    /** The room whose `haAreaId` is this area; null when no room is linked to it yet. */
    roomId: z.string().nullable(),
  })
  .meta({ id: "ExternalArea" });

export const listAreasResponseSchema = z.object({
  items: z.array(externalAreaSchema),
});

export const actionRequestSchema = z.strictObject({
  /** The action id of the tapped notification button, exactly as the phone reported it (`HW_DONE_<token>`). */
  action: z.string().min(1).max(200),
});

export const actionResponseSchema = z
  .object({
    taskId: z.string(),
    completionId: z.string(),
    /** The token had been used before: this is the first completion again. */
    replayed: z.boolean(),
  })
  .meta({ id: "NotificationActionResult" });
