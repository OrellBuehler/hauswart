import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { undo } from "#lib/server/api/handlers/tasks.ts";

export const DELETE = bind(endpoints.completionsUndo, undo);
