import { redirect } from "@sveltejs/kit";
import { createApiClient, type ApiClient } from "$lib/api/client";
import { isApiError } from "$lib/api/errors";
import { endpoints } from "$lib/api/registry";
import { loadCostBooks, loadHouseholdToday } from "$lib/costs/load";
import type { CategoryHistory } from "$lib/costs/quick";
import { loadDirectory, loadPlaces } from "$lib/tasks/load";
import type { PageLoad } from "./$types";

/** How many recent entries rank the category chips. */
const HISTORY_ENTRIES = 100;

/**
 * The recent entries only order the category chips, so a failure to read them leaves the fixed order instead of closing the
 * page; it is logged by code. A signed-out session still goes to the login page.
 */
async function loadHistory(
  client: ApiClient,
  redirectTo: string,
): Promise<CategoryHistory[]> {
  try {
    const page = await client.call(endpoints.costsList, {
      query: { limit: HISTORY_ENTRIES },
    });
    return page.items.map(({ bookId, category }) => ({ bookId, category }));
  } catch (err) {
    if (!isApiError(err)) throw err;
    if (err.status === 401) {
      redirect(303, `/login?redirectTo=${encodeURIComponent(redirectTo)}`);
    }
    console.warn("recent costs unavailable", err.code, err.status);
    return [];
  }
}

export const load: PageLoad = async ({ fetch, url, untrack }) => {
  const client = createApiClient(fetch);
  // The mode and book in the address are read by the page; they must not load everything again.
  const redirectTo = untrack(() => url.pathname + url.search);
  const [{ household, today }, books, people, places, history] =
    await Promise.all([
      loadHouseholdToday(client, redirectTo),
      loadCostBooks(client, redirectTo),
      loadDirectory(client, redirectTo),
      loadPlaces(client, redirectTo),
      loadHistory(client, redirectTo),
    ]);
  return {
    books,
    people,
    assets: places.assets.filter((asset) => !asset.archivedAt),
    currency: household.currency,
    today,
    history,
  };
};
