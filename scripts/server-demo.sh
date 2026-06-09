#!/usr/bin/env bash
# Stand up the live-omnigraph demo backed by native RustFS:
#   1. Verify RustFS is reachable at $AWS_ENDPOINT_URL.
#   2. Ensure the bucket exists.
#   3. Init the repo with company.pg + load company.jsonl (idempotent —
#      skips if a repo already exists at the prefix).
#   4. Start omnigraph-server on $SERVER_BIND with bearer auth.
#
# Pre-reqs (start once, leave running):
#   nohup env RUSTFS_ACCESS_KEY=rustfsadmin RUSTFS_SECRET_KEY=rustfsadmin \
#     rustfs server --address 127.0.0.1:9000 --console-address 127.0.0.1:9001 \
#     ~/.omnigraph-rustfs/data > ~/.omnigraph-rustfs/rustfs.log 2>&1 &
#   disown
#
# After this script is done:
#   OMNIGRAPH_TOKEN=devtoken pnpm tui examples/company-server.notebook.yaml

set -euo pipefail

OMNIGRAPH_REPO="${OMNIGRAPH_REPO:-$(cd "$(dirname "$0")/../../omnigraph" && pwd)}"
UI_REPO="$(cd "$(dirname "$0")/.." && pwd)"

BUCKET="${BUCKET:-omnigraph-local}"
PREFIX="${PREFIX:-repos/ui-server-demo}"
REPO_URI="s3://${BUCKET}/${PREFIX}"
SERVER_BIND="${SERVER_BIND:-127.0.0.1:8080}"
SERVER_URL="http://${SERVER_BIND}"
TOKEN="${OMNIGRAPH_TOKEN:-devtoken}"

export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-rustfsadmin}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-rustfsadmin}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-$AWS_REGION}"
export AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://127.0.0.1:9000}"
export AWS_ENDPOINT_URL_S3="${AWS_ENDPOINT_URL_S3:-$AWS_ENDPOINT_URL}"
export AWS_ENDPOINT="${AWS_ENDPOINT:-$AWS_ENDPOINT_URL}"
export AWS_ALLOW_HTTP="${AWS_ALLOW_HTTP:-true}"
export AWS_S3_FORCE_PATH_STYLE="${AWS_S3_FORCE_PATH_STYLE:-true}"
export AWS_VIRTUAL_HOSTED_STYLE_REQUEST="${AWS_VIRTUAL_HOSTED_STYLE_REQUEST:-false}"

log() { printf "==> %s\n" "$*"; }
die() { printf "error: %s\n" "$*" >&2; exit 1; }

command -v aws >/dev/null || die "aws cli not found on PATH"

log "Checking RustFS at ${AWS_ENDPOINT_URL_S3}"
RFS_STATUS="$(curl -sS -o /dev/null -m 2 -w '%{http_code}' "${AWS_ENDPOINT_URL_S3}/" 2>/dev/null || echo 000)"
[ "$RFS_STATUS" != "000" ] || die "RustFS unreachable at ${AWS_ENDPOINT_URL_S3} — start it before running this script"

log "Building omnigraph CLI + server (release)"
( cd "$OMNIGRAPH_REPO" && cargo build --release --locked -p omnigraph-cli -p omnigraph-server )
OG_BIN="${OMNIGRAPH_REPO}/target/release/omnigraph"
OG_SERVER_BIN="${OMNIGRAPH_REPO}/target/release/omnigraph-server"

log "Ensuring bucket ${BUCKET}"
AWS_DEFAULT_S3_ADDRESSING_STYLE=path \
  aws --endpoint-url "${AWS_ENDPOINT_URL_S3}" \
  s3api create-bucket --bucket "${BUCKET}" >/dev/null 2>&1 || true

if "$OG_BIN" snapshot "${REPO_URI}" --json >/dev/null 2>&1; then
  log "Reusing existing repo at ${REPO_URI}"
else
  log "Initializing fresh repo at ${REPO_URI}"
  "$OG_BIN" init --schema "${UI_REPO}/examples/server/company.pg" "${REPO_URI}"
  log "Loading company seed data"
  "$OG_BIN" load --data "${UI_REPO}/examples/server/company.jsonl" "${REPO_URI}"
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

OMNIGRAPH_SERVER_BEARER_TOKEN="$TOKEN" \
OMNIGRAPH_SERVER_CORS_ORIGIN="${OMNIGRAPH_SERVER_CORS_ORIGIN:-http://127.0.0.1:5173}" \
  nohup "$OG_SERVER_BIN" "${REPO_URI}" --bind "${SERVER_BIND}" \
  >"$SERVER_LOG" 2>&1 &
echo "$!" > "$SERVER_PID_FILE"

log "Waiting for /healthz"
for _ in $(seq 1 30); do
  if curl -fsSL -m 1 "${SERVER_URL}/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsSL -m 2 "${SERVER_URL}/healthz" >/dev/null \
  || { tail -50 "$SERVER_LOG" >&2; die "/healthz never responded"; }

cat <<EOF

omnigraph-server live at ${SERVER_URL}
  bearer token: ${TOKEN}
  repo:         ${REPO_URI}
  log:          ${SERVER_LOG}
  stop:         kill \$(cat ${SERVER_PID_FILE})

Run the TUI:
  OMNIGRAPH_TOKEN=${TOKEN} pnpm tui examples/company-server.notebook.yaml

Probe the persisted clause status (after pressing Approve in the TUI):
  curl -s -H "Authorization: Bearer ${TOKEN}" \\
    -H "Content-Type: application/json" \\
    -d '{"query":"query x() { match { \$c: PolicyClause { id: \"pdr-c1\" } } return { \$c.status as status } }"}' \\
    ${SERVER_URL}/query

EOF
