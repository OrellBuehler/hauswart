import { createApiClient } from "#lib/api/client.ts";
import { fetchAll } from "#lib/api/fetch-all.ts";
import { orFail } from "#lib/api/load.ts";
import { endpoints } from "#lib/api/registry.ts";
import { docSectionSchema } from "#lib/api/schemas/docs.ts";
import { loadPlaces } from "#lib/tasks/load.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const client = createApiClient(fetch);
  const [places, pages] = await Promise.all([
    loadPlaces(client, url.pathname),
    orFail(
      fetchAll((cursor) =>
        client.call(endpoints.pagesList, {
          query: { limit: 200, ...(cursor ? { cursor } : {}) },
        }),
      ),
      url.pathname,
    ),
  ]);
  const params = url.searchParams;
  return {
    ...places,
    pages,
    defaults: {
      section: docSectionSchema.safeParse(params.get("section")).data,
      assetId: params.get("assetId") ?? undefined,
      roomId: params.get("roomId") ?? undefined,
      title: params.get("title")?.slice(0, 200) || undefined,
    },
  };
};
