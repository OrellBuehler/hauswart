import { createApiClient } from "$lib/api/client";
import { ASSET_KINDS } from "$lib/api/enums";
import { fetchAll } from "$lib/api/fetch-all";
import { loadHousehold } from "$lib/api/household";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
  const api = createApiClient(fetch);
  const [rooms, { today }] = await orFail(
    Promise.all([
      fetchAll((cursor) =>
        api.call(endpoints.roomsList, { query: { cursor, limit: 200 } }),
      ),
      loadHousehold(api),
    ]),
    url.pathname + url.search,
  );
  const kind = ASSET_KINDS.find((k) => k === url.searchParams.get("kind"));
  const roomId = url.searchParams.get("roomId");
  return {
    rooms: rooms.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    ),
    today,
    kind: kind ?? "device",
    roomId: rooms.some((room) => room.id === roomId) ? roomId : null,
  };
};
