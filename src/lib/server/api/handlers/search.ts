import type { endpoints } from "$lib/api/registry";
import { search as runSearch } from "$lib/server/search/search";
import type { Handler } from "../bind";

export const search: Handler<typeof endpoints.search> = ({ ctx, query }) => ({
  items: runSearch(ctx, query),
});
