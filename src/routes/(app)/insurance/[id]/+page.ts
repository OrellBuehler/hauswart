import { createApiClient } from "$lib/api/client";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { loadHousehold } from "$lib/tasks/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, params, url }) => {
  const client = createApiClient(fetch);
  const [policy, household] = await Promise.all([
    orFail(
      client.call(endpoints.insurancePoliciesGet, {
        params: { id: params.id },
      }),
      url.pathname,
    ),
    loadHousehold(client, url.pathname),
  ]);
  return { policy, timeZone: household.timeZone, today: household.today };
};
