#!/usr/bin/env bash
# Compatibility entry point for the single Rack installer and owner.
set -euo pipefail
cd "$(dirname "$0")"
node rack.mjs install
exec node rack.mjs up
