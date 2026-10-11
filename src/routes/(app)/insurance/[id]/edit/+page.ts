import { createApiClient } from "$lib/api/client";
import { fetchAll } from "$lib/api/fetch-all";
import { loadHousehold } from "$lib/api/household";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
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
