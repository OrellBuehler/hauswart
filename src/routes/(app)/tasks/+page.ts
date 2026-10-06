import { createApiClient } from "$lib/api/client";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { parseTaskFilters, tasksQuery } from "$lib/tasks/filters";
import { loadDirectory, loadHousehold, loadPlaces } from "$lib/tasks/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const client = createApiClient(fetch);
  const filters = parseTaskFilters(url.searchParams);
  const [list, household, people, places] = await Promise.all([
    orFail(
      client.call(endpoints.tasksList, { query: tasksQuery(filters) }),
      url.pathname + url.search,
    ),
    loadHousehold(client, url.pathname),
    loadDirectory(client, url.pathname),
    loadPlaces(client, url.pathname),
  ]);
  return {
    filters,
    tasks: list.items,
    nextCursor: list.nextCursor,
    ...household,
    people,
    ...places,
  };
};
