#!/usr/bin/env bash
# Reset the UX-suite phone block (+1512555{6000..6699}) on the long-lived dev
# KV: login with the master OTP, then GET /me/wipe (the account self-wipe the
# Settings danger zone uses). Mirrors scripts/dev-reset-e2e-fixtures.ts for
# the ux-* suites, which keep all state inside this block.
set -u
BASE="http://localhost:5280"
wipe_one() {
  local n="$1"
  local jar
  jar="$(mktemp)"
  curl -s -c "$jar" -X POST "$BASE/api/auth/verify" \
    -H 'content-type: application/json' \
    -d "{\"phoneNumber\":\"+1512555$n\",\"code\":\"000000\"}" >/dev/null
  curl -s -b "$jar" "$BASE/api/me/wipe" >/dev/null
  rm -f "$jar"
}
export -f wipe_one
export BASE
seq 6000 6699 | xargs -P 8 -I{} bash -c 'wipe_one {}'
echo "wiped +1512555{6000..6699}"
