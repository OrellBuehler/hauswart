import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { addCorrespondence } from "#lib/server/api/handlers/defects.ts";

export const POST = bind(endpoints.defectsAddEvent, addCorrespondence);
