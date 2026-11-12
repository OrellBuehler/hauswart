import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { exportCsv } from "#lib/server/api/handlers/costs.ts";

export const GET = bind(endpoints.costsExport, exportCsv);
