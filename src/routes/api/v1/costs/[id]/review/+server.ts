import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { review } from "#lib/server/api/handlers/costs.ts";

export const POST = bind(endpoints.costsReview, review);
