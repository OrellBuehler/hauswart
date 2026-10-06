import { createApiClient } from "$lib/api/client";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import type { PageLoad } from "./$types";

const SEARCH_LIMIT = 50;

export const load: PageLoad = async ({ fetch, url }) => {
  const q = url.searchParams.get("q")?.trim().slice(0, 100) ?? "";
  if (!q) return { q, hits: [] };
  const result = await orFail(
    createApiClient(fetch).call(endpoints.search, {
      query: { q, limit: SEARCH_LIMIT },
    }),
    url.pathname + url.search,
  );
  return { q, hits: result.items };
};
