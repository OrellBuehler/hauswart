import { createApiClient } from "#lib/api/client.ts";
import { fetchAll } from "#lib/api/fetch-all.ts";
import { loadHousehold } from "#lib/api/household.ts";
import { orFail } from "#lib/api/load.ts";
import { endpoints } from "#lib/api/registry.ts";
import { defectsQuery, parseDefectFilters } from "#lib/defects/filters.ts";
import { loadPlaces } from "#lib/tasks/load.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const client = createApiClient(fetch);
  const filters = parseDefectFilters(url.searchParams);
  const redirectTo = url.pathname + url.search;
  const [defects, places, { today }] = await Promise.all([
    orFail(
      fetchAll((cursor) =>
        client.call(endpoints.defectsList, {
          query: defectsQuery(filters, cursor),
        }),
      ),
      redirectTo,
    ),
    loadPlaces(client, redirectTo),
    orFail(loadHousehold(client), redirectTo),
  ]);
  return { filters, defects, today, ...places };
};
