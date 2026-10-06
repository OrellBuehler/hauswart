import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { linksDelete } from "$lib/server/api/handlers/documents";

export const DELETE = bind(endpoints.documentLinksDelete, linksDelete);
