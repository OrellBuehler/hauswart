import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { exportPdf } from "#lib/server/api/handlers/emergency.ts";

export const GET = bind(endpoints.emergencyExport, exportPdf);
