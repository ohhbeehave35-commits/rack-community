#!/usr/bin/env bash
# Start the Rack Community engine (API + actor) and the panel on this machine. Linux, Node 24, Python 3.
# Everything listens on 127.0.0.1 only. Stop it with Ctrl+C.
set -euo pipefail
cd "$(dirname "$0")"
RACK_DIR="${RACK_DIR:-$HOME/rack}"
API_PORT="${RACK_API_PORT:-8797}"
PANEL_PORT="${RACK_PANEL_PORT:-8080}"

mkdir -p "$RACK_DIR"
for f in recipes samples; do [ -e "$RACK_DIR/$f" ] || cp -r "engine/$f" "$RACK_DIR/$f"; done
[ -e "$RACK_DIR/peaks.conf" ] || cp engine/peaks.conf "$RACK_DIR/peaks.conf"
if [ ! -s "$RACK_DIR/.token" ]; then
  (umask 077; head -c 24 /dev/urandom | base64 | tr -d '/+=' > "$RACK_DIR/.token")
fi
export RACK_DIR RACK_TOKEN="$(cat "$RACK_DIR/.token")"

if [ ! -x "$RACK_DIR/venv/bin/python" ]; then python3 -m venv "$RACK_DIR/venv"; fi
"$RACK_DIR/venv/bin/pip" install --quiet -r engine/requirements.txt
[ -d panel/node_modules ] || (cd panel && npm install --no-audit --no-fund)

# Ctrl+C or any exit stops all three processes this script started.
trap 'trap - EXIT INT TERM; pkill -P $$ 2>/dev/null || true' EXIT INT TERM
(cd engine && exec "$RACK_DIR/venv/bin/uvicorn" rack_api:app --host 127.0.0.1 --port "$API_PORT" --log-level warning) &
(cd engine && exec "$RACK_DIR/venv/bin/python" rack_actor.py) &
(cd panel && VITE_RACK_API_BASE="http://127.0.0.1:$API_PORT" exec npx vite dev --host 127.0.0.1 --port "$PANEL_PORT") &

echo
echo "Rack Community is starting."
echo "  Panel:  http://127.0.0.1:$PANEL_PORT"
echo "  Token:  paste the contents of $RACK_DIR/.token into 'Unlock controls'"
echo "  It starts in dry-run; switch to LIVE in Controls when you are ready."
wait
