import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, list } from "$lib/server/api/handlers/cost-tags";

export const GET = bind(endpoints.costTagsList, list);
export const POST = bind(endpoints.costTagsCreate, create);
