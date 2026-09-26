#!/usr/bin/env bash
# Tacet pull-request check for any CI - a thin wrapper over `tacet ci`:
#   1. index the frontend
#   2. backend API changes base...working tree -> frontend impact   (api-changes.md)
#   3. changed frontend files -> checked against the new contract   (contract.md)
# Writes $TACET_OUT/report.md and report.json (and the GitHub job summary when available).
# Exit code: 1 when a check fails at its configured level.
#
# Required: TACET_FRONTEND, TACET_BACKEND, TACET_BASE (git ref, e.g. origin/main)
# Optional: TACET_CLI (default: this repo's CLI, then `tacet` on PATH), TACET_INDEX, TACET_OUT,
#           TACET_FAIL_ON (definite|likely|possible|never, default definite),
#           TACET_CHECK_FAIL_ON (error|warning|never, default error),
#           TACET_AI_PROVIDER (e.g. anthropic) to add AI verification of undecided findings,
#           TACET_AI_MODEL, TACET_VERIFY_FAIL_ON (fail|warning|never, default fail).
#           AI verification needs provider credentials (e.g. ANTHROPIC_API_KEY).
set -uo pipefail

: "${TACET_FRONTEND:?set TACET_FRONTEND to the frontend directory}"
: "${TACET_BACKEND:?set TACET_BACKEND to the backend directory}"
: "${TACET_BASE:?set TACET_BASE to the base git ref}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -n "${TACET_CLI:-}" ]; then
  read -r -a cli <<< "$TACET_CLI"
elif [ -f "$here/../packages/cli/dist/bin.js" ]; then
  cli=(node "$here/../packages/cli/dist/bin.js")
else
  cli=(tacet)
fi
out="${TACET_OUT:-.tacet}"

exec "${cli[@]}" --index "${TACET_INDEX:-$out/index.db}" ci \
  --frontend "$TACET_FRONTEND" --backend "$TACET_BACKEND" --base "$TACET_BASE" --out "$out" \
  --fail-on "${TACET_FAIL_ON:-definite}" \
  --check-fail-on "${TACET_CHECK_FAIL_ON:-error}" \
  --verify-fail-on "${TACET_VERIFY_FAIL_ON:-fail}" \
  ${TACET_AI_PROVIDER:+--ai-provider "$TACET_AI_PROVIDER"} \
  ${TACET_AI_MODEL:+--ai-model "$TACET_AI_MODEL"}
