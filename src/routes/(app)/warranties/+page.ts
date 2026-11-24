import { createApiClient } from "#lib/api/client.ts";
import { fetchAll } from "#lib/api/fetch-all.ts";
import { orFail } from "#lib/api/load.ts";
import { endpoints } from "#lib/api/registry.ts";
import { sortWarranties } from "#lib/warranties/sort.ts";
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
