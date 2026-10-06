import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { list, upload } from "$lib/server/api/handlers/attachments";

export const GET = bind(endpoints.attachmentsList, list);
export const POST = bind(endpoints.attachmentsUpload, upload);
