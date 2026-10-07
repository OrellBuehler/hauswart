import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { changeMyPassword } from "$lib/server/api/handlers/auth";

export const POST = bind(endpoints.authChangePassword, changeMyPassword);
