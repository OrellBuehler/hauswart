import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { groups } from "$lib/server/api/handlers/integrations";

export const GET = bind(endpoints.integrationsGroups, groups);
