import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { preview } from "$lib/server/api/handlers/attachments";

export const GET = bind(endpoints.attachmentsPreview, preview);
