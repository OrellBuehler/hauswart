import { createApiClient } from "$lib/api/client";
import { loadHousehold } from "$lib/api/household";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const client = createApiClient(fetch);
  const [{ items }, household, targets, integrations] = await orFail(
    Promise.all([
      client.call(endpoints.calendarFeedsList),
      loadHousehold(client),
      client.call(endpoints.calendarTargetsList),
      client.call(endpoints.integrationsList),
    ]),
    url.pathname,
  );
  return {
    feeds: items,
    targets: targets.items,
    integrations: integrations.items,
    timeZone: household.household.timezone as string | undefined,
  };
};
