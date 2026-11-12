import { createApiClient } from "#lib/api/client.ts";
import { fetchAll } from "#lib/api/fetch-all.ts";
import { loadHousehold } from "#lib/api/household.ts";
import { orFail } from "#lib/api/load.ts";
import { endpoints } from "#lib/api/registry.ts";
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
