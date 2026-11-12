import { createApiClient } from "#lib/api/client.ts";
import { loadDefectFormData } from "#lib/defects/load.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const form = await loadDefectFormData(createApiClient(fetch), url.pathname);
  return {
    ...form,
    defaults: {
      assetId: url.searchParams.get("asset") ?? undefined,
      roomId: url.searchParams.get("room") ?? undefined,
    },
  };
};
