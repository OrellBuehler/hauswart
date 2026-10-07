import type { endpoints } from "$lib/api/registry";
import { importAreas as importAreasAsRooms } from "$lib/server/rooms/areas";
import {
  createRoom,
  deleteRoom,
  getRoom,
  listRooms,
  updateRoom,
} from "$lib/server/rooms/rooms";
import type { Handler } from "../bind";
import { wireRoom } from "../wire";

export const list: Handler<typeof endpoints.roomsList> = ({ ctx, query }) => {
  const page = listRooms(ctx, query);
  return { items: page.items.map(wireRoom), nextCursor: page.nextCursor };
};

export const create: Handler<typeof endpoints.roomsCreate> = ({ ctx, body }) =>
  wireRoom(createRoom(ctx, body));

export const get: Handler<typeof endpoints.roomsGet> = ({ ctx, params }) =>
  wireRoom(getRoom(ctx, params.id));

export const update: Handler<typeof endpoints.roomsUpdate> = ({
  ctx,
  params,
  body,
}) => wireRoom(updateRoom(ctx, params.id, body));

export const remove: Handler<typeof endpoints.roomsDelete> = ({
  ctx,
  params,
}) => {
  deleteRoom(ctx, params.id);
  return null;
};

export const importAreas: Handler<typeof endpoints.roomsImportAreas> = async ({
  ctx,
  body,
}) => ({
  items: (
    await importAreasAsRooms(ctx, body.kind, ctx.user.id, body.areaIds)
  ).map((item) => ({
    ...item,
    room: item.room ? wireRoom(item.room) : null,
  })),
});
