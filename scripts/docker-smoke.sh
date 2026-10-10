#!/usr/bin/env bash
# End-to-end smoke test of a running hauswart container through its public HTTP surface.
# Usage: scripts/docker-smoke.sh <base-url> [expected-version]
# The server must run with ORIGIN=<base-url> and without HAUSWART_SETUP_TOKEN, on an empty /data.
set -euo pipefail

base="${1:?usage: docker-smoke.sh <base-url> [expected-version]}"
expected="${2:-}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
jar="$work/cookies"

step() { printf '\n== %s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

session() {
  curl --fail-with-body -sS -b "$jar" -c "$jar" -H "Origin: $base" -H 'Content-Type: application/json' "$@"
}

step "health"
curl --fail-with-body -sS "$base/api/health" | jq -e '.status == "ok"' >/dev/null
version="$(curl --fail-with-body -sS "$base/api/v1/health" | jq -r '.version')"
echo "version: $version"
if [ -n "$expected" ] && [ "$version" != "$expected" ]; then
  fail "expected version $expected, got $version"
fi

step "setup"
curl --fail-with-body -sS "$base/api/v1/setup" | jq -e '.needsSetup == true' >/dev/null
session -X POST "$base/api/v1/setup" \
  -d '{"username":"smoke","displayName":"Smoke Test","password":"smoke-test-password","locale":"en"}' |
  jq -e '.user.username == "smoke"' >/dev/null

step "api token"
token="$(session -X POST "$base/api/v1/tokens" \
  -d '{"name":"smoke","kind":"integration","scopes":["read","write","docs:write"]}' | jq -r '.token')"
case "$token" in hw_*) ;; *) fail "unexpected token" ;; esac
api() { curl --fail-with-body -sS -H "Authorization: Bearer $token" "$@"; }

step "documentation page (markdown worker)"
api -X POST "$base/api/v1/pages" -H 'Content-Type: application/json' \
  -d '{"title":"Smoke","bodyMd":"# Heading\n\nSome **bold** text and a [[other-page]] link.\n"}' |
  tee "$work/page.json" | jq -e '.renderedHtml | contains("<strong>bold</strong>")' >/dev/null

step "defect, PNG upload (image pipeline) and PDF export"
defect="$(api -X POST "$base/api/v1/defects" -H 'Content-Type: application/json' \
  -d '{"title":"Smoke defect","severity":"low"}' | jq -r '.id')"
printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' |
  base64 -d >"$work/pixel.png"
# A bearer upload carries no Origin header: only cookie requests are checked against forgery.
api -X POST "$base/api/v1/attachments" \
  -F "file=@$work/pixel.png;type=image/png" -F ownerType=defect -F "ownerId=$defect" |
  jq -e '.mime == "image/png" and .thumbUrl != null' >/dev/null
api "$base/api/v1/defects/export.pdf" -o "$work/defects.pdf"
[ "$(head -c 4 "$work/defects.pdf")" = "%PDF" ] || fail "defect export is not a PDF"

step "emergency sheet (PDF) and guest link"
api "$base/api/v1/emergency/export.pdf" -o "$work/emergency.pdf"
[ "$(head -c 4 "$work/emergency.pdf")" = "%PDF" ] || fail "emergency sheet is not a PDF"
expires="$(date -u -d '+7 days' +%Y-%m-%dT%H:%M:%SZ)"
guest="$(session -X POST "$base/api/v1/guest-links" \
  -d "{\"label\":\"smoke\",\"expiresAt\":\"$expires\"}" | jq -r '.url')"
curl --fail-with-body -sS "$guest" | grep -qi '<html' || fail "guest page did not render"

step "cross-site writes are refused"
evil="https://evil.example"
expect_status() {
  local want="$1" got
  shift
  got="$(curl -sS -o /dev/null -w '%{http_code}' "$@")"
  [ "$got" = "$want" ] || fail "expected HTTP $want, got $got for: $*"
}
# the PIN form of a guest page is a SvelteKit form action, outside the API
expect_status 403 -X POST "$guest" -H "Origin: $evil" --data-urlencode pin=1234
expect_status 403 -X POST "$guest" --data-urlencode pin=1234
expect_status 303 -X POST "$guest" -H "Origin: $base" -H "Accept: text/html" --data-urlencode pin=1234
# a browser posts that form from the guest page with "Origin: null" (that page sends no referrer)
expect_status 303 -X POST "$guest" -H "Origin: null" -H "Sec-Fetch-Site: same-origin" \
  -H "Accept: text/html" --data-urlencode pin=1234
expect_status 403 -X POST "$guest" -H "Origin: null" -H "Sec-Fetch-Site: cross-site" --data-urlencode pin=1234
# cookie requests in the encodings a cross-site HTML form can send
expect_status 403 -X POST "$base/api/v1/attachments" -b "$jar" -H "Origin: $evil" \
  -F "file=@$work/pixel.png;type=image/png" -F ownerType=defect -F "ownerId=$defect"
expect_status 403 -X POST "$base/api/v1/attachments" -b "$jar" \
  -F "file=@$work/pixel.png;type=image/png" -F ownerType=defect -F "ownerId=$defect"
expect_status 403 -X POST "$base/api/v1/tokens" -b "$jar" -H "Origin: $evil" --data-urlencode name=forged
api "$base/api/v1/attachments?ownerType=defect&ownerId=$defect" | jq -e '.items | length == 1' >/dev/null

step "mcp over http"
mcp_token="$(session -X POST "$base/api/v1/tokens" \
  -d '{"name":"smoke mcp","kind":"mcp","scopes":["read"]}' | jq -r '.token')"
