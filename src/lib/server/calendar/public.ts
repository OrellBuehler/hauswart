import type { RequestEvent } from "@sveltejs/kit";
import { clientKey } from "$lib/server/auth/login";
import {
  shareMissLimiter,
  shareRequestLimiter,
  shareTokenLimiter,
  type Hit,
} from "$lib/server/auth/rate-limit";
import { getDB } from "$lib/server/db";
import { buildFeedCalendar } from "./feed";
import { findFeedByToken, touchFeedFetched } from "./feeds";

const QUIET_HEADERS = {
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

function plain(status: number, body: string, extra: HeadersInit = {}) {
  return new Response(body, {
    status,
    headers: {
      ...QUIET_HEADERS,
      "content-type": "text/plain; charset=utf-8",
      ...extra,
    },
  });
}

function limited(hit: Extract<Hit, { allowed: false }>): Response {
  return plain(429, "Too many requests", {
    "retry-after": String(Math.max(1, Math.ceil(hit.retryAfterMs / 1000))),
  });
}

function matches(header: string | null, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header
    .split(",")
    .map((part) => part.trim().replace(/^W\//, ""))
    .includes(etag);
}

/**
 * `GET /api/public/cal/<token>.ics`: the calendar of one feed. The token is the credential, so
 * every failure looks the same (404) and guessing is rate limited per client address.
 */
export async function serveCalendarFeed(
  event: RequestEvent,
  token: string,
): Promise<Response> {
  const ip = clientKey(event.getClientAddress);
  const perIp = shareRequestLimiter.hit(ip);
  if (!perIp.allowed) return limited(perIp);
  const misses = shareMissLimiter.peek(ip);
  if (!misses.allowed) return limited(misses);

  const db = getDB();
  const now = Date.now();
  const feed = findFeedByToken({ db }, token);
  if (!feed) {
    shareMissLimiter.hit(ip);
    return plain(404, "Not found");
  }
  const perToken = shareTokenLimiter.hit(`cal:${feed.id}`);
  if (!perToken.allowed) return limited(perToken);

  const { ics, etag } = await buildFeedCalendar(
    { db, now },
    feed,
    event.url.origin,
  );
  touchFeedFetched({ db, now }, feed);

  const headers = {
    ...QUIET_HEADERS,
    "cache-control": "private, max-age=900",
    etag,
  };
  if (matches(event.request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(ics, {
    status: 200,
    headers: {
      ...headers,
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="hauswart.ics"',
    },
  });
}
