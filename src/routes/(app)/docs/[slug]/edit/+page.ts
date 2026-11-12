import { createApiClient } from "#lib/api/client.ts";
import { fetchAll } from "#lib/api/fetch-all.ts";
import { orFail } from "#lib/api/load.ts";
import { endpoints } from "#lib/api/registry.ts";
import { loadPlaces } from "#lib/tasks/load.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, params, url }) => {
  const client = createApiClient(fetch);
  const [page, places, pages] = await Promise.all([
    orFail(
      client.call(endpoints.pagesGet, { params: { slug: params.slug } }),
      url.pathname,
    ),
    loadPlaces(client, url.pathname),
    orFail(
      fetchAll((cursor) =>
        client.call(endpoints.pagesList, {
          query: { limit: 200, ...(cursor ? { cursor } : {}) },
        }),
      ),
      url.pathname,
    ),
  ]);
  return { page, ...places, pages };
};
