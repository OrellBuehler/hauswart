import { createApiClient } from "#lib/api/client.ts";
import { orFail } from "#lib/api/load.ts";
import { endpoints } from "#lib/api/registry.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const onlyUnread = url.searchParams.get("unread") === "1";
  const page = await orFail(
    createApiClient(fetch).call(endpoints.notificationsList, {
      query: { limit: 30, ...(onlyUnread ? { unread: "true" as const } : {}) },
    }),
    url.pathname + url.search,
  );
  return { onlyUnread, items: page.items, nextCursor: page.nextCursor };
};
