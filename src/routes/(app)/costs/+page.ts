import { browser } from "$app/environment";
import { redirect } from "@sveltejs/kit";
import { createApiClient } from "$lib/api/client";
import { fetchAll } from "$lib/api/fetch-all";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { forgetBook, loadRememberedBook } from "$lib/costs/book-memory";
import { chooseBook, parseBookParam } from "$lib/costs/books";
import {
  costFilterQuery,
  costsQuery,
  costsSummaryQuery,
  narrowsBeyondBook,
  parseCostFilters,
  withKnownTag,
} from "$lib/costs/filters";
import {
  hasFinanceConnection,
  loadCostBooks,
  loadCostContext,
  loadCostTags,
  loadHouseholdToday,
  tryLoadBalances,
  tryLoadPendingReceipts,
} from "$lib/costs/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url, parent }) => {
  const client = createApiClient(fetch);
  const redirectTo = url.pathname + url.search;
  const { user } = await parent();
  const [{ household, today }, books, tags] = await Promise.all([
    loadHouseholdToday(client, redirectTo),
    loadCostBooks(client, redirectTo),
    loadCostTags(client, redirectTo),
  ]);
  const defaultYear = Number(today.slice(0, 4));

  const param = parseBookParam(url.searchParams.get("book"));
  const choice = chooseBook({
    param,
    remembered: browser ? loadRememberedBook(user.id) : null,
    books,
    narrowed: narrowsBeyondBook(url.searchParams),
  });
  if (browser && choice.staleMemory) forgetBook(user.id);
  // A tag that was deleted since the link was made would be a 404 on every call below: it is left out.
  const filters = withKnownTag(
    {
      ...parseCostFilters(url.searchParams, defaultYear),
      bookId: choice.bookId,
    },
    tags,
  );
  if (choice.fromMemory) {
    // The book the person looked at last becomes the address, so the page can be shared and Back leads here.
    redirect(307, `${url.pathname}${costFilterQuery(filters, defaultYear)}`);
  }

  const [
    context,
    costs,
    summary,
    balances,
    suggestions,
    integrations,
    pendingReceipts,
  ] = await Promise.all([
    loadCostContext(client, redirectTo, { household, books, tags }),
    orFail(
      fetchAll((cursor) =>
        client.call(endpoints.costsList, {
          query: costsQuery(filters, cursor),
        }),
      ),
      redirectTo,
    ),
    orFail(
      client.call(endpoints.costsSummary, {
        query: costsSummaryQuery(filters),
      }),
      redirectTo,
    ),
    tryLoadBalances(client, filters.bookId, redirectTo),
    orFail(
      client.call(endpoints.financeSuggestionsList, {
        query: { limit: 200 },
      }),
      redirectTo,
    ),
    orFail(client.call(endpoints.integrationsList), redirectTo),
    tryLoadPendingReceipts(client, redirectTo),
  ]);
  return {
    ...context,
    filters,
    /** The address names a book (or every book), so the choice can be remembered. */
    bookExplicit: param !== null,
    defaultYear,
    costs,
    summary,
    balances,
    pendingSuggestions: suggestions.items.length,
    morePendingSuggestions: suggestions.nextCursor !== null,
    financeConnected: hasFinanceConnection(integrations.items),
    pendingReceipts,
  };
};
