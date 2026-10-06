import { createApiClient } from "$lib/api/client";
import { fetchAll } from "$lib/api/fetch-all";
import { loadHousehold } from "$lib/api/household";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
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
