import { createApiClient } from "#lib/api/client.ts";
import { fetchAll } from "#lib/api/fetch-all.ts";
import { orFail } from "#lib/api/load.ts";
import { endpoints } from "#lib/api/registry.ts";
import {
  RECEIPTS_PAGE_SIZE,
  mergePendingFirst,
  parseReceiptView,
  receiptViewStatus,
} from "#lib/costs/receipts.ts";
import { loadHousehold } from "#lib/tasks/load.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const client = createApiClient(fetch);
  const redirectTo = url.pathname + url.search;
  const view = parseReceiptView(url.searchParams);
  const status = receiptViewStatus(view);

  // Whatever still waits is read completely, so it is never hidden behind finished tasks.
  const [household, pending, history] = await Promise.all([
    loadHousehold(client, redirectTo),
    orFail(
      fetchAll((cursor) =>
        client.call(endpoints.aiTasksList, {
          query: {
            status: "pending",
            limit: 100,
            ...(cursor ? { cursor } : {}),
          },
        }),
      ),
      redirectTo,
    ),
    view === "pending"
      ? Promise.resolve(null)
      : orFail(
          client.call(endpoints.aiTasksList, {
            query: { limit: RECEIPTS_PAGE_SIZE, ...(status ? { status } : {}) },
          }),
          redirectTo,
        ),
  ]);

  return {
    timeZone: household.timeZone,
    view,
    pendingCount: pending.length,
    tasks:
      view === "pending"
        ? pending
        : view === "all"
          ? mergePendingFirst(pending, history?.items ?? [])
          : (history?.items ?? []),
    nextCursor: history?.nextCursor ?? null,
  };
};
