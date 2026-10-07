import { createApiClient } from "$lib/api/client";
import { fetchAll } from "$lib/api/fetch-all";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { costsQuery, parseCostFilters } from "$lib/costs/filters";
import {
  hasFinanceConnection,
  loadCostContext,
  loadHouseholdToday,
} from "$lib/costs/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const client = createApiClient(fetch);
  const redirectTo = url.pathname + url.search;
  const { household, today } = await loadHouseholdToday(client, redirectTo);
  const defaultYear = Number(today.slice(0, 4));
  const filters = parseCostFilters(url.searchParams, defaultYear);
  const [context, costs, summary, suggestions, integrations] =
    await Promise.all([
      loadCostContext(client, redirectTo, { household }),
      orFail(
        fetchAll((cursor) =>
          client.call(endpoints.costsList, {
            query: costsQuery(filters, cursor),
          }),
        ),
        redirectTo,
      ),
      orFail(
        client.call(endpoints.costsSummary, { query: { year: filters.year } }),
        redirectTo,
      ),
      orFail(
        client.call(endpoints.financeSuggestionsList, {
          query: { limit: 200 },
        }),
        redirectTo,
      ),
      orFail(client.call(endpoints.integrationsList), redirectTo),
    ]);
  return {
    ...context,
    filters,
    defaultYear,
    costs,
    summary,
    pendingSuggestions: suggestions.items.length,
    morePendingSuggestions: suggestions.nextCursor !== null,
    financeConnected: hasFinanceConnection(integrations.items),
  };
};
