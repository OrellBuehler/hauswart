import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { tags } from "$lib/server/api/handlers/integrations";

export const GET = bind(endpoints.integrationsTags, tags);
