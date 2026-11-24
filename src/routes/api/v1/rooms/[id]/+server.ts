import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { get, remove, update } from "#lib/server/api/handlers/rooms.ts";

export const GET = bind(endpoints.roomsGet, get);
export const PATCH = bind(endpoints.roomsUpdate, update);
export const DELETE = bind(endpoints.roomsDelete, remove);
