import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { remove, save } from "$lib/server/api/handlers/integrations";

export const PUT = bind(endpoints.integrationsSave, save);
export const DELETE = bind(endpoints.integrationsDelete, remove);
