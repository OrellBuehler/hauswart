import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { linkToTask, listForTask } from "$lib/server/api/handlers/parts";

export const GET = bind(endpoints.taskPartsList, listForTask);
export const POST = bind(endpoints.taskPartsLink, linkToTask);
