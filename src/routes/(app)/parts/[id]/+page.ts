import { createApiClient } from "#lib/api/client.ts";
import { loadHousehold } from "#lib/api/household.ts";
import { orFail } from "#lib/api/load.ts";
import { endpoints } from "#lib/api/registry.ts";
import { PART_MOVEMENTS_IN_DETAIL } from "#lib/api/schemas/parts.ts";
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
