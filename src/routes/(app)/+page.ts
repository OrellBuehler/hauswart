import { createApiClient } from "$lib/api/client";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const client = createApiClient(fetch);
  const [dashboard, household] = await Promise.all([
    orFail(client.call(endpoints.dashboard), url.pathname),
    orFail(client.call(endpoints.householdGet), url.pathname),
  ]);
  return { dashboard, timeZone: household.timezone };
};
