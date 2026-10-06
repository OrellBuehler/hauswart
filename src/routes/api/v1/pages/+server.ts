import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, list } from "$lib/server/api/handlers/pages";

export const GET = bind(endpoints.pagesList, list);
export const POST = bind(endpoints.pagesCreate, create);
