import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { revoke, update } from "#lib/server/api/handlers/guestLinks.ts";

export const PATCH = bind(endpoints.guestLinksUpdate, update);
export const DELETE = bind(endpoints.guestLinksRevoke, revoke);
