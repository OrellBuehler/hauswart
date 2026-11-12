import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { fromUrl } from "$lib/server/api/handlers/attachments";

export const POST = bind(endpoints.attachmentsFromUrl, fromUrl);
