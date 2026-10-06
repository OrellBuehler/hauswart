import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { movements } from "$lib/server/api/handlers/parts";

export const GET = bind(endpoints.partsMovements, movements);
