import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { me, updateMe } from "$lib/server/api/handlers/auth";

export const GET = bind(endpoints.authMe, me);
export const PATCH = bind(endpoints.authUpdateMe, updateMe);
