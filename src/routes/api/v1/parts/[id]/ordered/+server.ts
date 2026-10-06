import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { ordered } from "$lib/server/api/handlers/parts";

export const POST = bind(endpoints.partsOrdered, ordered);
