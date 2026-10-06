import { createApiClient } from "$lib/api/client";
import { fetchAll } from "$lib/api/fetch-all";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { sortWarranties } from "$lib/warranties/sort";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const client = createApiClient(fetch);
  const warranties = await orFail(
    fetchAll((cursor) =>
      client.call(endpoints.warrantiesList, {
        query: { limit: 200, ...(cursor ? { cursor } : {}) },
      }),
    ),
    url.pathname,
  );
  return { warranties: sortWarranties(warranties) };
};
