import { createApiClient } from "$lib/api/client";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { tryLoadBudgetAlerts } from "$lib/costs/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const client = createApiClient(fetch);
  const [dashboard, household, budgetAlerts] = await Promise.all([
    orFail(client.call(endpoints.dashboard), url.pathname),
    orFail(client.call(endpoints.householdGet), url.pathname),
    tryLoadBudgetAlerts(client, url.pathname),
  ]);
  return { dashboard, timeZone: household.timezone, budgetAlerts };
};
