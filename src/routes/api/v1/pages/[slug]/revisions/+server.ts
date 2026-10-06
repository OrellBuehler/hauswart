import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { revisions } from "$lib/server/api/handlers/pages";

export const GET = bind(endpoints.pageRevisionsList, revisions);
