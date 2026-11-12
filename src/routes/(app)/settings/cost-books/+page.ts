import { createApiClient } from "#lib/api/client.ts";
import { loadCostBooks } from "#lib/costs/load.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => ({
  books: await loadCostBooks(createApiClient(fetch), url.pathname),
});
