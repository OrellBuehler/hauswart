import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { unlinkFromAsset } from "#lib/server/api/handlers/parts.ts";

export const DELETE = bind(endpoints.assetPartsUnlink, unlinkFromAsset);
