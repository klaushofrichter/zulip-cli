#!/usr/bin/env bash
# Push variables defined in .env up to this repository's GitHub Actions secrets.
#
# Usage:  scripts/sync-secrets.sh [--dry-run] [--repo OWNER/NAME] [--env PATH]
#
# Defaults: --repo is the repo of the current working tree (gh resolves it),
#           --env is .env at the repo root.
# Requirements: gh CLI authenticated with `repo` scope; jq is NOT required.
#
# Lines starting with # and blank lines are ignored. Quoted values are unquoted.
# Each KEY=VALUE pair becomes a repository secret named KEY.

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
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Locate .env relative to repo root if not given explicitly.
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
if [[ -n "$REPO" ]]; then
  REPO_FLAG=(--repo "$REPO")
fi

count=0
while IFS= read -r raw || [[ -n "$raw" ]]; do
  # strip leading/trailing whitespace
  line="${raw#"${raw%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  [[ -z "$line" ]] && continue
  [[ "$line" == \#* ]] && continue

  key="${line%%=*}"
  val="${line#*=}"

  # validate key shape
  if ! [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    echo "skip: invalid secret name '$key'" >&2
    continue
  fi

  # strip a single matching pair of surrounding quotes
  if [[ "$val" =~ ^\".*\"$ ]] || [[ "$val" =~ ^\'.*\'$ ]]; then
    val="${val:1:${#val}-2}"
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    masked="****"
    [[ ${#val} -gt 0 ]] && masked="**** (${#val} chars)"
    echo "[dry-run] would set $key=$masked"
  else
    printf '%s' "$val" | gh secret set "$key" --body - "${REPO_FLAG[@]}"
    echo "set: $key"
  fi
  count=$((count + 1))
done < "$ENV_FILE"

echo "done. ${count} secret(s) processed from $ENV_FILE"
