import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { get, remove, update } from "$lib/server/api/handlers/serviceLog";

export const GET = bind(endpoints.assetServiceLogGet, get);
export const PATCH = bind(endpoints.assetServiceLogUpdate, update);
export const DELETE = bind(endpoints.assetServiceLogDelete, remove);
