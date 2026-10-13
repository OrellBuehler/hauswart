import type { ApiError } from "$lib/api/errors";
import type { CostConflictCode } from "$lib/api/enums";
import { conflict } from "$lib/server/service";

/**
 * A 409 whose `details.code` says which conflict it is (`COST_CONFLICT_CODES`), with more `details` where there is
 * more to say. A leaf module: the cost, finance and receipt services all use it.
 */
export function costConflict(
  code: CostConflictCode,
  message: string,
  details: Record<string, unknown> = {},
): ApiError {
  return conflict(message, { code, ...details });
}
