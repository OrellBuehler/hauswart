import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import {
  issueDeviceToken,
  revokeCallingToken,
} from "$lib/server/api/handlers/auth";

export const POST = bind(endpoints.authToken, issueDeviceToken);
export const DELETE = bind(endpoints.authRevokeToken, revokeCallingToken);
