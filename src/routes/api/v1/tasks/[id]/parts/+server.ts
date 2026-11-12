import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { linkToTask, listForTask } from "#lib/server/api/handlers/parts.ts";

export const GET = bind(endpoints.taskPartsList, listForTask);
export const POST = bind(endpoints.taskPartsLink, linkToTask);
