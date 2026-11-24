import { createApiClient } from "#lib/api/client.ts";
import { INSURANCE_TYPES } from "#lib/api/enums.ts";
import { fetchAll } from "#lib/api/fetch-all.ts";
import { loadHousehold } from "#lib/api/household.ts";
import { orFail } from "#lib/api/load.ts";
import { endpoints } from "#lib/api/registry.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const api = createApiClient(fetch);
  const [assets, { today, household }] = await orFail(
    Promise.all([
      fetchAll((cursor) =>
        api.call(endpoints.assetsList, {
          query: { limit: 200, ...(cursor ? { cursor } : {}) },
        }),
      ),
      loadHousehold(api),
    ]),
    url.pathname + url.search,
  );
  const assetId = url.searchParams.get("assetId");
  const type = INSURANCE_TYPES.find((t) => t === url.searchParams.get("type"));
  return {
    assets,
    today,
    currency: household.currency,
    defaults: {
      type,
      assetIds: assets.some((asset) => asset.id === assetId) ? [assetId!] : [],
    },
  };
};
