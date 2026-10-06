import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { status } from "$lib/server/api/handlers/defects";

export const POST = bind(endpoints.defectsStatus, status);
