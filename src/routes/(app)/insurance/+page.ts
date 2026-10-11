import { createApiClient } from "$lib/api/client";
import { fetchAll } from "$lib/api/fetch-all";
import { loadHousehold } from "$lib/api/household";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const api = createApiClient(fetch);
  const list = (archived: boolean) =>
    fetchAll((cursor) =>
      api.call(endpoints.insurancePoliciesList, {
        query: {
          limit: 200,
          ...(archived ? { archived: "true" as const } : {}),
          ...(cursor ? { cursor } : {}),
        },
      }),
    );
  const [active, archived, { today, household }] = await orFail(
    Promise.all([list(false), list(true), loadHousehold(api)]),
    url.pathname,
  );
  return { active, archived, today, currency: household.currency };
};
