import { createApiClient } from "$lib/api/client";
import { loadCostBooks, loadHouseholdToday } from "$lib/costs/load";
import { loadDirectory, loadPlaces } from "$lib/tasks/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url, untrack }) => {
  const client = createApiClient(fetch);
  // The mode and book in the address are read by the page; they must not load everything again.
  const redirectTo = untrack(() => url.pathname + url.search);
  // The recent categories that order the chips are fetched by the form itself, so the page does not wait for them.
  const [{ household, today }, books, people, places] = await Promise.all([
    loadHouseholdToday(client, redirectTo),
    loadCostBooks(client, redirectTo),
    loadDirectory(client, redirectTo),
    loadPlaces(client, redirectTo),
  ]);
  return {
    books,
    people,
    assets: places.assets.filter((asset) => !asset.archivedAt),
    currency: household.currency,
    today,
  };
};
