import { redirect } from "@sveltejs/kit";
import type { ApiClient } from "$lib/api/client";
import { isApiError } from "$lib/api/errors";
import { fetchAll } from "$lib/api/fetch-all";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import type { CostBook } from "$lib/api/schemas/cost-books";
import type { CostTag } from "$lib/api/schemas/cost-tags";
import type { CostBalances } from "$lib/api/schemas/costs";
import type { Household } from "$lib/api/schemas/household";
import { todayIn } from "$lib/dates";
import { budgetAlerts } from "./budgets";
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

/**
 * How many receipts wait in the queue, for a badge on the costs page: one count, not the tasks. When it cannot be read the
 * page still opens, without the badge (logged by code). A signed-out session still goes to the login page.
 */
export async function tryLoadPendingReceipts(
  client: ApiClient,
  redirectTo: string,
): Promise<number | null> {
  try {
    const { count } = await client.call(endpoints.aiTasksCount, {
      query: { status: "pending" },
    });
    return count;
  } catch (err) {
    if (!isApiError(err)) throw err;
    if (err.status === 401) {
      redirect(303, `/login?redirectTo=${encodeURIComponent(redirectTo)}`);
    }
    console.warn("pending receipts unavailable", err.code, err.status);
    return null;
  }
}

/**
 * How many budgets are nearly used up or over their amount this month and year: one call, for a hint on the dashboard.
 * When it cannot be read the dashboard opens without the hint (logged by code). A signed-out session still goes to the
 * login page.
 */
export async function tryLoadBudgetAlerts(
  client: ApiClient,
  redirectTo: string,
): Promise<{ exceeded: number; warning: number } | null> {
  try {
    const status = await client.call(endpoints.costBudgetsStatus, {
      query: {},
    });
    return budgetAlerts(status.items);
  } catch (err) {
    if (!isApiError(err)) throw err;
    if (err.status === 401) {
      redirect(303, `/login?redirectTo=${encodeURIComponent(redirectTo)}`);
    }
    console.warn("budget status unavailable", err.code, err.status);
    return null;
  }
}

/**
 * Whether the person has a working finance connection, for a form that looks for bank transactions that fit the entry
 * being typed. It is only a convenience, so when the connections cannot be read the form opens without it (logged by
 * code). A signed-out session still goes to the login page.
 */
export async function tryLoadFinanceConnected(
  client: ApiClient,
  redirectTo: string,
): Promise<boolean> {
  try {
    const { items } = await client.call(endpoints.integrationsList);
    return hasFinanceConnection(items);
  } catch (err) {
    if (!isApiError(err)) throw err;
    if (err.status === 401) {
      redirect(303, `/login?redirectTo=${encodeURIComponent(redirectTo)}`);
    }
    console.warn("finance connection unavailable", err.code, err.status);
    return false;
  }
}

/** Every cost tag of the household, by name, with how many entries carry it. */
export async function loadCostTags(client: ApiClient, redirectTo: string) {
  const { items } = await orFail(
    client.call(endpoints.costTagsList),
    redirectTo,
  );
  return items;
}

/** What the cost pages need around an entry: where it can belong, who can pay, today's date and currency. */
export async function loadCostContext(
  client: ApiClient,
  redirectTo: string,
  options: {
    household?: Household;
    /** The cost books, when the page has read them already. */
    books?: CostBook[];
    /** The cost tags, when the page has read them already. */
    tags?: CostTag[];
    keepAssetId?: string | null;
  } = {},
) {
  const { keepAssetId } = options;
  const [places, defects, people, household, books, tags] = await Promise.all([
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
    options.tags ?? loadCostTags(client, redirectTo),
  ]);
  return {
    rooms: [...places.rooms].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    ),
    assets: places.assets.filter((a) => !a.archivedAt || a.id === keepAssetId),
    defects,
    people,
    books,
    tags,
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
