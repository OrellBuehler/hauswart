import { createApiClient } from "$lib/api/client";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { loadDefectFormData } from "$lib/defects/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, params, url }) => {
  const client = createApiClient(fetch);
  const defect = await orFail(
    client.call(endpoints.defectsGet, { params: { id: params.id } }),
    url.pathname,
  );
  const form = await loadDefectFormData(client, url.pathname, defect.assetId);
  return { defect, ...form };
};
