import type { Handle } from "@sveltejs/kit";
import { paraglideMiddleware } from "$lib/paraglide/server";
import { assertSecretKeyConfigured } from "$lib/server/crypto";
import { runMigrations } from "$lib/server/db";

export function init() {
  assertSecretKeyConfigured();
  runMigrations();
}

export const handle: Handle = ({ event, resolve }) =>
  paraglideMiddleware(event.request, ({ request, locale }) => {
    event.request = request;
    return resolve(event, {
      transformPageChunk: ({ html }) => html.replace("%lang%", locale),
    });
  });
