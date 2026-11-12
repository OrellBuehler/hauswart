import { createApiClient } from "#lib/api/client.ts";
import { fetchAll } from "#lib/api/fetch-all.ts";
import { loadHousehold } from "#lib/api/household.ts";
import { orFail } from "#lib/api/load.ts";
import { endpoints } from "#lib/api/registry.ts";
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
