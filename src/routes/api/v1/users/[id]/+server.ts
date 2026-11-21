import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { update } from "#lib/server/api/handlers/users.ts";

export const PATCH = bind(endpoints.usersUpdate, update);
