import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { create, list } from "#lib/server/api/handlers/cost-tags.ts";

export const GET = bind(endpoints.costTagsList, list);
export const POST = bind(endpoints.costTagsCreate, create);
