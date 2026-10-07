import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { importAreas } from "$lib/server/api/handlers/rooms";

export const POST = bind(endpoints.roomsImportAreas, importAreas);
