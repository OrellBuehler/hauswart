#!/usr/bin/env bash
# Captures the Play Store screenshots from a running emulator with the debug app installed.
# The app is started once per screen with screenshot_* extras, which make a debug build sign in to
# the demo server and open the given screen (MainActivity), so nothing is tapped. The emulator
# reaches the server on this machine as 10.0.2.2.
#
# Usage: android.sh <output dir>      (needs `bun run build` in the repository root; adb talks to
#                                      the only device, or to ANDROID_SERIAL)
set -euo pipefail

OUT_DIR="$1"
PACKAGE="ch.orellbuehler.hauswart"
ACTIVITY="$PACKAGE/ch.orellbuehler.hauswart.android.MainActivity"

# shellcheck source=mobile/scripts/screenshots/common.sh
source "$(dirname "$0")/common.sh"

device() {
  adb shell "$@" </dev/null >/dev/null
}

demo_bar() {
  device am broadcast -a com.android.systemui.demo -e command "$@"
}

launch() {
  local locale="$1" link="$2"
  device am force-stop "$PACKAGE"
  device am start -W -n "$ACTIVITY" \
    --es screenshot_server "http://10.0.2.2:$PORT" \
    --es screenshot_username "$DEMO_USERNAME" \
    --es screenshot_password "$DEMO_PASSWORD" \
    --es screenshot_locale "$locale" \
    --es screenshot_link "$link"
}

capture() {
  local locale="$1" name="$2" appearance="$3" link="$4" night=no
  local file="$OUT_DIR/$locale/$name.png"
  if [ "$appearance" = dark ]; then night=yes; fi
  device cmd uimode night "$night"
  launch "$locale" "$link"
  sleep "$SETTLE_SECONDS"
  adb exec-out screencap -p >"$file" </dev/null
  if ! big_enough "$file"; then
    echo "$locale/$name looks blank, waiting and capturing again" >&2
    sleep "$SETTLE_SECONDS"
    adb exec-out screencap -p >"$file" </dev/null
  fi
}

# No permission dialog over a screen, and a status bar without the emulator's own clutter.
device pm grant "$PACKAGE" android.permission.POST_NOTIFICATIONS || true
device settings put global sysui_demo_allowed 1
demo_bar enter
demo_bar clock -e hhmm 0941
demo_bar battery -e level 100 -e plugged false
demo_bar network -e wifi show -e level 4
demo_bar network -e mobile show -e datatype none -e level 4
demo_bar notifications -e visible false

for locale in $LOCALES; do
  mkdir -p "$OUT_DIR/$locale"
  start_server "$locale"
  # The first start signs in; it is thrown away.
  launch "$locale" /
  require_signed_in
  sleep "$SETTLE_SECONDS"
  each_screen "$locale"
  stop_server
done

device cmd uimode night no
demo_bar exit
