import { isApiError } from "$lib/api/errors";

/**
 * The fuel log entry that owns a cost entry, when a change or a delete was refused for that reason: a
 * 409 `conflict` whose `details.fuelLogId` names it. Null for any other error.
 */
export function fuelLogOfConflict(err: unknown): string | null {
  if (!isApiError(err) || err.code !== "conflict") return null;
  const id = (err.details as { fuelLogId?: unknown } | undefined)?.fuelLogId;
  return typeof id === "string" && id !== "" ? id : null;
}
