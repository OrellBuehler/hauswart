import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { uploadsGet } from "$lib/server/api/handlers/documents";

export const GET = bind(endpoints.documentUploadsGet, uploadsGet);
