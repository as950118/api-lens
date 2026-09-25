#!/usr/bin/env bash
# ApiLens pull-request check for any CI - a thin wrapper over `apilens ci`:
#   1. index the frontend
#   2. backend API changes base...working tree -> frontend impact   (api-changes.md)
#   3. changed frontend files -> checked against the new contract   (contract.md)
# Writes $APILENS_OUT/report.md and report.json (and the GitHub job summary when available).
# Exit code: 1 when a check fails at its configured level.
#
# Required: APILENS_FRONTEND, APILENS_BACKEND, APILENS_BASE (git ref, e.g. origin/main)
# Optional: APILENS_CLI (default: this repo's CLI, then `apilens` on PATH), APILENS_INDEX, APILENS_OUT,
#           APILENS_FAIL_ON (definite|likely|possible|never, default definite),
#           APILENS_CHECK_FAIL_ON (error|warning|never, default error),
#           APILENS_AI_PROVIDER (e.g. anthropic) to add AI verification of undecided findings,
#           APILENS_AI_MODEL, APILENS_VERIFY_FAIL_ON (fail|warning|never, default fail).
#           AI verification needs provider credentials (e.g. ANTHROPIC_API_KEY).
set -uo pipefail

: "${APILENS_FRONTEND:?set APILENS_FRONTEND to the frontend directory}"
: "${APILENS_BACKEND:?set APILENS_BACKEND to the backend directory}"
: "${APILENS_BASE:?set APILENS_BASE to the base git ref}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -n "${APILENS_CLI:-}" ]; then
  read -r -a cli <<< "$APILENS_CLI"
elif [ -f "$here/../packages/cli/dist/bin.js" ]; then
  cli=(node "$here/../packages/cli/dist/bin.js")
else
  cli=(apilens)
fi
out="${APILENS_OUT:-.apilens}"

exec "${cli[@]}" --index "${APILENS_INDEX:-$out/index.db}" ci \
  --frontend "$APILENS_FRONTEND" --backend "$APILENS_BACKEND" --base "$APILENS_BASE" --out "$out" \
  --fail-on "${APILENS_FAIL_ON:-definite}" \
  --check-fail-on "${APILENS_CHECK_FAIL_ON:-error}" \
  --verify-fail-on "${APILENS_VERIFY_FAIL_ON:-fail}" \
  ${APILENS_AI_PROVIDER:+--ai-provider "$APILENS_AI_PROVIDER"} \
  ${APILENS_AI_MODEL:+--ai-model "$APILENS_AI_MODEL"}
