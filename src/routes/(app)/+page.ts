import { createApiClient } from "#lib/api/client.ts";
import { orFail } from "#lib/api/load.ts";
import { endpoints } from "#lib/api/registry.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const client = createApiClient(fetch);
  const [dashboard, household] = await Promise.all([
    orFail(client.call(endpoints.dashboard), url.pathname),
    orFail(client.call(endpoints.householdGet), url.pathname),
  ]);
  return { dashboard, timeZone: household.timezone };
};
