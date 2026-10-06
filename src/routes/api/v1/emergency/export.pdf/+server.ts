import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { exportPdf } from "$lib/server/api/handlers/emergency";

export const GET = bind(endpoints.emergencyExport, exportPdf);
