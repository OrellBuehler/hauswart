import type { CostConflictCode } from "$lib/api/enums";
import { isApiError } from "$lib/api/errors";
import { costConflictDetailsSchema } from "$lib/api/schemas/costs";

/**
 * Which conflict a 409 of the cost endpoints is (`details.code`, see `COST_CONFLICT_CODES`), so a form does not have to
 * guess from the status and from what it sent. `undefined` for any other failure and for a 409 that carries no code.
 */
export function costConflictCode(err: unknown): CostConflictCode | undefined {
  if (!isApiError(err) || err.code !== "conflict") return undefined;
  const parsed = costConflictDetailsSchema.safeParse(err.details);
  return parsed.success ? parsed.data.code : undefined;
}
