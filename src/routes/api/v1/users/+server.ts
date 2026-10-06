import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, list } from "$lib/server/api/handlers/users";

export const GET = bind(endpoints.usersList, list);
export const POST = bind(endpoints.usersCreate, create);
