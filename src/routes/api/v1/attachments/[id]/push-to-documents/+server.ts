import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { pushToDocuments } from "$lib/server/api/handlers/documents";

export const POST = bind(endpoints.attachmentsPushToDocuments, pushToDocuments);
