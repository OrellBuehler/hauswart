import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { get, remove, update } from "#lib/server/api/handlers/serviceLog.ts";

export const GET = bind(endpoints.assetServiceLogGet, get);
export const PATCH = bind(endpoints.assetServiceLogUpdate, update);
export const DELETE = bind(endpoints.assetServiceLogDelete, remove);
