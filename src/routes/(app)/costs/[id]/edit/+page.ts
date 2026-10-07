import { createApiClient } from "$lib/api/client";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { loadCostContext } from "$lib/costs/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, params, url }) => {
  const client = createApiClient(fetch);
  const cost = await orFail(
    client.call(endpoints.costsGet, { params: { id: params.id } }),
    url.pathname,
  );
  const context = await loadCostContext(client, url.pathname, {
    keepAssetId: cost.assetId,
  });
  return { cost, ...context };
};
