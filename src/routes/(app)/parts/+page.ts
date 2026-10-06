import { createApiClient } from "$lib/api/client";
import { fetchAll } from "$lib/api/fetch-all";
import { loadHousehold } from "$lib/api/household";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const api = createApiClient(fetch);
  const [parts, orderNow, { household, today }] = await orFail(
    Promise.all([
      fetchAll((cursor) =>
        api.call(endpoints.partsList, {
          query: { cursor, limit: 200, includeArchived: "true" },
        }),
      ),
      api.call(endpoints.partsOrderNow),
      loadHousehold(api),
    ]),
    url.pathname,
  );
  return {
    parts,
    orderNow: orderNow.items,
    currency: household.currency,
    today,
  };
};
