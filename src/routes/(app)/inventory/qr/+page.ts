import { createApiClient } from "$lib/api/client";
import { fetchAll } from "$lib/api/fetch-all";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const api = createApiClient(fetch);
  const assets = await orFail(
    fetchAll((cursor) =>
      api.call(endpoints.assetsList, { query: { cursor, limit: 200 } }),
    ),
    url.pathname,
  );
  return {
    assets: assets.sort((a, b) => {
      if (!a.roomName !== !b.roomName) return a.roomName ? -1 : 1;
      return (
        (a.roomName ?? "").localeCompare(b.roomName ?? "") ||
        a.name.localeCompare(b.name)
      );
    }),
  };
};
