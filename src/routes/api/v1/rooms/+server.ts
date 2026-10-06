import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, list } from "$lib/server/api/handlers/rooms";

export const GET = bind(endpoints.roomsList, list);
export const POST = bind(endpoints.roomsCreate, create);
