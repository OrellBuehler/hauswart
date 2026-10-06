import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { revoke } from "$lib/server/api/handlers/tokens";

export const DELETE = bind(endpoints.tokensRevoke, revoke);
