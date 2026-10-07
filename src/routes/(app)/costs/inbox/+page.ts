import { createApiClient } from "$lib/api/client";
import { fetchAll } from "$lib/api/fetch-all";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { hasFinanceConnection, loadCostContext } from "$lib/costs/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const client = createApiClient(fetch);
  const [context, suggestions, integrations] = await Promise.all([
    loadCostContext(client, url.pathname),
    orFail(
      fetchAll((cursor) =>
        client.call(endpoints.financeSuggestionsList, {
          query: {
            status: "pending",
            limit: 200,
            ...(cursor ? { cursor } : {}),
          },
        }),
      ),
      url.pathname,
    ),
    orFail(client.call(endpoints.integrationsList), url.pathname),
  ]);
  return {
    ...context,
    suggestions,
    financeConnected: hasFinanceConnection(integrations.items),
  };
};
