import type { Handle, HandleServerError } from "@sveltejs/kit";
import { ApiError } from "$lib/api/errors";
import { paraglideMiddleware } from "$lib/paraglide/server";
import { householdTimeZone } from "$lib/server/config";
import { assertSecretKeyConfigured } from "$lib/server/crypto";
import { runMigrations } from "$lib/server/db";
import { registerDomainEventHandlers } from "$lib/server/domain-events";
import { warmDummyHash } from "$lib/server/auth/password";
import { startCredentialPurge } from "$lib/server/auth/purge";
import {
  clearedSessionCookieHeader,
  deleteSessionCookie,
  setSessionCookie,
  SESSION_COOKIE,
  validateSessionToken,
} from "$lib/server/auth/sessions";
import { verifyToken } from "$lib/server/auth/tokens";
import {
  isApiPath,
  isBearerPath,
  isPublicPath,
} from "$lib/server/auth/routing";
import { registerEvaluator } from "$lib/server/tasks/scheduler";
import { countUsers } from "$lib/server/users/users";

export async function init() {
  assertSecretKeyConfigured();
  householdTimeZone();
  runMigrations();
  await warmDummyHash();
  registerDomainEventHandlers();
  registerEvaluator();
  startCredentialPurge();
}

const BEARER = /^Bearer\s+(\S+)\s*$/i;

/** The token of a `Bearer` Authorization header; undefined for any other scheme (e.g. a proxy's Basic auth). */
function bearerToken(header: string | null): string | null | undefined {
  if (header === null || !/^Bearer(\s|$)/i.test(header)) return undefined;
  return BEARER.exec(header)?.[1] ?? null;
}

function redirectResponse(location: string, clearCookie?: string): Response {
  const headers = new Headers({ location });
  if (clearCookie) headers.append("set-cookie", clearCookie);
  return new Response(null, { status: 303, headers });
}

function unauthenticatedResponse(
  pathname: string,
  needsSetup: boolean,
  clearCookie?: string,
): Response {
  const error = needsSetup
    ? new ApiError("setup_required", "Setup has not been completed")
    : new ApiError("unauthenticated", "Authentication required");
  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  if (isBearerPath(pathname)) headers.set("www-authenticate", "Bearer");
  if (clearCookie) headers.append("set-cookie", clearCookie);
  return new Response(JSON.stringify(error.toBody()), {
    status: error.status,
    headers,
  });
}

/**
 * Resolves the caller into `locals`: a bearer token on `/api/v1/` paths
 * (never falling back to the cookie when one is presented), otherwise the
 * session cookie. Endpoints decide what they accept (`bind`); this only gates
 * pages and the API for anonymous callers.
 */
const authHandle: Handle = async ({ event, resolve }) => {
  event.locals.user = null;
  event.locals.session = null;
  event.locals.token = null;

  const { pathname, search } = event.url;
  const bearer = isBearerPath(pathname)
    ? bearerToken(event.request.headers.get("authorization"))
    : undefined;

  let staleCookie: string | undefined;
  if (bearer !== undefined) {
    const verified = bearer ? verifyToken(bearer) : null;
    if (verified) {
      event.locals.user = verified.user;
      event.locals.token = verified.token;
    }
  } else {
    const token = event.cookies.get(SESSION_COOKIE);
    if (token) {
      const validated = validateSessionToken(token);
      if (validated) {
        event.locals.user = validated.user;
        event.locals.session = validated.session;
        if (validated.refreshed) {
          setSessionCookie(event.cookies, token, validated.session.expiresAt);
        }
      } else {
        deleteSessionCookie(event.cookies);
        // Early returns below bypass resolve(), so the cookie jar is not applied.
        staleCookie = clearedSessionCookieHeader(event.cookies);
      }
    }
  }

  if (event.locals.user || isPublicPath(pathname)) return resolve(event);

  const needsSetup = countUsers() === 0;
  if (isApiPath(pathname)) {
    return unauthenticatedResponse(pathname, needsSetup, staleCookie);
  }
  if (needsSetup) return redirectResponse("/setup", staleCookie);
  return redirectResponse(
    `/login?redirectTo=${encodeURIComponent(pathname + search)}`,
    staleCookie,
  );
};

type Resolve = Parameters<Handle>[0]["resolve"];

/** Runs the request with the locale Paraglide detects (cookie, then browser language). */
const withLocale = (
  event: Parameters<Handle>[0]["event"],
  resolve: Resolve,
): Promise<Response> =>
  paraglideMiddleware(event.request, ({ request, locale }) => {
    event.request = request;
    return resolve(event, {
      transformPageChunk: ({ html }) => html.replace("%lang%", locale),
    });
  });

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(self), geolocation=()",
};

/**
 * Adds the security headers every response should carry. The Content-Security-Policy of pages
 * comes from `kit.csp` in svelte.config.js (SvelteKit adds the nonces or hashes itself).
 */
function withSecurityHeaders(response: Response): Response {
  const apply = (target: Response) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!target.headers.has(name)) target.headers.set(name, value);
    }
    return target;
  };
  try {
    return apply(response);
  } catch (error) {
    // Responses from fetch() and Response.redirect() have immutable headers.
    if (!(error instanceof TypeError)) throw error;
    return apply(new Response(response.body, response));
  }
}

function internalErrorResponse(): Response {
  return new Response(
    JSON.stringify(new ApiError("internal", "Internal server error").toBody()),
    {
      status: 500,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    },
  );
}

export const handle: Handle = async ({ event, resolve }) => {
  let response: Response;
  try {
    response = await authHandle({
      event,
      resolve: (e) => withLocale(e, resolve),
    });
  } catch (error) {
    if (!isApiPath(event.url.pathname)) throw error;
    // Name only: messages and stacks can contain user data and paths.
    console.error(
      JSON.stringify({
        event: "hook.error",
        name: error instanceof Error ? error.name : "NonError",
      }),
    );
    response = internalErrorResponse();
  }
  return withSecurityHeaders(response);
};

/** Unexpected page errors: log the error name only (no message or stack) and show nothing else. */
export const handleError: HandleServerError = ({ error, event, status }) => {
  if (status >= 500) {
    console.error(
      JSON.stringify({
        event: "server.error",
        name: error instanceof Error ? error.name : "NonError",
        status,
        route: event.route.id,
      }),
    );
  }
  return { message: status >= 500 ? "Internal Error" : "Not Found" };
};
