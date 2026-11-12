import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { get, remove, update } from "#lib/server/api/handlers/cost-budgets.ts";

export const GET = bind(endpoints.costBudgetsGet, get);
export const PATCH = bind(endpoints.costBudgetsUpdate, update);
export const DELETE = bind(endpoints.costBudgetsDelete, remove);
