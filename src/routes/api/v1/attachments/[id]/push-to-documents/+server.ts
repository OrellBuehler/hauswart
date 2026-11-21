import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { pushToDocuments } from "#lib/server/api/handlers/documents.ts";

export const POST = bind(endpoints.attachmentsPushToDocuments, pushToDocuments);
