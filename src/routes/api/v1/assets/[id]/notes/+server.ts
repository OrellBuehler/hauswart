import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, list } from "$lib/server/api/handlers/assetNotes";

export const GET = bind(endpoints.assetNotesList, list);
export const POST = bind(endpoints.assetNotesCreate, create);
