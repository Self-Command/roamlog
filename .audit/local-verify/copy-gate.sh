#!/usr/bin/env bash
# Thin wrapper so the gate can be run as `bash .audit/local-verify/copy-gate.sh`.
set -euo pipefail
cd "$(dirname "$0")/../.." || exit 1
exec node .audit/local-verify/copy-gate.mjs "$@"
