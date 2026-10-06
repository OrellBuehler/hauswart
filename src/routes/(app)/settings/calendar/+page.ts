import { createApiClient } from "$lib/api/client";
import { loadHousehold } from "$lib/api/household";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const client = createApiClient(fetch);
  const [{ items }, household] = await orFail(
    Promise.all([
      client.call(endpoints.calendarFeedsList),
      loadHousehold(client),
    ]),
    url.pathname,
  );
  return {
    feeds: items,
    timeZone: household.household.timezone as string | undefined,
  };
};
