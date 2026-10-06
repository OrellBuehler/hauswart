import type { ApiClient } from "$lib/api/client";
import { fetchAll } from "$lib/api/fetch-all";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { todayIn } from "$lib/dates";
import { loadPlaces } from "$lib/tasks/load";

/** What the defect form needs: places, contacts and the household's handover settings. */
export async function loadDefectFormData(
  client: ApiClient,
  redirectTo: string,
  keepAssetId?: string | null,
) {
  const [places, contacts, household] = await Promise.all([
    loadPlaces(client, redirectTo),
    orFail(
      fetchAll((cursor) =>
        client.call(endpoints.contactsList, {
          query: { limit: 200, ...(cursor ? { cursor } : {}) },
        }),
      ),
      redirectTo,
    ),
    orFail(client.call(endpoints.householdGet), redirectTo),
  ]);
  return {
    rooms: [...places.rooms].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    ),
    assets: places.assets.filter((a) => !a.archivedAt || a.id === keepAssetId),
    contacts,
    handoverDate: household.handoverDate,
    deadlineMonths: household.settings.defectDeadlineMonths,
    today: todayIn(household.timezone, Date.now()),
  };
}
