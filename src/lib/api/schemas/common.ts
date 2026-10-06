import { z } from "zod";
import { ERROR_CODES } from "../errors";
import { SCOPES } from "../scopes";

/** Instants on the wire: UTC ISO 8601 with milliseconds (`2026-01-31T09:15:00.000Z`). */
export const isoTimestampSchema = z.iso.datetime();

/** Calendar dates on the wire: `YYYY-MM-DD` in the household time zone. */
export const dateSchema = z.iso.date();

export const idSchema = z.string().min(1).max(64);

export const idParamsSchema = z.object({ id: idSchema });

export const scopeSchema = z.enum(SCOPES);

export const errorCodeSchema = z.enum(ERROR_CODES);

export const errorEnvelopeSchema = z
  .object({
    error: z.object({
      code: errorCodeSchema,
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .meta({ id: "ErrorEnvelope" });

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

export const paginationQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

/** List response: `nextCursor` is null on the last page. */
export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

export const emptySchema = z.null();

/** ms since epoch -> wire format. */
export function toIso(value: Date | number): string {
  return new Date(value).toISOString();
}

/** `?flag=true|false`; `z.coerce.boolean()` would read the string "false" as true. */
export const queryBooleanSchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

/** A PATCH body must change something. */
export function atLeastOne<T extends z.ZodType>(schema: T): T {
  return schema.refine((value) => Object.keys(value as object).length > 0, {
    error: "Provide at least one field to update.",
  }) as T;
}

/** Optional free text: trimmed, an empty string clears the field. */
export function nullableText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable();
}

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    error:
      "Slug may only contain lowercase letters, digits and single hyphens.",
  });

/** The placeholder `response` of a `responseType: "binary"` endpoint: its handler returns a `Response`. */
export const binaryResponseSchema = z.custom<Response>(
  (value) => typeof Response !== "undefined" && value instanceof Response,
);
