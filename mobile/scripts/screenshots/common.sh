# shellcheck shell=bash
# Shared by ios.sh and android.sh (sourced): a server with the demo household per language, and
# the list of screens.
#
# The server is the build in ./build of the repository (`bun run build`). Each language gets its
# own server on its own port, because the household is in that language; the app replaces its
# session when it is started with another address.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCREENS="$ROOT/mobile/scripts/screenshots/screens.txt"
LOCALES="${LOCALES:-en de}"
SETTLE_SECONDS="${SETTLE_SECONDS:-8}"
# A blank screen compresses to well under this; a real one never does.
MIN_BYTES="${MIN_BYTES:-40000}"

WORK="$(mktemp -d)"
PORT=3100
SERVER_PID=""

stop_server() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=""
  fi
}

cleanup() {
  stop_server
  rm -rf "$WORK"
}
trap cleanup EXIT

# start_server <locale>: afterwards the server answers on 127.0.0.1:$PORT and $DEMO is the file
# scripts/demo.ts wrote (sign-in and links).
start_server() {
  local locale="$1" dir="$WORK/$1"
  PORT=$((PORT + 1))
  mkdir -p "$dir/files"
  SERVER_LOG="$dir/server.log"
  (
    cd "$ROOT" || exit 1
    export PORT ORIGIN="http://127.0.0.1:$PORT" NODE_ENV=production
    export HAUSWART_COOKIE_SECURE=false HAUSWART_TZ=Europe/Zurich
    HAUSWART_SECRET_KEY="$(openssl rand -base64 32)"
    export HAUSWART_SECRET_KEY
    export DATABASE_PATH="$dir/hauswart.db" HAUSWART_FILES_DIR="$dir/files" HAUSWART_BACKUP_DIR="$dir/backup"
    exec bun ./build/start.js
  ) >"$SERVER_LOG" 2>&1 &
  SERVER_PID=$!
  local up=""
  for _ in $(seq 1 60); do
    if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null; then
      up=yes
      break
    fi
    sleep 1
  done
  if [ -z "$up" ]; then
    echo "The server did not start:" >&2
    cat "$SERVER_LOG" >&2
    exit 1
  fi
  DEMO="$dir/demo.json"
  (cd "$ROOT" && bun scripts/demo.ts --url "http://127.0.0.1:$PORT" --locale "$locale" --out "$DEMO") >/dev/null
  # shellcheck disable=SC2034  # both are read by the scripts that source this file
  DEMO_USERNAME="$(jq -r .username "$DEMO")"
  # shellcheck disable=SC2034
  DEMO_PASSWORD="$(jq -r .password "$DEMO")"
}

# The address in the demo household a screen starts on.
link_of() {
  local link
  link="$(jq -r --arg key "$1" '.links[$key] // empty' "$DEMO")"
  if [ -z "$link" ]; then
    echo "screens.txt names the link '$1', which scripts/demo.ts does not write" >&2
    exit 1
  fi
  printf '%s' "$link"
}

# Waits until the app has signed in (the server logs it); a screenshot of the sign-in screen is
# worth nothing, so the run fails instead.
require_signed_in() {
  for _ in $(seq 1 60); do
    if grep -q '"auth.login_succeeded"' "$SERVER_LOG"; then
      return 0
    fi
    sleep 1
  done
  echo "The app did not sign in to the demo server within a minute." >&2
  tail -n 20 "$SERVER_LOG" >&2
  exit 1
}

# big_enough <file>: true when the file is big enough to be a real screen.
big_enough() {
  [ "$(wc -c <"$1" | tr -d ' ')" -ge "$MIN_BYTES" ]
}

# Calls `capture <locale> <name> <appearance> <link>` (defined by the caller) for every screen.
each_screen() {
  local locale="$1" name appearance key link
  while read -r name appearance key <&3; do
    link="$(link_of "$key")"
    capture "$locale" "$name" "$appearance" "$link"
  done 3< <(grep -Ev '^[[:space:]]*(#|$)' "$SCREENS")
}
