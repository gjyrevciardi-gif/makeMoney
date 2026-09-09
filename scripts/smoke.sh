#!/usr/bin/env sh
set -eu

: "${BASE_URL:?BASE_URL is required, for example https://example.com}"
API_URL="${API_URL:-$BASE_URL}"

check() {
  name="$1"
  url="$2"
  expected="$3"
  body="$(mktemp)"
  trap 'rm -f "$body"' EXIT HUP INT TERM
  status="$(curl --silent --show-error --location --max-time 15 --output "$body" --write-out '%{http_code}' "$url")"
  if [ "$status" != "$expected" ]; then
    printf 'FAIL %s: HTTP %s\n' "$name" "$status" >&2
    exit 1
  fi
  printf 'PASS %s: HTTP %s\n' "$name" "$status"
  rm -f "$body"
  trap - EXIT HUP INT TERM
}

check frontend "$BASE_URL/" 200
check liveness "$API_URL/health/live" 200
check readiness "$API_URL/health/ready" 200
