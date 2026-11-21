import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { content } from "#lib/server/api/handlers/attachments.ts";

export const GET = bind(endpoints.attachmentsContent, content);
