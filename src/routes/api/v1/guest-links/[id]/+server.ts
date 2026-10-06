import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { revoke, update } from "$lib/server/api/handlers/guestLinks";

export const PATCH = bind(endpoints.guestLinksUpdate, update);
export const DELETE = bind(endpoints.guestLinksRevoke, revoke);
