import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { complete } from "#lib/server/api/handlers/appointments.ts";

export const POST = bind(endpoints.appointmentsComplete, complete);
