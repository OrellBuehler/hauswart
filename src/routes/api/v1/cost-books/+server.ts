import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, list } from "$lib/server/api/handlers/cost-books";

export const GET = bind(endpoints.costBooksList, list);
export const POST = bind(endpoints.costBooksCreate, create);
