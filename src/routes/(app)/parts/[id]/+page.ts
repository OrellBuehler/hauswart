import { createApiClient } from "$lib/api/client";
import { loadHousehold } from "$lib/api/household";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { PART_MOVEMENTS_IN_DETAIL } from "$lib/api/schemas/parts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, params, url }) => {
  const api = createApiClient(fetch);
  const [part, movements, { household }] = await orFail(
    Promise.all([
      api.call(endpoints.partsGet, { params: { id: params.id } }),
      api.call(endpoints.partsMovements, {
        params: { id: params.id },
        query: { limit: PART_MOVEMENTS_IN_DETAIL },
      }),
      loadHousehold(api),
    ]),
    url.pathname,
  );
  return { part, movements, currency: household.currency };
};
