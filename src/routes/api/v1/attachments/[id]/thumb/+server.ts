import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { thumb } from "#lib/server/api/handlers/attachments.ts";

export const GET = bind(endpoints.attachmentsThumb, thumb);
