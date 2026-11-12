import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { logout } from "#lib/server/api/handlers/auth.ts";

export const POST = bind(endpoints.authLogout, logout);
