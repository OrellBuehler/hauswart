import { createApiClient } from "#lib/api/client.ts";
import { orFail } from "#lib/api/load.ts";
import { endpoints } from "#lib/api/registry.ts";
import { loadHouseholdToday } from "#lib/costs/load.ts";
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
