import { createApiClient, type ApiClient } from "$lib/api/client";
import { fetchAll } from "$lib/api/fetch-all";
import { loadHousehold } from "$lib/api/household";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { sortTasks } from "$lib/assets/tasks";
import { loadCostBooks } from "$lib/costs/load";
import { loadDirectory } from "$lib/tasks/load";
import type { PageLoad } from "./$types";

async function loadVehicleExtras(
  api: ApiClient,
  id: string,
  today: string,
  redirectTo: string,
) {
  const year = Number(today.slice(0, 4));
  const [
    details,
    readings,
    tireSets,
    fuelLogs,
    stats,
    yearStats,
    people,
    books,
  ] = await Promise.all([
    api.call(endpoints.vehiclesGet, { params: { id } }),
    api.call(endpoints.odometerList, {
      params: { id },
      query: { limit: 20 },
    }),
    fetchAll((cursor) =>
      api.call(endpoints.tireSetsList, {
        params: { id },
        query: { cursor, limit: 200, includeRetired: "true" },
      }),
    ),
    api.call(endpoints.fuelLogsList, {
      params: { id },
      query: { limit: 20 },
    }),
    api.call(endpoints.vehicleStats, { params: { id }, query: {} }),
    api.call(endpoints.vehicleStats, { params: { id }, query: { year } }),
    loadDirectory(api, redirectTo),
    loadCostBooks(api, redirectTo),
  ]);
  return {
    details,
    readings,
    tireSets,
    fuelLogs,
    stats,
    year,
    yearStats,
    people,
    books,
  };
}

/** Care hints, contacts, spare parts, the service log, the insurance policies, the open notes and the planned appointments of an asset. */
async function loadAssetExtras(api: ApiClient, id: string) {
  const [hints, contacts, parts, serviceLog, insurance, notes, appointments] =
    await Promise.all([
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
      fetchAll((cursor) =>
        api.call(endpoints.assetNotesList, {
          params: { id },
          query: { status: "open", cursor, limit: 200 },
        }),
      ),
      fetchAll((cursor) =>
        api.call(endpoints.appointmentsList, {
          query: {
            assetId: id,
            status: "planned",
            limit: 200,
            ...(cursor ? { cursor } : {}),
          },
        }),
      ),
    ]);
  return { hints, contacts, parts, serviceLog, insurance, notes, appointments };
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
  const vehicle =
    asset.kind === "vehicle"
      ? await orFail(
          loadVehicleExtras(api, params.id, today, url.pathname),
          url.pathname,
        )
      : null;
  return {
    asset,
    vehicle,
    tasks: sortTasks(tasks),
    today,
    timeZone: household.timezone,
    currency: household.currency,
    pages,
    ...m3,
  };
};
