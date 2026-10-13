import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { status } from "$lib/server/api/handlers/cost-budgets";

export const GET = bind(endpoints.costBudgetsStatus, status);
