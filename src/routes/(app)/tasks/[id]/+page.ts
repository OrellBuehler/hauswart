import { createApiClient } from "$lib/api/client";
import { fetchAll } from "$lib/api/fetch-all";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { loadDirectory, loadHousehold } from "$lib/tasks/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, params, url }) => {
  const client = createApiClient(fetch);
  const [task, history, household, people, parts] = await Promise.all([
    orFail(
      client.call(endpoints.tasksGet, { params: { id: params.id } }),
      url.pathname,
    ),
    orFail(
      client.call(endpoints.completionsList, {
        query: { taskId: params.id, limit: 20 },
      }),
      url.pathname,
    ),
    loadHousehold(client, url.pathname),
    loadDirectory(client, url.pathname),
    orFail(
      fetchAll((cursor) =>
        client.call(endpoints.taskPartsList, {
          params: { id: params.id },
          query: { cursor, limit: 200 },
        }),
      ),
      url.pathname,
    ),
  ]);
  const asset = task.assetId
    ? await orFail(
        client.call(endpoints.assetsGet, { params: { id: task.assetId } }),
        url.pathname,
      )
    : null;
  return { task, history, asset, ...household, people, parts };
};
