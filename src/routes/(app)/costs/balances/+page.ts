import { browser } from "$app/environment";
import { redirect } from "@sveltejs/kit";
import { createApiClient } from "$lib/api/client";
import { fetchAll } from "$lib/api/fetch-all";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { loadRememberedBook } from "$lib/costs/book-memory";
import { chooseBook, parseBookParam } from "$lib/costs/books";
import {
  balancesQuery,
  loadCostBooks,
  loadHouseholdToday,
} from "$lib/costs/load";
import {
  parseSettlementFilters,
  settlementFilterQuery,
  settlementsQuery,
} from "$lib/costs/settlements";
import { loadDirectory } from "$lib/tasks/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url, parent }) => {
  const client = createApiClient(fetch);
  const redirectTo = url.pathname + url.search;
  const { user } = await parent();
  const [{ household, today }, books, people] = await Promise.all([
    loadHouseholdToday(client, redirectTo),
    loadCostBooks(client, redirectTo),
    loadDirectory(client, redirectTo),
  ]);

  const param = parseBookParam(url.searchParams.get("book"));
  const choice = chooseBook({
    param,
    remembered: browser ? loadRememberedBook(user.id) : null,
    books,
    narrowed: false,
  });
  const parsed = parseSettlementFilters(url.searchParams);
  const filters = {
    ...parsed,
    bookId: choice.bookId,
    person: parsed.person === "me" ? user.id : parsed.person,
  };
  if (choice.fromMemory) {
    // The book the person looked at last becomes the address, so the page can be shared and Back leads here.
    redirect(307, `${url.pathname}${settlementFilterQuery(filters)}`);
  }

  const [balances, settlements, latest] = await Promise.all([
    orFail(
      client.call(endpoints.costsBalances, {
        query: balancesQuery(filters.bookId),
      }),
      redirectTo,
    ),
    orFail(
      fetchAll((cursor) =>
        client.call(endpoints.settlementsList, {
          query: settlementsQuery(filters, cursor),
        }),
      ),
      redirectTo,
    ),
    // Whether anything was ever recorded, whatever the list is narrowed to.
    orFail(
      client.call(endpoints.settlementsList, { query: { limit: 1 } }),
      redirectTo,
    ),
  ]);
  return {
    books,
    people,
    currency: household.currency,
    today,
    filters,
    bookExplicit: param !== null,
    balances,
    settlements,
    anySettlement: latest.items.length > 0,
  };
};
