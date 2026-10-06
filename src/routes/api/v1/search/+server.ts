import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { search } from "$lib/server/api/handlers/search";

export const GET = bind(endpoints.search, search);
