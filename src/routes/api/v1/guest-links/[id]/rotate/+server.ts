import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { rotate } from "#lib/server/api/handlers/guestLinks.ts";

export const POST = bind(endpoints.guestLinksRotate, rotate);
