#!/usr/bin/env bash
# Captures the App Store screenshots from a booted simulator with the Debug app installed.
# The app is launched once per screen with -screenshot_* arguments, which make a Debug build sign
# in to the demo server and start on the given screen (ScreenshotRun.swift), so nothing is tapped.
#
# Usage: ios.sh <simulator udid> <output dir>      (needs `bun run build` in the repository root)
set -euo pipefail

DEVICE_ID="$1"
OUT_DIR="$2"
BUNDLE_ID="ch.orellbuehler.hauswart"

# shellcheck source=mobile/scripts/screenshots/common.sh
source "$(dirname "$0")/common.sh"

launch() {
  local locale="$1" link="$2"
  xcrun simctl terminate "$DEVICE_ID" "$BUNDLE_ID" 2>/dev/null || true
  xcrun simctl launch "$DEVICE_ID" "$BUNDLE_ID" \
    -screenshot_server "http://127.0.0.1:$PORT" \
    -screenshot_username "$DEMO_USERNAME" \
    -screenshot_password "$DEMO_PASSWORD" \
    -screenshot_locale "$locale" \
    -screenshot_link "$link" \
    -AppleLanguages "($locale)" \
    -AppleLocale "${locale}_CH" >/dev/null
}

capture() {
  local locale="$1" name="$2" appearance="$3" link="$4"
  local file="$OUT_DIR/$locale/$name.png"
  xcrun simctl ui "$DEVICE_ID" appearance "$appearance"
  launch "$locale" "$link"
  sleep "$SETTLE_SECONDS"
  xcrun simctl io "$DEVICE_ID" screenshot "$file" >/dev/null
  if ! big_enough "$file"; then
    echo "$locale/$name looks blank, waiting and capturing again" >&2
    sleep "$SETTLE_SECONDS"
    xcrun simctl io "$DEVICE_ID" screenshot "$file" >/dev/null
  fi
}

xcrun simctl status_bar "$DEVICE_ID" override \
  --time "9:41" --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100

for locale in $LOCALES; do
  mkdir -p "$OUT_DIR/$locale"
  start_server "$locale"
  # The first launch signs in (and is slow after an install); it is thrown away.
  launch "$locale" /
  require_signed_in
  sleep "$SETTLE_SECONDS"
  each_screen "$locale"
  stop_server
done

xcrun simctl ui "$DEVICE_ID" appearance light
xcrun simctl status_bar "$DEVICE_ID" clear
