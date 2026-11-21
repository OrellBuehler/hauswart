import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { create, list } from "#lib/server/api/handlers/assetNotes.ts";

export const GET = bind(endpoints.assetNotesList, list);
export const POST = bind(endpoints.assetNotesCreate, create);
