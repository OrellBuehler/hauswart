import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { test } from "$lib/server/api/handlers/integrations";

export const POST = bind(endpoints.integrationsTest, test);
