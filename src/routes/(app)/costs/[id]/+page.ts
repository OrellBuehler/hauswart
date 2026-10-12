import { createApiClient } from "$lib/api/client";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { loadDirectory, loadHousehold } from "$lib/tasks/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, params, url }) => {
  const client = createApiClient(fetch);
  const cost = await orFail(
    client.call(endpoints.costsGet, { params: { id: params.id } }),
    url.pathname,
  );
  const [book, household, people] = await Promise.all([
    orFail(
      client.call(endpoints.costBooksGet, { params: { id: cost.bookId } }),
      url.pathname,
    ),
    loadHousehold(client, url.pathname),
    loadDirectory(client, url.pathname),
  ]);
  return {
    cost,
    book,
    timeZone: household.timeZone,
    people: new Map(people.map((p) => [p.id, p.displayName])),
  };
};
