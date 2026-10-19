#!/bin/sh
set -eu

DATA_DIR="${AGENTMEMORY_DATA_DIR:-/data}"
export AGENTMEMORY_DATA_DIR="$DATA_DIR"
export HOME="${HOME:-$DATA_DIR/home}"
export III_COMPOSE_STATE_DIR="${III_COMPOSE_STATE_DIR:-$DATA_DIR/compose-state}"
export III_ENGINE_PORT="${III_ENGINE_PORT:-49134}"
export III_REST_PORT="${III_REST_PORT:-3111}"
export III_VIEWER_PORT="${III_VIEWER_PORT:-3113}"
export III_TELEMETRY_ENABLED="${III_TELEMETRY_ENABLED:-false}"
export AGENTMEMORY_VIEWER_HOST="${AGENTMEMORY_VIEWER_HOST:-0.0.0.0}"
export VIEWER_ALLOWED_HOSTS="${VIEWER_ALLOWED_HOSTS:-localhost:3113,127.0.0.1:3113,[::1]:3113}"
export VIEWER_ALLOWED_ORIGINS="${VIEWER_ALLOWED_ORIGINS:-http://localhost:3113,http://127.0.0.1:3113}"
export MALLOC_ARENA_MAX="${MALLOC_ARENA_MAX:-2}"

mkdir -p "$DATA_DIR"
chown node:node "$DATA_DIR"
for dir in "$HOME" "$III_COMPOSE_STATE_DIR" "$DATA_DIR/config"; do
  mkdir -p "$dir"
  chown node:node "$dir"
  chmod 700 "$dir"
done

current_nofile="$(ulimit -n)"
if [ "$current_nofile" != unlimited ] && [ "$current_nofile" -lt 10240 ]; then
  ulimit -n 10240 2>/dev/null || ulimit -n "$(ulimit -H -n)" 2>/dev/null || true
fi

# Compose owns the 0.24.6 engine and supervises state, http, and agentmemory.
exec gosu node:node /usr/local/bin/iii compose \
  --namespace agentmemory --up --file /opt/agentmemory/worker-compose.yaml
