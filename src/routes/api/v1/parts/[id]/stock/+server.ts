import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { stock } from "$lib/server/api/handlers/parts";

export const POST = bind(endpoints.partsStock, stock);
