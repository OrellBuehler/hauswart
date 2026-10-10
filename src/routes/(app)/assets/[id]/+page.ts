import { createApiClient, type ApiClient } from "$lib/api/client";
import { fetchAll } from "$lib/api/fetch-all";
import { loadHousehold } from "$lib/api/household";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { sortTasks } from "$lib/assets/tasks";
import type { PageLoad } from "./$types";

/** Care hints, contacts, spare parts, the service log and the insurance policies of an asset. */
async function loadAssetExtras(api: ApiClient, id: string) {
  const [hints, contacts, parts, serviceLog, insurance] = await Promise.all([
    fetchAll((cursor) =>
      api.call(endpoints.assetHintsList, {
        params: { id },
        query: { cursor, limit: 200 },
      }),
    ),
    fetchAll((cursor) =>
      api.call(endpoints.assetContactsList, {
        params: { id },
        query: { cursor, limit: 200 },
      }),
    ),
    fetchAll((cursor) =>
      api.call(endpoints.assetPartsList, {
        params: { id },
        query: { cursor, limit: 200 },
      }),
    ),
    api.call(endpoints.assetServiceLogList, {
      params: { id },
      query: { limit: 20 },
    }),
    fetchAll((cursor) =>
      api.call(endpoints.assetInsurancePoliciesList, {
        params: { id },
        query: { cursor, limit: 200 },
      }),
    ),
  ]);
  return { hints, contacts, parts, serviceLog, insurance };
}

export const load: PageLoad = async ({ fetch, params, url }) => {
  const api = createApiClient(fetch);
  const [asset, tasks, { today, household }, m3, pages] = await orFail(
    Promise.all([
      api.call(endpoints.assetsGet, { params: { id: params.id } }),
      fetchAll((cursor) =>
        api.call(endpoints.tasksList, {
          query: { cursor, limit: 200, assetId: params.id },
        }),
      ),
      loadHousehold(api),
      loadAssetExtras(api, params.id),
      fetchAll((cursor) =>
        api.call(endpoints.pagesList, {
          query: { cursor, limit: 200, assetId: params.id },
        }),
      ),
    ]),
    url.pathname,
  );
  return {
    asset,
    tasks: sortTasks(tasks),
    today,
    currency: household.currency,
    pages,
    ...m3,
  };
};
