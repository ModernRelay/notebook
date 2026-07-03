#!/usr/bin/env bash
# Clean-slate bring-up of the mutation-demo graph on local RustFS (S3) + Omnigraph 0.7.
#
# A RustFS-backed sibling of scripts/server-demo.sh (which uses a filesystem cluster).
# The only structural difference is cluster.yaml's `storage: s3://…` line; there are
# no embeddings, so the concept-graph's embed step is dropped.
#
# Idempotent: wipes only this cluster's S3 prefix and rebuilds from the declarative
# config (schema.pg, cluster.yaml, queries/, seed.jsonl).
# Prereqs: RustFS running on 127.0.0.1:9000, omnigraph 0.7 on PATH.
#
#   ./scripts/server-demo-s3.sh           # rebuild the cluster + load seed
#   ./scripts/server-demo-s3.sh --serve   # rebuild, then start the HTTP server on :8090
set -euo pipefail
cd "$(dirname "$0")/../examples/mutation-demo"

OG=${OG:-omnigraph}
set -a && source ./.env.omni && set +a

BUCKET=omnigraph-local
PREFIX=clusters/mutation-demo
STORE="s3://$BUCKET/$PREFIX/graphs/tasks.omni"
S3="aws --endpoint-url $AWS_ENDPOINT_URL_S3 s3"
PORT=${PORT:-8090}

echo "▸ 1/5  ensure bucket"
$S3 mb "s3://$BUCKET" 2>/dev/null || true

echo "▸ 2/5  WIPE old state (clean slate — only this cluster's prefix)"
$S3 rm --recursive "s3://$BUCKET/$PREFIX" 2>/dev/null || true

echo "▸ 3/5  cluster validate → import → apply  (creates graph + schema + queries)"
$OG cluster validate --config .
$OG cluster import   --config . --as andrew 2>/dev/null || true
$OG cluster apply    --config . --as andrew

echo "▸ 4/5  load seed"
$OG load --data ./seed.jsonl --mode overwrite --yes --store "$STORE"

echo "▸ 5/5  verify"
$OG snapshot --store "$STORE" | grep -E 'node:|edge:' || true

echo "✓ mutation-demo ready  ($STORE)"
echo "  NOTE: a direct-store load bypasses a running server's table handles —"
echo "        if omnigraph-server is already serving :$PORT, restart it now or"
echo "        edge traversals will read stale (pre-load) versions."
if [ "${1:-}" = "--serve" ]; then
  echo "▸ starting server on 127.0.0.1:$PORT …"
  exec "$OG-server" --cluster . --bind "127.0.0.1:$PORT" --unauthenticated
else
  echo "  serve with:  omnigraph-server --cluster examples/mutation-demo --bind 127.0.0.1:$PORT --unauthenticated"
fi
