import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { addCorrespondence } from "$lib/server/api/handlers/defects";

export const POST = bind(endpoints.defectsAddEvent, addCorrespondence);
