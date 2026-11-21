import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { importAreas } from "#lib/server/api/handlers/rooms.ts";

export const POST = bind(endpoints.roomsImportAreas, importAreas);
