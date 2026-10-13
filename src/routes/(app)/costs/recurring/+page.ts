import { createApiClient } from "$lib/api/client";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { loadHouseholdToday } from "$lib/costs/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const client = createApiClient(fetch);
  const [{ today }, recurrences] = await Promise.all([
    loadHouseholdToday(client, url.pathname),
    orFail(
      client.call(endpoints.costRecurrencesList, { query: {} }),
      url.pathname,
    ),
  ]);
  return { today, recurrences: recurrences.items };
};
