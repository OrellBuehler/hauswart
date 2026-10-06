import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { login } from "$lib/server/api/handlers/auth";

export const POST = bind(endpoints.authLogin, login);
