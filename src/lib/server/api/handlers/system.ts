import {
  buildOpenApiDocument,
  type OpenApiDocument,
} from "#lib/api/openapi.ts";
import type { endpoints } from "#lib/api/registry.ts";
import { APP_VERSION } from "#lib/server/version.ts";
import type { Handler } from "../bind";

export const health: Handler<typeof endpoints.health> = () => ({
  status: "ok",
  version: APP_VERSION,
});

let document: OpenApiDocument | undefined;

export const openapi: Handler<typeof endpoints.openapi> = () => {
  document ??= buildOpenApiDocument();
  return document;
};
