import { createApiClient } from "#lib/api/client.ts";
import { orFail } from "#lib/api/load.ts";
import { endpoints } from "#lib/api/registry.ts";
import { loadCostContext } from "#lib/costs/load.ts";
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
