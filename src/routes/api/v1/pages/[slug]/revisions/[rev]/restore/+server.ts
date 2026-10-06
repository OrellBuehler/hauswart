import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { restore } from "$lib/server/api/handlers/pages";

export const POST = bind(endpoints.pageRevisionsRestore, restore);
