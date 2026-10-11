import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { get, remove, update } from "$lib/server/api/handlers/cost-books";

export const GET = bind(endpoints.costBooksGet, get);
export const PATCH = bind(endpoints.costBooksUpdate, update);
export const DELETE = bind(endpoints.costBooksDelete, remove);
