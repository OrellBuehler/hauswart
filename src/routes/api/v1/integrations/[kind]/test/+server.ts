import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { test } from "#lib/server/api/handlers/integrations.ts";

export const POST = bind(endpoints.integrationsTest, test);
