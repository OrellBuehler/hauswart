import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { revoke } from "#lib/server/api/handlers/tokens.ts";

export const DELETE = bind(endpoints.tokensRevoke, revoke);
