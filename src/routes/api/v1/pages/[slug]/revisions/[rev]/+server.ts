import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { revision } from "$lib/server/api/handlers/pages";

export const GET = bind(endpoints.pageRevisionsGet, revision);
