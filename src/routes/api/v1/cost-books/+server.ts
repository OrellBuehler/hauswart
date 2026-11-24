import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { create, list } from "#lib/server/api/handlers/cost-books.ts";

export const GET = bind(endpoints.costBooksList, list);
export const POST = bind(endpoints.costBooksCreate, create);
