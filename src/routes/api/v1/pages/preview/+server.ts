import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { preview } from "$lib/server/api/handlers/pages";

export const POST = bind(endpoints.pagesPreview, preview);
