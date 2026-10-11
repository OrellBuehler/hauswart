import { endpoints } from "$lib/api/registry";
import { bind } from "$lib/server/api/bind";
import { mount } from "$lib/server/api/handlers/tireSets";

export const POST = bind(endpoints.tireSetsMount, mount);
