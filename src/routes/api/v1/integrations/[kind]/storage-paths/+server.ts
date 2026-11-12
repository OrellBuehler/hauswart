import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { storagePaths } from "#lib/server/api/handlers/integrations.ts";

export const GET = bind(endpoints.integrationsStoragePaths, storagePaths);
