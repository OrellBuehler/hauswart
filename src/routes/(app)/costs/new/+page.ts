import { createApiClient } from "$lib/api/client";
import { loadCostContext, tryLoadFinanceConnected } from "$lib/costs/load";
import type { PageLoad } from "./$types";

/** A prefill from the address only counts when it names something that exists. */
function known(id: string | null, items: { id: string }[]): string | undefined {
  return id !== null && items.some((item) => item.id === id) ? id : undefined;
}

export const load: PageLoad = async ({ fetch, url }) => {
  const client = createApiClient(fetch);
  const [context, financeConnected] = await Promise.all([
    loadCostContext(client, url.pathname),
    tryLoadFinanceConnected(client, url.pathname),
  ]);
  return {
    ...context,
    financeConnected,
    defaults: {
      bookId: known(url.searchParams.get("book"), context.books),
      assetId: known(url.searchParams.get("asset"), context.assets),
      roomId: known(url.searchParams.get("room"), context.rooms),
      defectId: known(url.searchParams.get("defect"), context.defects),
    },
  };
};
