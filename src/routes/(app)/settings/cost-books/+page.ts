import { createApiClient } from "$lib/api/client";
import { loadCostBooks } from "$lib/costs/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => ({
  books: await loadCostBooks(createApiClient(fetch), url.pathname),
});
