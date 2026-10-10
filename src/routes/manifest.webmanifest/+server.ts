import type { RequestHandler } from "./$types";
import { m } from "$lib/paraglide/messages";
import { getLocale } from "$lib/paraglide/runtime";
import { buildManifest } from "$lib/pwa/manifest";

/**
 * The web app manifest. Public: browsers fetch it without credentials. It is a route rather than a
 * static file so that it passes through the hook (security headers) and follows the visitor's
 * language, which is why the answer varies with `Accept-Language` (no cookie is sent).
 */
export const GET: RequestHandler = () =>
  new Response(
    JSON.stringify(
      buildManifest({
        name: m.app_name(),
        description: m.app_tagline(),
        lang: getLocale(),
        shortcuts: {
          newTask: m.task_new(),
          newDefect: m.defect_new(),
          emergency: m.nav_emergency(),
          search: m.search_page_title(),
        },
      }),
    ),
    {
      headers: {
        "content-type": "application/manifest+json",
        "cache-control": "public, max-age=3600",
        vary: "Accept-Language",
      },
    },
  );
