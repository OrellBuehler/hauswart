import { createApiClient } from "#lib/api/client.ts";
import { ASSET_KINDS } from "#lib/api/enums.ts";
import { fetchAll } from "#lib/api/fetch-all.ts";
import { loadHousehold } from "#lib/api/household.ts";
import { orFail } from "#lib/api/load.ts";
import { endpoints } from "#lib/api/registry.ts";
import { loadCostBooks } from "#lib/costs/load.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const api = createApiClient(fetch);
  const [rooms, { today }, books] = await orFail(
    Promise.all([
      fetchAll((cursor) =>
        api.call(endpoints.roomsList, { query: { cursor, limit: 200 } }),
      ),
      loadHousehold(api),
      loadCostBooks(api, url.pathname + url.search),
    ]),
    url.pathname + url.search,
  );
  const kind = ASSET_KINDS.find((k) => k === url.searchParams.get("kind"));
  const roomId = url.searchParams.get("roomId");
  return {
    books,
    rooms: rooms.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    ),
    today,
    kind: kind ?? "device",
    roomId: rooms.some((room) => room.id === roomId) ? roomId : null,
  };
};
