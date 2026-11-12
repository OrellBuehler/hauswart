import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { listAll } from "#lib/server/api/handlers/serviceLog.ts";

export const GET = bind(endpoints.serviceLogList, listAll);
