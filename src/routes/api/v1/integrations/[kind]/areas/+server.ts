import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { areas } from "$lib/server/api/handlers/integrations";

export const GET = bind(endpoints.integrationsAreas, areas);
