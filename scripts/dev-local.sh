#!/usr/bin/env bash
#
# Start TownSquare locally with the Plus plugins enabled.
#
#   ./scripts/dev-local.sh
#
# Env overrides:
#   TOWNSQUARE_PRO_DIR  Path to the townsquare-pro checkout (default: ../townsquare-pro)
#   PORT                Port to listen on (default: 8788)
#
set -euo pipefail

CORE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRO_DIR="${TOWNSQUARE_PRO_DIR:-$(cd "$CORE_DIR/../townsquare-pro" 2>/dev/null && pwd || true)}"
# Capture the desired port before sourcing .env, so .env can't override it.
DESIRED_PORT="${PORT:-8788}"

if [ -z "$PRO_DIR" ] || [ ! -f "$PRO_DIR/bootstrap.js" ]; then
  echo "error: townsquare-pro not found at ${PRO_DIR:-../townsquare-pro}" >&2
  echo "       set TOWNSQUARE_PRO_DIR to your townsquare-pro checkout." >&2
  exit 1
fi

# 1. Load the core .env (the server has no dotenv of its own).
if [ -f "$CORE_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$CORE_DIR/.env"
  set +a
  echo "loaded env from $CORE_DIR/.env"
fi

# 2. Force our port (wins over .env) and point the core at the plugin assets so
#    it serves them as a fallback overlay (no symlink needed).
export PORT="$DESIRED_PORT"
export TOWNSQUARE_CORE_DIR="$CORE_DIR"
export TOWNSQUARE_PLUGIN_ASSETS_DIR="$PRO_DIR/public"
echo "plugin assets: $TOWNSQUARE_PLUGIN_ASSETS_DIR"

# Remove the old dev symlink if a previous run created one.
if [ -L "$CORE_DIR/public/plus" ]; then
  rm "$CORE_DIR/public/plus"
  echo "removed stale symlink $CORE_DIR/public/plus"
fi

# 3. Make sure the port is free (don't clobber another server).
if lsof -ti ":$PORT" >/dev/null 2>&1; then
  echo "error: port $PORT is already in use. Set PORT=<other> or stop that process." >&2
  exit 1
fi

echo "starting TownSquare Plus on http://localhost:$PORT"
echo "  service-admin: http://localhost:$PORT/service-admin"
echo "  admin:         http://localhost:$PORT/admin"
echo
cd "$PRO_DIR"
exec npm start
