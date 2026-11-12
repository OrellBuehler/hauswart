import { createApiClient } from "#lib/api/client.ts";
import { fetchAll } from "#lib/api/fetch-all.ts";
import { loadHousehold } from "#lib/api/household.ts";
import { orFail } from "#lib/api/load.ts";
import { endpoints } from "#lib/api/registry.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const client = createApiClient(fetch);
  const [{ items }, pages, { household, today }] = await orFail(
    Promise.all([
      client.call(endpoints.guestLinksList),
      fetchAll((cursor) =>
        client.call(endpoints.pagesList, { query: { cursor, limit: 200 } }),
      ),
      loadHousehold(client),
    ]),
    url.pathname,
  );
  return { links: items, pages, today, timeZone: household.timezone as string };
};
