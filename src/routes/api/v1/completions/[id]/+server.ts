import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { undo } from "$lib/server/api/handlers/tasks";

export const DELETE = bind(endpoints.completionsUndo, undo);
