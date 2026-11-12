import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { preview } from "#lib/server/api/handlers/pages.ts";

export const POST = bind(endpoints.pagesPreview, preview);
