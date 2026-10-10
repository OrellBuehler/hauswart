import { createApiClient } from "$lib/api/client";
import { INSURANCE_TYPES } from "$lib/api/enums";
import { fetchAll } from "$lib/api/fetch-all";
import { loadHousehold } from "$lib/api/household";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
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
