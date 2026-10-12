import { createApiClient } from "$lib/api/client";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { budgetStatusQuery, parseBudgetView } from "$lib/costs/budgets";
import { loadCostBooks, loadHouseholdToday } from "$lib/costs/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const client = createApiClient(fetch);
  const redirectTo = url.pathname + url.search;
  const [{ household, today }, books] = await Promise.all([
    loadHouseholdToday(client, redirectTo),
    loadCostBooks(client, redirectTo),
  ]);
  const view = parseBudgetView(url.searchParams, today);
  const [budgets, status] = await Promise.all([
    orFail(client.call(endpoints.costBudgetsList), redirectTo),
    orFail(
      client.call(endpoints.costBudgetsStatus, {
        query: budgetStatusQuery(view),
      }),
      redirectTo,
    ),
  ]);
  return {
    view,
    today,
    currency: household.currency,
    books,
    budgets: budgets.items,
    status,
  };
};
