import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { moveToBook } from "#lib/server/api/handlers/costs.ts";

export const POST = bind(endpoints.costsMoveToBook, moveToBook);
