#!/usr/bin/env bash
# Stand up the live-omnigraph demo as a local filesystem-backed cluster.
#
# omnigraph-server 0.7.0+ is cluster-only (RFC-011): it serves graphs under
# /graphs/{graph_id}/… from a cluster directory. No S3/RustFS needed — the
# graph lives on the local filesystem. This script:
#   1. Builds the omnigraph CLI + server (release) from $OMNIGRAPH_REPO
#      (must be a v0.7.0+ checkout — SDK 0.7.x talks to a 0.7.x server only).
#   2. Materializes a one-graph cluster ("company") under .server-demo/cluster:
#        - `cluster apply` creates the graph from examples/server/company.pg
#        - `load` seeds examples/server/company.jsonl
#   3. Boots omnigraph-server --cluster … --unauthenticated on $SERVER_BIND.
#
# Re-running reuses an existing cluster (preserving any Approve/Reject
# mutations). Delete .server-demo to start fresh.
#
# After this script is done:
#   pnpm tui examples/company-server.notebook.yaml      # TUI (direct, no CORS)
#
#   pnpm --filter @modernrelay/notebook-web dev          # web, then open:
#   http://127.0.0.1:5173/?server=/og&graph=company     # via the Vite /og proxy
#     (omnigraph-server 0.7.0 no longer sets CORS headers, so the browser must
#      talk same-origin; the dev proxy in vite.config.ts forwards /og → :8080.)
#
# This demo runs --unauthenticated (no bearer token / Cedar policy) for
# simplicity. To enable auth, drop --unauthenticated, add a `policies:` block to
# cluster.yaml binding a Cedar bundle to the graph, and boot with
# OMNIGRAPH_SERVER_BEARER_TOKENS_JSON='{"act-demo":"devtoken"}'.

set -euo pipefail

OMNIGRAPH_REPO="${OMNIGRAPH_REPO:-$(cd "$(dirname "$0")/../../omnigraph" 2>/dev/null && pwd || true)}"
UI_REPO="$(cd "$(dirname "$0")/.." && pwd)"

GRAPH_ID="${GRAPH_ID:-company}"
SERVER_BIND="${SERVER_BIND:-127.0.0.1:8080}"
SERVER_URL="http://${SERVER_BIND}"

CLUSTER_DIR="${UI_REPO}/.server-demo/cluster"
SCHEMA_SRC="${UI_REPO}/examples/server/company.pg"
QUERIES_SRC="${UI_REPO}/examples/server/queries"
SEED_SRC="${UI_REPO}/examples/server/company.jsonl"

log() { printf "==> %s\n" "$*"; }
die() { printf "error: %s\n" "$*" >&2; exit 1; }

[ -n "$OMNIGRAPH_REPO" ] && [ -d "$OMNIGRAPH_REPO" ] \
  || die "set OMNIGRAPH_REPO to an omnigraph v0.7.0+ checkout (default ../../omnigraph not found)"

log "Building omnigraph CLI + server (release) from ${OMNIGRAPH_REPO}"
( cd "$OMNIGRAPH_REPO" && cargo build --release --locked -p omnigraph-cli -p omnigraph-server )
OG_BIN="${OMNIGRAPH_REPO}/target/release/omnigraph"
OG_SERVER_BIN="${OMNIGRAPH_REPO}/target/release/omnigraph-server"
log "Using $("$OG_BIN" --version 2>/dev/null || echo omnigraph)"

if [ -f "${CLUSTER_DIR}/__cluster/state.json" ]; then
  log "Reusing existing cluster at ${CLUSTER_DIR} (delete .server-demo to reset)"
else
  log "Materializing fresh cluster at ${CLUSTER_DIR}"
  mkdir -p "$CLUSTER_DIR"
  cp "$SCHEMA_SRC" "${CLUSTER_DIR}/company.pg"
  cp -R "$QUERIES_SRC" "${CLUSTER_DIR}/queries"
  cat > "${CLUSTER_DIR}/cluster.yaml" <<EOF
version: 1
metadata:
  name: ${GRAPH_ID}-demo
state:
  backend: cluster
  lock: true
graphs:
  ${GRAPH_ID}:
    schema: ./company.pg
    queries: ./queries/
EOF
  # validate → import (records initial state) → apply (creates the graph +
  # schema from cluster.yaml). Graphs are born from `cluster apply`, not `init`.
  "$OG_BIN" cluster validate --config "$CLUSTER_DIR"
  "$OG_BIN" cluster import  --config "$CLUSTER_DIR"
  "$OG_BIN" cluster apply   --config "$CLUSTER_DIR"
  log "Seeding ${GRAPH_ID} from company.jsonl"
  "$OG_BIN" load --data "$SEED_SRC" --mode overwrite "${CLUSTER_DIR}/graphs/${GRAPH_ID}.omni"
fi

log "Starting omnigraph-server on ${SERVER_BIND}"
mkdir -p "${UI_REPO}/.server-demo"
SERVER_LOG="${UI_REPO}/.server-demo/omnigraph-server.log"
SERVER_PID_FILE="${UI_REPO}/.server-demo/omnigraph-server.pid"

if [ -f "$SERVER_PID_FILE" ] && kill -0 "$(cat "$SERVER_PID_FILE")" >/dev/null 2>&1; then
  log "Stopping previous server (pid $(cat "$SERVER_PID_FILE"))"
  kill "$(cat "$SERVER_PID_FILE")" || true
  sleep 1
fi

nohup "$OG_SERVER_BIN" --cluster "$CLUSTER_DIR" --bind "$SERVER_BIND" --unauthenticated \
  >"$SERVER_LOG" 2>&1 &
echo "$!" > "$SERVER_PID_FILE"

log "Waiting for /healthz"
for _ in $(seq 1 30); do
  curl -fsSL -m 1 "${SERVER_URL}/healthz" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsSL -m 2 "${SERVER_URL}/healthz" >/dev/null \
  || { tail -50 "$SERVER_LOG" >&2; die "/healthz never responded"; }

cat <<EOF

omnigraph-server live at ${SERVER_URL}  (cluster-only, unauthenticated demo)
  graph:   ${GRAPH_ID}  → reads/writes under ${SERVER_URL}/graphs/${GRAPH_ID}/…
  cluster: ${CLUSTER_DIR}
  log:     ${SERVER_LOG}
  stop:    kill \$(cat ${SERVER_PID_FILE})

Run the TUI:
  pnpm tui examples/company-server.notebook.yaml

Run the web app (same-origin via the Vite /og proxy):
  pnpm --filter @modernrelay/notebook-web dev
  open 'http://127.0.0.1:5173/?server=/og&graph=${GRAPH_ID}'

Probe the persisted clause status (after pressing Approve in the UI):
  curl -s -H "Content-Type: application/json" \\
    -d '{"query":"query x() { match { \$c: PolicyClause { slug: \"pdr-c1\" } } return { \$c.status as status } }"}' \\
    ${SERVER_URL}/graphs/${GRAPH_ID}/query

EOF
