import { createApiClient } from "#lib/api/client.ts";
import { orFail } from "#lib/api/load.ts";
import { endpoints } from "#lib/api/registry.ts";
import { loadHouseholdToday } from "#lib/costs/load.ts";
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
