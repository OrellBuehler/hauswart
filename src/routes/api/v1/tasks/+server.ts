import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { create, list } from "#lib/server/api/handlers/tasks.ts";

export const GET = bind(endpoints.tasksList, list);
export const POST = bind(endpoints.tasksCreate, create);
