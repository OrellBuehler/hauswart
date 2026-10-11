import { createApiClient } from "$lib/api/client";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { loadHousehold } from "$lib/tasks/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, params, url }) => {
  const client = createApiClient(fetch);
  const [appointment, household] = await Promise.all([
    orFail(
      client.call(endpoints.appointmentsGet, { params: { id: params.id } }),
      url.pathname,
    ),
    loadHousehold(client, url.pathname),
  ]);
  return { appointment, timeZone: household.timeZone, today: household.today };
};
