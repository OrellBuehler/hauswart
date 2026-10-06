import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { timeline } from "$lib/server/api/handlers/defects";

export const GET = bind(endpoints.defectsTimeline, timeline);
