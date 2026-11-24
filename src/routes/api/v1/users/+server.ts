import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { create, list } from "#lib/server/api/handlers/users.ts";

export const GET = bind(endpoints.usersList, list);
export const POST = bind(endpoints.usersCreate, create);
