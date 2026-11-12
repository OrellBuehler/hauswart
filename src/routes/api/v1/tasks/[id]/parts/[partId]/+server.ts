import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import {
  unlinkFromTask,
  updateOnTask,
} from "#lib/server/api/handlers/parts.ts";

export const PATCH = bind(endpoints.taskPartsUpdate, updateOnTask);
export const DELETE = bind(endpoints.taskPartsUnlink, unlinkFromTask);
