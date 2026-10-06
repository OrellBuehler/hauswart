import { createApiClient } from "$lib/api/client";
import { loadHousehold } from "$lib/api/household";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const api = createApiClient(fetch);
  const [{ items }, { household }] = await orFail(
    Promise.all([api.call(endpoints.integrationsList), loadHousehold(api)]),
    url.pathname,
  );
  return { integrations: items, timeZone: household.timezone };
};
