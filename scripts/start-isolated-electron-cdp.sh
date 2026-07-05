#!/usr/bin/env bash
set -euo pipefail

DEFAULT_CDP_PORT="9333"
JINGLE_HOME_ENV="JINGLE_HOME"

resolve_cdp_port() {
  if (( $# > 0 )) && [[ -n "$1" ]]; then
    printf '%s\n' "$1"
    return
  fi

  printf '%s\n' "${DEFAULT_CDP_PORT}"
}

resolve_isolated_home() {
  local override
  if override="$(printenv JINGLE_HOME_OVERRIDE)"; then
    if [[ -n "${override}" ]]; then
      printf '%s\n' "${override}"
      return
    fi
  fi

  mktemp -d /tmp/jingle-d3k-XXXXXX
}

if (( $# > 0 )); then
  PORT="$(resolve_cdp_port "$1")"
else
  PORT="$(resolve_cdp_port)"
fi
JINGLE_HOME_DIR="$(resolve_isolated_home)"

echo "${JINGLE_HOME_ENV}=${JINGLE_HOME_DIR}"
JINGLE_HOME="${JINGLE_HOME_DIR}" node scripts/run-prisma-jingle-db.mjs migrate deploy

export JINGLE_BDD=1
export JINGLE_HOME="${JINGLE_HOME_DIR}"
export JINGLE_REMOTE_DEBUGGING_PORT="${PORT}"

exec npm run dev
