#!/usr/bin/env bash
# Push variables defined in .env up to this repository's GitHub Actions secrets.
#
# Usage:  scripts/sync-secrets.sh [--dry-run] [--repo OWNER/NAME] [--env PATH]
#
# Defaults: --repo is the repo of the current working tree (gh resolves it),
#           --env is .env at the repo root.
# Requirements: gh CLI authenticated with `repo` scope.

set -euo pipefail

DRY_RUN=0
REPO=""
ENV_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --repo) REPO="$2"; shift 2 ;;
    --env) ENV_FILE="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$ENV_FILE" ]]; then
  ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  ENV_FILE="$ROOT/.env"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: .env file not found: $ENV_FILE" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI not found on PATH" >&2
  exit 1
fi

REPO_FLAG=()
[[ -n "$REPO" ]] && REPO_FLAG=(--repo "$REPO")

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] would set the following secrets from $ENV_FILE:"
  grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" | cut -d= -f1 | sed 's/^/  /'
  exit 0
fi

gh secret set -f "$ENV_FILE" "${REPO_FLAG[@]}"
echo "done. secrets synced from $ENV_FILE"
