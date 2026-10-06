import { createApiClient } from "$lib/api/client";
import { fetchAll } from "$lib/api/fetch-all";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, params, url }) => {
  const api = createApiClient(fetch);
  const [room, assets] = await orFail(
    Promise.all([
      api.call(endpoints.roomsGet, { params: { id: params.id } }),
      fetchAll((cursor) =>
        api.call(endpoints.assetsList, {
          query: { cursor, limit: 200, roomId: params.id },
        }),
      ),
    ]),
    url.pathname,
  );
  return { room, assets: assets.sort((a, b) => a.name.localeCompare(b.name)) };
};
