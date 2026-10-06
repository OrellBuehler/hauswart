import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { entities } from "$lib/server/api/handlers/integrations";

export const GET = bind(endpoints.integrationsEntities, entities);
