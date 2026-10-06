import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { correspondents } from "$lib/server/api/handlers/integrations";

export const GET = bind(endpoints.integrationsCorrespondents, correspondents);
