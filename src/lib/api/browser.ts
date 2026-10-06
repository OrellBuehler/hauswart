import { createApiClient } from "./client";

/** Client for event handlers in the browser. In `load` functions use `createApiClient(fetch)` with the load's own `fetch`. */
export const api = createApiClient((input, init) => fetch(input, init));
