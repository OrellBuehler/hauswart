import { createApiClient } from "$lib/api/client";
import { fetchAll } from "$lib/api/fetch-all";
import { loadHousehold } from "$lib/api/household";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const api = createApiClient(fetch);
  const [assets, rooms, { today }] = await orFail(
    Promise.all([
      fetchAll((cursor) =>
        api.call(endpoints.assetsList, {
          query: { cursor, limit: 200, includeArchived: "true" },
        }),
      ),
      fetchAll((cursor) =>
        api.call(endpoints.roomsList, { query: { cursor, limit: 200 } }),
      ),
      loadHousehold(api),
    ]),
    url.pathname,
  );
  return {
    assets: assets.filter((asset) => asset.kind !== "plant"),
    rooms: rooms.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    ),
    today,
  };
};
