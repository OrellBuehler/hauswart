import { redirect } from "@sveltejs/kit";
import type { ApiClient } from "$lib/api/client";
import { isApiError } from "$lib/api/errors";
import { fetchAll } from "$lib/api/fetch-all";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import type { CostBook } from "$lib/api/schemas/cost-books";
import type { CostBalances } from "$lib/api/schemas/costs";
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

/** Every cost book, archived ones included (a page picks what it offers). */
export function loadCostBooks(client: ApiClient, redirectTo: string) {
  return orFail(
    fetchAll((cursor) =>
      client.call(endpoints.costBooksList, {
        query: {
          limit: 200,
          includeArchived: "true",
          ...(cursor ? { cursor } : {}),
        },
      }),
    ),
    redirectTo,
  );
}

/** The balances query of a book on screen (`""`: every book together). */
export function balancesQuery(bookId: string) {
  return bookId ? { bookId } : { all: "true" as const };
}

/**
 * The balances for a card that is only a part of its page: when they cannot be read the page still opens and the card
 * says so (`null`). A signed-out session still goes to the login page.
 */
export async function tryLoadBalances(
  client: ApiClient,
  bookId: string,
  redirectTo: string,
): Promise<CostBalances | null> {
  try {
    return await client.call(endpoints.costsBalances, {
      query: balancesQuery(bookId),
    });
  } catch (err) {
    if (!isApiError(err)) throw err;
    if (err.status === 401) {
      redirect(303, `/login?redirectTo=${encodeURIComponent(redirectTo)}`);
    }
    console.warn("balances unavailable", err.code, err.status);
    return null;
  }
}

/** What the cost pages need around an entry: where it can belong, who can pay, today's date and currency. */
export async function loadCostContext(
  client: ApiClient,
  redirectTo: string,
  options: {
    household?: Household;
    /** The cost books, when the page has read them already. */
    books?: CostBook[];
    keepAssetId?: string | null;
  } = {},
) {
  const { keepAssetId } = options;
  const [places, defects, people, household, books] = await Promise.all([
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
    options.books ?? loadCostBooks(client, redirectTo),
  ]);
  return {
    rooms: [...places.rooms].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    ),
    assets: places.assets.filter((a) => !a.archivedAt || a.id === keepAssetId),
    defects,
    people,
    books,
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
