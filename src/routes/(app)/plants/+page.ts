import { createApiClient } from "$lib/api/client";
import { fetchAll } from "$lib/api/fetch-all";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const api = createApiClient(fetch);
  const [plants, tasks, hints] = await orFail(
    Promise.all([
      fetchAll((cursor) =>
        api.call(endpoints.assetsList, {
          query: { cursor, limit: 200, kind: "plant" },
        }),
      ),
      fetchAll((cursor) =>
        api.call(endpoints.tasksList, {
          query: { cursor, limit: 200, category: "plant" },
        }),
      ),
      fetchAll((cursor) =>
        api.call(endpoints.hintsList, { query: { cursor, limit: 200 } }),
      ),
    ]),
    url.pathname,
  );
  return { plants, tasks, hints };
};
