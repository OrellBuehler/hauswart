import { createApiClient } from "#lib/api/client.ts";
import { orFail } from "#lib/api/load.ts";
import { endpoints } from "#lib/api/registry.ts";
import { loadCostContext, tryLoadFinanceConnected } from "#lib/costs/load.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, params, url }) => {
  const client = createApiClient(fetch);
  const cost = await orFail(
    client.call(endpoints.costsGet, { params: { id: params.id } }),
    url.pathname,
  );
  const [context, financeConnected] = await Promise.all([
    loadCostContext(client, url.pathname, { keepAssetId: cost.assetId }),
    tryLoadFinanceConnected(client, url.pathname),
  ]);
  return { cost, financeConnected, ...context };
};
