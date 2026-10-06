import { createApiClient } from "$lib/api/client";
import { fetchAll } from "$lib/api/fetch-all";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { docSectionSchema } from "$lib/api/schemas/docs";
import { loadPlaces } from "$lib/tasks/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const client = createApiClient(fetch);
  const params = url.searchParams;
  const q = params.get("q")?.trim().slice(0, 100) || undefined;
  const section = docSectionSchema.safeParse(params.get("section")).data;
  const assetId = params.get("assetId") || undefined;
  const roomId = params.get("roomId") || undefined;
  const archived = params.get("archived") === "1";

  const [pages, places] = await Promise.all([
    orFail(
      fetchAll((cursor) =>
        client.call(endpoints.pagesList, {
          query: {
            limit: 200,
            ...(cursor ? { cursor } : {}),
            ...(q ? { q } : {}),
            ...(section ? { section } : {}),
            ...(assetId ? { assetId } : {}),
            ...(roomId ? { roomId } : {}),
            ...(archived ? { includeArchived: "true" as const } : {}),
          },
        }),
      ),
      url.pathname + url.search,
    ),
    loadPlaces(client, url.pathname),
  ]);
  return {
    pages,
    filter: { q, section, assetId, roomId, archived },
    ...places,
  };
};
