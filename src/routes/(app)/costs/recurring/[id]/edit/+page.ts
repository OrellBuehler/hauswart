import { createApiClient } from "$lib/api/client";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { loadCostContext } from "$lib/costs/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, params, url }) => {
  const client = createApiClient(fetch);
  const recurrence = await orFail(
    client.call(endpoints.costRecurrencesGet, { params: { id: params.id } }),
    url.pathname,
  );
  const context = await loadCostContext(client, url.pathname, {
    keepAssetId: recurrence.assetId,
  });
  return { recurrence, ...context };
};
