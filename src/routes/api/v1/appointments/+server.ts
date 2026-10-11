import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { create, list } from "$lib/server/api/handlers/appointments";

export const GET = bind(endpoints.appointmentsList, list);
export const POST = bind(endpoints.appointmentsCreate, create);
