import { ApiError } from "$lib/api/errors";
import type { DB } from "./db";

/** What a service needs from the request: the database and the instant to work as of. */
export interface ServiceContext {
  db: DB;
  /** ms since epoch; tests inject it, requests pass `Date.now()`. */
  now: number;
}

export function notFound(what: string): ApiError {
  return new ApiError("not_found", `${what} not found`);
}

export function forbidden(message: string): ApiError {
  return new ApiError("forbidden", message);
}

export function conflict(message: string): ApiError {
  return new ApiError("conflict", message);
}

/** A 400 in the same shape as a schema failure, for checks only the database can make. */
export function invalidField(
  field: string,
  message: string,
  source: "body" | "query" = "body",
): ApiError {
  return new ApiError("invalid_request", "Invalid request", {
    details: {
      [source]: { formErrors: [], fieldErrors: { [field]: [message] } },
    },
  });
}

export function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    ((err as { code?: unknown }).code === "SQLITE_CONSTRAINT_UNIQUE" ||
      /UNIQUE constraint failed/i.test(err.message))
  );
}
