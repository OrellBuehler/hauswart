import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { preview } from "$lib/server/api/handlers/documents";

export const GET = bind(endpoints.documentsPreview, preview);
