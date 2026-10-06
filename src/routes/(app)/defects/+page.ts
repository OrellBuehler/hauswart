import { createApiClient } from "$lib/api/client";
import { fetchAll } from "$lib/api/fetch-all";
import { loadHousehold } from "$lib/api/household";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { defectsQuery, parseDefectFilters } from "$lib/defects/filters";
import { loadPlaces } from "$lib/tasks/load";
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
