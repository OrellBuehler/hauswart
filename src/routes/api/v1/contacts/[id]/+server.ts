import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { get, remove, update } from "$lib/server/api/handlers/contacts";

export const GET = bind(endpoints.contactsGet, get);
export const PATCH = bind(endpoints.contactsUpdate, update);
export const DELETE = bind(endpoints.contactsDelete, remove);
