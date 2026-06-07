#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Deploy the current TownSquare checkout to a remote server as a new release.

Usage:
  scripts/deploy.sh [--skip-checks] [--ref <git-ref>] [--env-file <path>] [--help]

Environment variables:
  DEPLOY_HOST           Required. SSH host or IP for the deployment target.
  DEPLOY_USER           Required. SSH user for the deployment target.
  DEPLOY_ROOT           Optional. Remote app root. Default: /opt/townsquare
  DEPLOY_SERVICE        Optional. systemd service name. Default: townsquare.service
  DEPLOY_PORT           Optional. Local healthcheck port on the server. Default: 8787
  HEALTHCHECK_URL       Optional. Public healthcheck URL to verify after deploy.
  SSH_OPTS              Optional. Extra ssh/scp options, e.g. '-o BatchMode=yes'
  DEPLOY_ENV_FILE       Optional. Local env file to source before deploy.

Notes:
- By default the script will source ./.env.deploy.local if it exists.
- This script uses ssh/scp, so it should be run from a machine with access to the server.
- It creates a timestamped release under <DEPLOY_ROOT>/releases/<timestamp>-<sha>.
- It runs npm ci on the server, flips the current symlink, restarts the service, and checks health.
EOF
}

SKIP_CHECKS=0
REF="HEAD"
CLI_ENV_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-checks)
      SKIP_CHECKS=1
      shift
      ;;
    --ref)
      REF="${2:-}"
      if [[ -z "$REF" ]]; then
        echo "--ref requires a git ref" >&2
        exit 1
      fi
      shift 2
      ;;
    --env-file)
      CLI_ENV_FILE="${2:-}"
      if [[ -z "$CLI_ENV_FILE" ]]; then
        echo "--env-file requires a path" >&2
        exit 1
      fi
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DEPLOY_ENV_FILE="${CLI_ENV_FILE:-${DEPLOY_ENV_FILE:-$ROOT_DIR/.env.deploy.local}}"
if [[ -n "$DEPLOY_ENV_FILE" && -f "$DEPLOY_ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$DEPLOY_ENV_FILE"
fi

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "$name is required" >&2
    exit 1
  fi
}

require_cmd() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "$name is required" >&2
    exit 1
  fi
}

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/townsquare}"
DEPLOY_SERVICE="${DEPLOY_SERVICE:-townsquare.service}"
DEPLOY_PORT="${DEPLOY_PORT:-8787}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"
SSH_OPTS="${SSH_OPTS:-}"

require_var DEPLOY_HOST
require_var DEPLOY_USER

REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"

require_cmd ssh
require_cmd scp
require_cmd git

if [[ "$SKIP_CHECKS" -ne 1 ]]; then
  echo "== local checks =="
  npm run check
fi

SHA="$(git rev-parse --short "$REF")"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
RELEASE_NAME="${STAMP}-${SHA}"
ARCHIVE="$(mktemp /tmp/townsquare-deploy.XXXXXX.tgz)"
REMOTE_ARCHIVE="/tmp/townsquare-${RELEASE_NAME}.tgz"

cleanup() {
  rm -f "$ARCHIVE"
}
trap cleanup EXIT

echo "== build archive =="
git archive --format=tar.gz --output="$ARCHIVE" "$REF"

echo "== upload archive =="
scp $SSH_OPTS "$ARCHIVE" "$REMOTE:$REMOTE_ARCHIVE"

echo "== remote deploy =="
ssh $SSH_OPTS "$REMOTE" \
  RELEASE_NAME="$RELEASE_NAME" \
  REMOTE_ARCHIVE="$REMOTE_ARCHIVE" \
  DEPLOY_ROOT="$DEPLOY_ROOT" \
  DEPLOY_SERVICE="$DEPLOY_SERVICE" \
  DEPLOY_PORT="$DEPLOY_PORT" \
  'bash -se' <<'EOF'
set -euo pipefail

release_dir="$DEPLOY_ROOT/releases/$RELEASE_NAME"
sudo mkdir -p "$DEPLOY_ROOT/releases"
sudo mkdir "$release_dir"
sudo tar -xzf "$REMOTE_ARCHIVE" -C "$release_dir"
sudo chown -R townsquare:townsquare "$release_dir"
sudo -u townsquare -H bash -lc "cd '$release_dir' && npm ci --omit=dev"
sudo ln -sfn "$release_dir" "$DEPLOY_ROOT/current"
sudo systemctl restart "$DEPLOY_SERVICE"
sudo systemctl --no-pager --full status "$DEPLOY_SERVICE" | sed -n '1,20p'
curl -fsS "http://127.0.0.1:${DEPLOY_PORT}/healthz"
rm -f "$REMOTE_ARCHIVE"
EOF

if [[ -n "$HEALTHCHECK_URL" ]]; then
  echo
  echo "== public health check =="
  curl -fsS "$HEALTHCHECK_URL"
fi

echo
echo "Deploy complete: $RELEASE_NAME"
