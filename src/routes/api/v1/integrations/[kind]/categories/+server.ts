import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { categories } from "$lib/server/api/handlers/finance";

export const GET = bind(endpoints.integrationsCategories, categories);
