import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { me, updateMe } from "#lib/server/api/handlers/auth.ts";

export const GET = bind(endpoints.authMe, me);
export const PATCH = bind(endpoints.authUpdateMe, updateMe);
