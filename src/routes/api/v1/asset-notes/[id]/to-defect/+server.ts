import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { toDefect } from "$lib/server/api/handlers/assetNotes";

export const POST = bind(endpoints.assetNotesToDefect, toDefect);
