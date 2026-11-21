import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { create, listForAsset } from "#lib/server/api/handlers/hints.ts";

export const GET = bind(endpoints.assetHintsList, listForAsset);
export const POST = bind(endpoints.assetHintsCreate, create);
