import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { notifyServices } from "#lib/server/api/handlers/integrations.ts";

export const GET = bind(endpoints.integrationsNotifyServices, notifyServices);
