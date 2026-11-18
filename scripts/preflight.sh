#!/usr/bin/env bash
# Preflight checks before deploying doom-databricks.
# Usage: scripts/preflight.sh [profile]
set -euo pipefail

PROFILE="${1:-}"
MIN_CLI_MAJOR=0
MIN_CLI_MINOR=250
MIN_CLI_PATCH=0
MIN_CLI="${MIN_CLI_MAJOR}.${MIN_CLI_MINOR}.${MIN_CLI_PATCH}"

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

need_cmd databricks
need_cmd python3

PROFILE_ARGS=()
if [[ -n "${PROFILE}" ]]; then
  PROFILE_ARGS=(-p "${PROFILE}")
fi

# --- CLI version ---
version_line="$(databricks version 2>/dev/null || true)"
if [[ -z "${version_line}" ]]; then
  die "Could not read Databricks CLI version. Install or upgrade the CLI."
fi

cli_version="$(
  printf '%s\n' "${version_line}" | python3 -c '
import re, sys
text = sys.stdin.read()
m = re.search(r"v?(\d+)\.(\d+)\.(\d+)", text)
if not m:
    sys.exit(1)
print(".".join(m.groups()))
'
)" || die "Could not parse Databricks CLI version from: ${version_line}"

if ! python3 - "${cli_version}" "${MIN_CLI_MAJOR}" "${MIN_CLI_MINOR}" "${MIN_CLI_PATCH}" <<'PY'
import sys
ver = tuple(int(x) for x in sys.argv[1].split("."))
need = (int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]))
sys.exit(0 if ver >= need else 1)
PY
then
  die "Databricks CLI ${cli_version} is too old. Need >= ${MIN_CLI}."
fi

printf 'OK CLI version %s\n' "${cli_version}"

# --- Auth ---
if ! databricks current-user me "${PROFILE_ARGS[@]}" >/dev/null 2>&1; then
  if [[ -n "${PROFILE}" ]]; then
    die "Auth failed for profile '${PROFILE}'. Run: databricks auth login --profile ${PROFILE}"
  fi
  die "Auth failed. Run: databricks auth login"
fi

if [[ -n "${PROFILE}" ]]; then
  printf 'OK auth (profile %s)\n' "${PROFILE}"
else
  printf 'OK auth\n'
fi

# --- ai_decide preview / REST endpoint ---
body='{"state":"preflight ping","questions":{"action":{"type":"choice","instructions":"Pick WAIT.","criteria":{"WAIT":"Do nothing"}}}}'

set +e
api_out="$(databricks api post /api/2.0/ai-functions/ai-decide "${PROFILE_ARGS[@]}" --json "${body}" 2>&1)"
api_rc=$?
set -e

if [[ ${api_rc} -ne 0 ]] || printf '%s\n' "${api_out}" | grep -qi 'PERMISSION_DENIED'; then
  if printf '%s\n' "${api_out}" | grep -qi 'AI Decide Preview is not enabled'; then
    die "AI Decide preview is not enabled in this workspace (PERMISSION_DENIED). Ask a workspace admin to enable AI Decide Preview, then re-run preflight."
  fi
  if printf '%s\n' "${api_out}" | grep -qi 'PERMISSION_DENIED'; then
    die "ai_decide REST returned PERMISSION_DENIED (not the AI Decide Preview message). Check the caller's grants for ai-functions. Detail: ${api_out}"
  fi
  die "ai_decide REST check failed: ${api_out}"
fi

printf 'OK ai_decide REST endpoint\n'
printf 'Preflight passed.\n'
