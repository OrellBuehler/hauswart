import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { remove, save } from "#lib/server/api/handlers/integrations.ts";

export const PUT = bind(endpoints.integrationsSave, save);
export const DELETE = bind(endpoints.integrationsDelete, remove);
