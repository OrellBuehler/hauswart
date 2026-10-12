import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { review } from "$lib/server/api/handlers/costs";

export const POST = bind(endpoints.costsReview, review);
