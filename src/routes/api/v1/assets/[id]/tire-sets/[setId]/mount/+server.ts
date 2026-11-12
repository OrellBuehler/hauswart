import { endpoints } from "#lib/api/registry.ts";
import { bind } from "#lib/server/api/bind.ts";
import { mount } from "#lib/server/api/handlers/tireSets.ts";

export const POST = bind(endpoints.tireSetsMount, mount);
