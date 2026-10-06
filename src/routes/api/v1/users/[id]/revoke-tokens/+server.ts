import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { revokeTokens } from "$lib/server/api/handlers/users";

export const POST = bind(endpoints.usersRevokeTokens, revokeTokens);
