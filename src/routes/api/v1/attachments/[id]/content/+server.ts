import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { content } from "$lib/server/api/handlers/attachments";

export const GET = bind(endpoints.attachmentsContent, content);
