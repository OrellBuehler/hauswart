import { createApiClient } from "$lib/api/client";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { tryLoadBalances } from "$lib/costs/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const client = createApiClient(fetch);
  const [dashboard, household, balances] = await Promise.all([
    orFail(client.call(endpoints.dashboard), url.pathname),
    orFail(client.call(endpoints.householdGet), url.pathname),
    tryLoadBalances(client, "", url.pathname),
  ]);
  return { dashboard, timeZone: household.timezone, balances };
};
