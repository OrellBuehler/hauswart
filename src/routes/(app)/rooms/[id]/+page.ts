import { createApiClient } from "$lib/api/client";
import { fetchAll } from "$lib/api/fetch-all";
import { loadHousehold } from "$lib/api/household";
import { orFail } from "$lib/api/load";
import { endpoints } from "$lib/api/registry";
import { taskRoomId } from "$lib/assets/tasks";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, params, url }) => {
  const api = createApiClient(fetch);
  const [room, assets, allAssets, tasks, { today }, pages] = await orFail(
    Promise.all([
      api.call(endpoints.roomsGet, { params: { id: params.id } }),
      fetchAll((cursor) =>
        api.call(endpoints.assetsList, {
          query: { cursor, limit: 200, roomId: params.id },
        }),
      ),
      fetchAll((cursor) =>
        api.call(endpoints.assetsList, { query: { cursor, limit: 200 } }),
      ),
      fetchAll((cursor) =>
        api.call(endpoints.tasksList, { query: { cursor, limit: 200 } }),
      ),
      loadHousehold(api),
      fetchAll((cursor) =>
        api.call(endpoints.pagesList, {
          query: { cursor, limit: 200, roomId: params.id },
        }),
      ),
    ]),
    url.pathname,
  );
  const assetRooms = new Map(allAssets.map((a) => [a.id, a.roomId]));
  return {
    room,
    assets,
    today,
    pages,
    tasks: tasks.filter((task) => taskRoomId(task, assetRooms) === room.id),
  };
};
