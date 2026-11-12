import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { status } from "#lib/server/api/handlers/cost-budgets.ts";

export const GET = bind(endpoints.costBudgetsStatus, status);
