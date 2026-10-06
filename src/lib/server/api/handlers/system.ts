import { buildOpenApiDocument, type OpenApiDocument } from "$lib/api/openapi";
import type { endpoints } from "$lib/api/registry";
import { APP_VERSION } from "$lib/server/version";
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
