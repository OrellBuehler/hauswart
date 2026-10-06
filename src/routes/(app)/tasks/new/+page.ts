import { createApiClient } from "$lib/api/client";
import { loadDirectory, loadHousehold, loadPlaces } from "$lib/tasks/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const client = createApiClient(fetch);
  const [household, people, places] = await Promise.all([
    loadHousehold(client, url.pathname),
    loadDirectory(client, url.pathname),
    loadPlaces(client, url.pathname),
  ]);
  return {
    ...household,
    people,
    ...places,
    defaults: {
      assetId:
        url.searchParams.get("assetId") ??
        url.searchParams.get("asset") ??
        undefined,
      roomId: url.searchParams.get("room") ?? undefined,
      title: url.searchParams.get("title")?.slice(0, 200) || undefined,
      description:
        url.searchParams.get("description")?.slice(0, 10_000) || undefined,
    },
  };
};
