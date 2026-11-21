import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { create, list } from "#lib/server/api/handlers/rooms.ts";

export const GET = bind(endpoints.roomsList, list);
export const POST = bind(endpoints.roomsCreate, create);
