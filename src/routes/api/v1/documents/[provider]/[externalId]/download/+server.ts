import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { download } from "#lib/server/api/handlers/documents.ts";

export const GET = bind(endpoints.documentsDownload, download);
