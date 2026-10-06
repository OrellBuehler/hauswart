import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { listAll } from "$lib/server/api/handlers/serviceLog";

export const GET = bind(endpoints.serviceLogList, listAll);
