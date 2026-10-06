import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { update } from "$lib/server/api/handlers/users";

export const PATCH = bind(endpoints.usersUpdate, update);
