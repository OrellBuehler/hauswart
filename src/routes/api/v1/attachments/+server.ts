import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { list, upload } from "#lib/server/api/handlers/attachments.ts";

export const GET = bind(endpoints.attachmentsList, list);
export const POST = bind(endpoints.attachmentsUpload, upload);
