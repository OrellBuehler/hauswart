import type { ApiClient } from "$lib/api/client";
import { fetchAll } from "$lib/api/fetch-all";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import type { Household } from "$lib/api/schemas/household";
import { todayIn } from "$lib/dates";
import { loadDirectory, loadPlaces } from "$lib/tasks/load";

/** The household and today's date in its zone. */
export async function loadHouseholdToday(
  client: ApiClient,
  redirectTo: string,
) {
  const household = await orFail(
    client.call(endpoints.householdGet),
    redirectTo,
  );
  return { household, today: todayIn(household.timezone, Date.now()) };
}

/** What the cost pages need around an entry: where it can belong, who can pay, today's date and currency. */
export async function loadCostContext(
  client: ApiClient,
  redirectTo: string,
  options: { household?: Household; keepAssetId?: string | null } = {},
) {
  const { keepAssetId } = options;
  const [places, defects, people, household] = await Promise.all([
    loadPlaces(client, redirectTo),
    orFail(
      fetchAll((cursor) =>
        client.call(endpoints.defectsList, {
          query: { limit: 200, ...(cursor ? { cursor } : {}) },
        }),
      ),
      redirectTo,
    ),
    loadDirectory(client, redirectTo),
    options.household ??
      orFail(client.call(endpoints.householdGet), redirectTo),
  ]);
  return {
    rooms: [...places.rooms].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    ),
    assets: places.assets.filter((a) => !a.archivedAt || a.id === keepAssetId),
    defects,
    people,
    currency: household.currency,
    timeZone: household.timezone,
    today: todayIn(household.timezone, Date.now()),
  };
}

/** Whether the person has a connected finance app: its adapter can list categories and accounts. */
export function hasFinanceConnection(
  integrations: ReadonlyArray<{
    available: boolean;
    configured: boolean;
    enabled: boolean;
    capabilities: string[];
  }>,
): boolean {
  return integrations.some(
    (i) =>
      i.available &&
      i.configured &&
      i.enabled &&
      i.capabilities.includes("categories"),
  );
}
