import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, list } from "$lib/server/api/handlers/cost-budgets";

export const GET = bind(endpoints.costBudgetsList, list);
export const POST = bind(endpoints.costBudgetsCreate, create);
