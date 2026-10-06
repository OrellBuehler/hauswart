import type { endpoints } from "$lib/api/registry";
import { searchLinkedDocuments } from "$lib/server/documents/search";
import { search as runSearch } from "$lib/server/search/search";
import type { Handler } from "../bind";

export const search: Handler<typeof endpoints.search> = ({ ctx, query }) => {
  const { type, ...rest } = query;
  const items = type === "document" ? [] : runSearch(ctx, { ...rest, type });
  const documents =
    type === undefined || type === "document"
      ? searchLinkedDocuments(ctx, ctx.user.id, query.q, query.limit).map(
          (hit) => ({
            type: "document" as const,
            id: hit.id,
            title: hit.title,
            snippet: hit.snippet,
            url: hit.url,
          }),
        )
      : [];
  return { items: [...items, ...documents] };
};
