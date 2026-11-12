import { createApiClient } from "#lib/api/client.ts";
import { fetchAll } from "#lib/api/fetch-all.ts";
import { loadHousehold } from "#lib/api/household.ts";
import { orFail } from "#lib/api/load.ts";
import { endpoints } from "#lib/api/registry.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, params, url }) => {
  const client = createApiClient(fetch);
  const [defect, timeline, comments, household] = await orFail(
    Promise.all([
      client.call(endpoints.defectsGet, { params: { id: params.id } }),
      client.call(endpoints.defectsTimeline, { params: { id: params.id } }),
      fetchAll((cursor) =>
        client.call(endpoints.commentsList, {
          query: {
            entityType: "defect",
            entityId: params.id,
            limit: 200,
            ...(cursor ? { cursor } : {}),
          },
        }),
      ),
      loadHousehold(client),
    ]),
    url.pathname,
  );
  return {
    defect,
    timeline: timeline.items,
    comments,
    today: household.today,
    timeZone: household.household.timezone,
  };
};
