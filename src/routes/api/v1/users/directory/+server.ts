import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { directory } from "#lib/server/api/handlers/users.ts";

export const GET = bind(endpoints.usersDirectory, directory);
