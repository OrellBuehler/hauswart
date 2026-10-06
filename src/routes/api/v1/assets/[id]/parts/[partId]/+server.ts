import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { unlinkFromAsset } from "$lib/server/api/handlers/parts";

export const DELETE = bind(endpoints.assetPartsUnlink, unlinkFromAsset);
