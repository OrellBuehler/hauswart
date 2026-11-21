import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { toDefect } from "#lib/server/api/handlers/assetNotes.ts";

export const POST = bind(endpoints.assetNotesToDefect, toDefect);
