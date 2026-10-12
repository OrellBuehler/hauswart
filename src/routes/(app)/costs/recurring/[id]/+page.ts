import { createApiClient } from "$lib/api/client";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { loadHouseholdToday } from "$lib/costs/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, params, url }) => {
  const client = createApiClient(fetch);
  const [{ today }, recurrence] = await Promise.all([
    loadHouseholdToday(client, url.pathname),
    orFail(
      client.call(endpoints.costRecurrencesGet, { params: { id: params.id } }),
      url.pathname,
    ),
  ]);
  return { today, recurrence };
};