mcp_headers=(-H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream')
mcp() { curl --fail-with-body -sS -H "Authorization: Bearer $mcp_token" "${mcp_headers[@]}" "$base/api/v1/mcp" "$@"; }
mcp -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' |
  jq -e '.result.serverInfo.name == "hauswart"' >/dev/null
mcp -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' |
  jq -e '[.result.tools[].name] | index("list_upcoming") != null and index("create_task") == null' >/dev/null
mcp -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"whoami","arguments":{}}}' |
  jq -e '.result.isError != true and (.result.content[0].text | contains("Smoke Test"))' >/dev/null
# no token, a foreign origin and the session cookie are all refused; a stateless server opens no stream
expect_status 401 -X POST "$base/api/v1/mcp" "${mcp_headers[@]}" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
expect_status 403 -X POST "$base/api/v1/mcp" "${mcp_headers[@]}" -H "Authorization: Bearer $mcp_token" -H "Origin: $evil" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
expect_status 403 -X POST "$base/api/v1/mcp" "${mcp_headers[@]}" -b "$jar" -H "Origin: $base" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
expect_status 405 "$base/api/v1/mcp" -H "Authorization: Bearer $mcp_token" -H 'Accept: text/event-stream'
expect_status 405 -X DELETE "$base/api/v1/mcp" -H "Authorization: Bearer $mcp_token"

step "calendar feed"
feed="$(session -X POST "$base/api/v1/calendar-feeds" -d '{"name":"smoke"}' | jq -r '.url')"
curl --fail-with-body -sS "$feed" | grep -q '^BEGIN:VCALENDAR' || fail "feed is not an iCalendar document"

step "installable app: manifest, service worker, offline page (anonymous)"
# A browser fetches the manifest without credentials and the worker before anybody signs in. No
# cookie and no token below: all three are public and hold no user data.
header() { tr -d '\r' <"$1" | grep -i "^$2:" | head -n 1 | cut -d: -f2- | sed 's/^ *//'; }
curl --fail-with-body -sS -D "$work/manifest.headers" -o "$work/manifest.json" "$base/manifest.webmanifest"
[ "$(header "$work/manifest.headers" content-type)" = "application/manifest+json" ] ||
  fail "manifest content type is '$(header "$work/manifest.headers" content-type)'"
jq -e '.name == "hauswart" and .display == "standalone" and .start_url == "/" and .scope == "/"
  and ([.icons[] | select(.sizes == "192x192" and .purpose == "any")] | length == 1)
  and ([.icons[] | select(.sizes == "512x512" and .purpose == "any")] | length == 1)
  and ([.icons[] | select(.sizes == "512x512" and .purpose == "maskable")] | length == 1)' \
  "$work/manifest.json" >/dev/null || fail "manifest is incomplete"
for icon in $(jq -r '.icons[].src' "$work/manifest.json") /icons/apple-touch-icon.png; do
  expect_status 200 "$base$icon"
done
curl --fail-with-body -sS -D "$work/sw.headers" -o "$work/sw.js" "$base/sw.js"
case "$(header "$work/sw.headers" content-type)" in "text/javascript"*) ;; *) fail "service worker content type is '$(header "$work/sw.headers" content-type)'" ;; esac
[ "$(header "$work/sw.headers" cache-control)" = "no-cache" ] || fail "service worker must be served with Cache-Control: no-cache"
[ "$(header "$work/sw.headers" x-content-type-options)" = "nosniff" ] || fail "service worker lacks the hook's security headers"
grep -q 'SKIP_WAITING' "$work/sw.js" || fail "sw.js is not the generated service worker"
sw_etag="$(header "$work/sw.headers" etag)"
[ -n "$sw_etag" ] || fail "service worker has no ETag"
expect_status 304 -H "If-None-Match: $sw_etag" "$base/sw.js"
expect_status 200 "$base/offline"
# The worker serves the offline page in place of any app page (/tasks/12, /d/<slug>), so its asset links
# must not depend on its own address: "./_app/..." would resolve to /tasks/_app/... and leave it unstyled.
curl --fail-with-body -sS -o "$work/offline.html" "$base/offline"
if grep -Eq '(href|src)="\.{1,2}/' "$work/offline.html"; then
  fail "the offline page links assets relative to its own address: $(grep -Eo '(href|src)="\.{1,2}/[^"]*"' "$work/offline.html" | head -n 3 | tr '\n' ' ')"
fi
grep -Eq 'href="/_app/immutable/assets/[^"]+\.css"' "$work/offline.html" || fail "the offline page links no absolute stylesheet"
# Every file the worker precaches must be served (a 404 makes the worker's install fail, so the app
# would never become installable offline). The entries are relative to /sw.js, which sits at the root.
grep -Eo '\{url:"[^"]+"' "$work/sw.js" | sed -E 's/^\{url:"//; s/"$//; s#^/##' >"$work/precache.txt"
precached="$(wc -l <"$work/precache.txt")"
[ "$precached" -gt 10 ] || fail "found only $precached precache entries in sw.js"
# one curl for all of them: the connection is reused instead of opening hundreds
fetch_args=()
while IFS= read -r precache_url; do fetch_args+=(-o /dev/null "$base/$precache_url"); done <"$work/precache.txt"
served="$(curl -sS -w '%{http_code}\n' "${fetch_args[@]}" | grep -c '^200$' || true)"
[ "$served" = "$precached" ] || fail "only $served of $precached precached files are served with 200"
echo "precached files: $precached"
# nothing else changed: the API still needs its credentials, and public files stay public
expect_status 401 "$base/api/v1/tokens"
expect_status 200 "$base/api/v1/health"

step "openapi"
api "$base/api/v1/openapi.json" | jq -e '.openapi | startswith("3.1")' >/dev/null

printf '\nsmoke test passed\n'
