import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { fromUrl } from "#lib/server/api/handlers/attachments.ts";

export const POST = bind(endpoints.attachmentsFromUrl, fromUrl);
