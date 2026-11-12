import { createApiClient } from "#lib/api/client.ts";
import { fetchAll } from "#lib/api/fetch-all.ts";
import { loadHousehold } from "#lib/api/household.ts";
import { orFail } from "#lib/api/load.ts";
import { endpoints } from "#lib/api/registry.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, params, url }) => {
  const api = createApiClient(fetch);
  const [policy, assets, { today, household }] = await orFail(
    Promise.all([
      api.call(endpoints.insurancePoliciesGet, { params: { id: params.id } }),
      fetchAll((cursor) =>
        api.call(endpoints.assetsList, {
          query: {
            limit: 200,
            includeArchived: "true",
            ...(cursor ? { cursor } : {}),
          },
        }),
      ),
      loadHousehold(api),
    ]),
    url.pathname,
  );
  return { policy, assets, today, currency: household.currency };
};
