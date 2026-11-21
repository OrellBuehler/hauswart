import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { revokeTokens } from "#lib/server/api/handlers/users.ts";

export const POST = bind(endpoints.usersRevokeTokens, revokeTokens);
