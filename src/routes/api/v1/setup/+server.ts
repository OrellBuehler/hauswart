import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { setup, setupStatus } from "$lib/server/api/handlers/auth";

export const GET = bind(endpoints.setupStatus, setupStatus);
export const POST = bind(endpoints.setup, setup);
