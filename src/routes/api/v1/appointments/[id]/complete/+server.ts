import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { complete } from "$lib/server/api/handlers/appointments";

export const POST = bind(endpoints.appointmentsComplete, complete);
