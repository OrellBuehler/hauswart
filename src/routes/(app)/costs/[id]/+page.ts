import { createApiClient } from "$lib/api/client";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { loadDirectory, loadHousehold } from "$lib/tasks/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, params, url }) => {
  const client = createApiClient(fetch);
  const [cost, household, people] = await Promise.all([
    orFail(
      client.call(endpoints.costsGet, { params: { id: params.id } }),
      url.pathname,
    ),
    loadHousehold(client, url.pathname),
    loadDirectory(client, url.pathname),
  ]);
  return {
    cost,
    timeZone: household.timeZone,
    people: new Map(people.map((p) => [p.id, p.displayName])),
  };
};
