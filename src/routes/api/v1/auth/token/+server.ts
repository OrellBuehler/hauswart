import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import {
  issueDeviceToken,
  revokeCallingToken,
} from "#lib/server/api/handlers/auth.ts";

export const POST = bind(endpoints.authToken, issueDeviceToken);
export const DELETE = bind(endpoints.authRevokeToken, revokeCallingToken);
