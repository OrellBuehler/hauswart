import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { remove, update } from "$lib/server/api/handlers/assetNotes";

export const PATCH = bind(endpoints.assetNotesUpdate, update);
export const DELETE = bind(endpoints.assetNotesDelete, remove);
