#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-9333}"
OPENWORK_HOME_DIR="${OPENWORK_HOME_OVERRIDE:-$(mktemp -d /tmp/openwork-d3k-XXXXXX)}"

echo "OPENWORK_HOME=${OPENWORK_HOME_DIR}"
OPENWORK_HOME="${OPENWORK_HOME_DIR}" node scripts/run-prisma-openwork-db.mjs migrate deploy

export OPENWORK_BDD=1
export OPENWORK_HOME="${OPENWORK_HOME_DIR}"
export OPENWORK_REMOTE_DEBUGGING_PORT="${PORT}"

exec npm run dev
