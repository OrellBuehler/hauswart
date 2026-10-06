import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, list } from "$lib/server/api/handlers/tasks";

export const GET = bind(endpoints.tasksList, list);
export const POST = bind(endpoints.tasksCreate, create);
