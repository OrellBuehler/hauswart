import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, list } from "$lib/server/api/handlers/contacts";

export const GET = bind(endpoints.contactsList, list);
export const POST = bind(endpoints.contactsCreate, create);
