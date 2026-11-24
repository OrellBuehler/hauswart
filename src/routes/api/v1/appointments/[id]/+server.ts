import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { get, remove, update } from "#lib/server/api/handlers/appointments.ts";

export const GET = bind(endpoints.appointmentsGet, get);
export const PATCH = bind(endpoints.appointmentsUpdate, update);
export const DELETE = bind(endpoints.appointmentsDelete, remove);
