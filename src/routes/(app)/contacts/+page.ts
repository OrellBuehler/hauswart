import { createApiClient } from "$lib/api/client";
import { fetchAll } from "$lib/api/fetch-all";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const api = createApiClient(fetch);
  const contacts = await orFail(
    fetchAll((cursor) =>
      api.call(endpoints.contactsList, { query: { cursor, limit: 200 } }),
    ),
    url.pathname,
  );
  return { contacts };
};
