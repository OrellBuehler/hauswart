import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { get } from "$lib/server/api/handlers/documents";

export const GET = bind(endpoints.documentsGet, get);
