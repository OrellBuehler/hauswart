import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { unlinkFromTask, updateOnTask } from "$lib/server/api/handlers/parts";

export const PATCH = bind(endpoints.taskPartsUpdate, updateOnTask);
export const DELETE = bind(endpoints.taskPartsUnlink, unlinkFromTask);
