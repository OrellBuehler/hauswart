import { createApiClient } from "#lib/api/client.ts";
import { fetchAll } from "#lib/api/fetch-all.ts";
import { loadHousehold } from "#lib/api/household.ts";
import { orFail } from "#lib/api/load.ts";
import { endpoints } from "#lib/api/registry.ts";
import { loadCostBooks } from "#lib/costs/load.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, params, url }) => {
  const api = createApiClient(fetch);
  const [asset, rooms, { today }, books] = await orFail(
    Promise.all([
      api.call(endpoints.assetsGet, { params: { id: params.id } }),
      fetchAll((cursor) =>
        api.call(endpoints.roomsList, { query: { cursor, limit: 200 } }),
      ),
      loadHousehold(api),
      loadCostBooks(api, url.pathname),
    ]),
    url.pathname,
  );
  // The details of a vehicle are a resource of their own.
  const vehicle =
    asset.kind === "vehicle"
      ? await orFail(
          api.call(endpoints.vehiclesGet, { params: { id: params.id } }),
          url.pathname,
        )
      : null;
  return {
    asset,
    vehicle,
    books,
    today,
    rooms: rooms.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    ),
  };
};
