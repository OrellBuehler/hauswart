import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { directory } from "$lib/server/api/handlers/users";

export const GET = bind(endpoints.usersDirectory, directory);
