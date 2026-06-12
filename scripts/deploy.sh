#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Deploy the current TownSquare checkout as a new release.

Usage:
  scripts/deploy.sh [--local] [--skip-checks] [--ref <git-ref>] [--env-file <path>] [--help]

Environment variables:
  DEPLOY_MODE           Optional. local or remote. Default: remote.
  DEPLOY_HOST           Required for remote deploys. SSH host or IP.
  DEPLOY_USER           Required for remote deploys. SSH user.
  DEPLOY_ROOT           Optional. Remote app root. Default: /opt/townsquare
  DEPLOY_SERVICE        Optional. systemd service name. Default: townsquare.service
  DEPLOY_PORT           Optional. Local healthcheck port on the server. Default: 8787
  DEPLOY_OWNER          Optional. Release owner. Default: townsquare:townsquare
  HEALTHCHECK_URL       Optional. Public healthcheck URL to verify after deploy.
  SSH_OPTS              Optional. Extra ssh/scp options, e.g. '-o BatchMode=yes'
  DEPLOY_ENV_FILE       Optional. Local env file to source before deploy.

Notes:
- By default the script will source ./.env.deploy.local if it exists.
- Remote mode uses ssh/scp, so it should be run from a machine with access to the server.
- Local mode deploys directly on the current host and may use sudo.
- It creates a timestamped release under <DEPLOY_ROOT>/releases/<timestamp>-<sha>.
- It runs npm ci, flips the current symlink, restarts the service, and checks health.
EOF
}

SKIP_CHECKS=0
REF="HEAD"
CLI_ENV_FILE=""
CLI_DEPLOY_MODE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local)
      CLI_DEPLOY_MODE="local"
      shift
      ;;
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
DEPLOY_OWNER="${DEPLOY_OWNER:-townsquare:townsquare}"
DEPLOY_MODE="${CLI_DEPLOY_MODE:-${DEPLOY_MODE:-remote}}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"
SSH_OPTS="${SSH_OPTS:-}"

require_cmd git

case "$DEPLOY_MODE" in
  local|remote)
    ;;
  *)
    echo "DEPLOY_MODE must be local or remote" >&2
    exit 1
    ;;
esac

if [[ "$DEPLOY_MODE" == "remote" ]]; then
  require_var DEPLOY_HOST
  require_var DEPLOY_USER
  require_cmd ssh
  require_cmd scp
  REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"
fi

if [[ "$SKIP_CHECKS" -ne 1 ]]; then
  echo "== local checks =="
  npm run check
fi

SHA="$(git rev-parse --short "$REF")"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
RELEASE_NAME="${STAMP}-${SHA}"
ARCHIVE="$(mktemp /tmp/townsquare-deploy.XXXXXX.tgz)"

cleanup() {
  rm -f "$ARCHIVE"
}
trap cleanup EXIT

echo "== build archive =="
git archive --format=tar.gz --output="$ARCHIVE" "$REF"

if [[ "$DEPLOY_MODE" == "local" ]]; then
  echo "== local deploy =="
  RELEASE_NAME="$RELEASE_NAME" \
    ARCHIVE="$ARCHIVE" \
    DEPLOY_ROOT="$DEPLOY_ROOT" \
    DEPLOY_SERVICE="$DEPLOY_SERVICE" \
    DEPLOY_PORT="$DEPLOY_PORT" \
    DEPLOY_OWNER="$DEPLOY_OWNER" \
    bash -se <<'EOF'
set -euo pipefail

as_root() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

as_release_user() {
  sudo -u "${DEPLOY_OWNER%%:*}" -H "$@"
}

release_dir="$DEPLOY_ROOT/releases/$RELEASE_NAME"
as_root mkdir -p "$DEPLOY_ROOT/releases"
as_root mkdir "$release_dir"
as_root tar -xzf "$ARCHIVE" -C "$release_dir"
as_root chown -R "$DEPLOY_OWNER" "$release_dir"
as_release_user bash -lc "cd '$release_dir' && npm ci --omit=dev"
as_root ln -sfn "$release_dir" "$DEPLOY_ROOT/current"
as_root systemctl restart "$DEPLOY_SERVICE"
as_root systemctl --no-pager --full status "$DEPLOY_SERVICE" | sed -n '1,20p'
for _ in 1 2 3 4 5; do
  if curl -fsS "http://127.0.0.1:${DEPLOY_PORT}/healthz" >/dev/null 2>&1; then
    echo ok
    exit 0
  fi
  sleep 1
done
curl -fsS "http://127.0.0.1:${DEPLOY_PORT}/healthz"
EOF
else
  REMOTE_ARCHIVE="/tmp/townsquare-${RELEASE_NAME}.tgz"

  echo "== upload archive =="
  scp $SSH_OPTS "$ARCHIVE" "$REMOTE:$REMOTE_ARCHIVE"

  echo "== remote deploy =="
  ssh $SSH_OPTS "$REMOTE" \
    RELEASE_NAME="$RELEASE_NAME" \
    REMOTE_ARCHIVE="$REMOTE_ARCHIVE" \
    DEPLOY_ROOT="$DEPLOY_ROOT" \
    DEPLOY_SERVICE="$DEPLOY_SERVICE" \
    DEPLOY_PORT="$DEPLOY_PORT" \
    DEPLOY_OWNER="$DEPLOY_OWNER" \
    'bash -se' <<'EOF'
set -euo pipefail

release_dir="$DEPLOY_ROOT/releases/$RELEASE_NAME"
sudo mkdir -p "$DEPLOY_ROOT/releases"
sudo mkdir "$release_dir"
sudo tar -xzf "$REMOTE_ARCHIVE" -C "$release_dir"
sudo chown -R "$DEPLOY_OWNER" "$release_dir"
sudo -u "${DEPLOY_OWNER%%:*}" -H bash -lc "cd '$release_dir' && npm ci --omit=dev"
sudo ln -sfn "$release_dir" "$DEPLOY_ROOT/current"
sudo systemctl restart "$DEPLOY_SERVICE"
sudo systemctl --no-pager --full status "$DEPLOY_SERVICE" | sed -n '1,20p'
for _ in 1 2 3 4 5; do
  if curl -fsS "http://127.0.0.1:${DEPLOY_PORT}/healthz" >/dev/null 2>&1; then
    echo ok
    rm -f "$REMOTE_ARCHIVE"
    exit 0
  fi
  sleep 1
done
curl -fsS "http://127.0.0.1:${DEPLOY_PORT}/healthz"
rm -f "$REMOTE_ARCHIVE"
EOF
fi

if [[ -n "$HEALTHCHECK_URL" ]]; then
  echo
  echo "== public health check =="
  curl -fsS "$HEALTHCHECK_URL"
fi

echo
echo "Deploy complete: $RELEASE_NAME"
