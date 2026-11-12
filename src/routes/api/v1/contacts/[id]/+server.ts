import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { get, remove, update } from "#lib/server/api/handlers/contacts.ts";

export const GET = bind(endpoints.contactsGet, get);
export const PATCH = bind(endpoints.contactsUpdate, update);
export const DELETE = bind(endpoints.contactsDelete, remove);
