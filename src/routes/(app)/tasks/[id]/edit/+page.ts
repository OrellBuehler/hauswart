import { createApiClient } from "$lib/api/client";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { loadDirectory, loadHousehold, loadPlaces } from "$lib/tasks/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, params, url }) => {
  const client = createApiClient(fetch);
  const [task, household, people, places] = await Promise.all([
    orFail(
      client.call(endpoints.tasksGet, { params: { id: params.id } }),
      url.pathname,
    ),
    loadHousehold(client, url.pathname),
    loadDirectory(client, url.pathname),
    loadPlaces(client, url.pathname),
  ]);
  return { task, ...household, people, ...places };
};
