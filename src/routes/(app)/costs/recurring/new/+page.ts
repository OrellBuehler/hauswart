import { createApiClient } from "#lib/api/client.ts";
import { loadCostContext } from "#lib/costs/load.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const context = await loadCostContext(createApiClient(fetch), url.pathname);
  const book = url.searchParams.get("book");
  return {
    ...context,
    defaults: {
      bookId: context.books.some((b) => b.id === book)
        ? (book ?? undefined)
        : undefined,
    },
  };
};
