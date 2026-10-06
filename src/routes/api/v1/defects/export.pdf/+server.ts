import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { exportPdf } from "$lib/server/api/handlers/defects";

export const GET = bind(endpoints.defectsExport, exportPdf);
