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
# Multipart bodies are checked by SvelteKit's form CSRF guard, which wants an Origin header.
api -X POST "$base/api/v1/attachments" -H "Origin: $base" \
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

step "calendar feed"
feed="$(session -X POST "$base/api/v1/calendar-feeds" -d '{"name":"smoke"}' | jq -r '.url')"
curl --fail-with-body -sS "$feed" | grep -q '^BEGIN:VCALENDAR' || fail "feed is not an iCalendar document"

step "openapi"
api "$base/api/v1/openapi.json" | jq -e '.openapi | startswith("3.1")' >/dev/null

printf '\nsmoke test passed\n'
