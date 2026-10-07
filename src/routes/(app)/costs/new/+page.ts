import { createApiClient } from "$lib/api/client";
import { loadCostContext } from "$lib/costs/load";
import type { PageLoad } from "./$types";

/** A prefill from the address only counts when it names something that exists. */
function known(id: string | null, items: { id: string }[]): string | undefined {
  return id !== null && items.some((item) => item.id === id) ? id : undefined;
}

export const load: PageLoad = async ({ fetch, url }) => {
  const context = await loadCostContext(createApiClient(fetch), url.pathname);
  return {
    ...context,
    defaults: {
      assetId: known(url.searchParams.get("asset"), context.assets),
      roomId: known(url.searchParams.get("room"), context.rooms),
      defectId: known(url.searchParams.get("defect"), context.defects),
    },
  };
};
