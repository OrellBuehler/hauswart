import type { RequestHandler } from "./$types";
import { serviceWorkerResponse } from "$lib/server/pwa/service-worker";

/** The service worker script, served through the hook so it is revalidated on every update check. */
export const GET: RequestHandler = ({ request }) =>
  serviceWorkerResponse(request);
