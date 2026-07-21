#!/usr/bin/env bash
set -euo pipefail
BASE=${BASE:-http://localhost:3000}
MODEL=${SMOKE_MODEL:-llama3.1}
JAR=$(mktemp)
curl -sf -c "$JAR" -X POST "$BASE/api/auth/sign-up/email" -H 'content-type: application/json' \
  -d '{"email":"smoke@local.test","password":"smoke-pass-123","name":"smoke"}' >/dev/null || true
curl -sf -b "$JAR" -c "$JAR" -X POST "$BASE/api/auth/sign-in/email" -H 'content-type: application/json' \
  -d '{"email":"smoke@local.test","password":"smoke-pass-123"}' >/dev/null
P=$(curl -sf -b "$JAR" -X POST "$BASE/api/projects" -d '{"name":"smoke"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
A=$(curl -sf -b "$JAR" -X POST "$BASE/api/projects/$P/agents" -d '{"name":"a","provider":"openai-compatible","model":"'"$MODEL"'"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
R=$(curl -sf -b "$JAR" -X POST "$BASE/api/agents/$A/runs" -d '{"input":"say hi"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
echo "run: $R — streaming:"
STREAM=$(curl -sN -m 300 -b "$JAR" "$BASE/api/runs/$R/stream")
echo "$STREAM" | head -20
echo "$STREAM" | grep -q '"status":"done"' || { echo "SMOKE FAILED: run did not reach done"; exit 1; }
echo "SMOKE OK"

# --- Gated-tool scenario (needs a tool-capable model; enable with SMOKE_TOOLS=1) ---
if [ "${SMOKE_TOOLS:-0}" = "1" ]; then
  curl -sf -b "$JAR" -X POST "$BASE/api/projects/$P/policies" -d '{"toolMatch":"http.*","effect":"require_approval","priority":10}' >/dev/null
  curl -sf -b "$JAR" -X POST "$BASE/api/projects/$P/policies" -d '{"toolMatch":"*","effect":"allow","priority":0}' >/dev/null
  GR=$(curl -sf -b "$JAR" -X POST "$BASE/api/agents/$A/runs" -d '{"input":"Use the http.fetch tool to fetch https://example.com and tell me the HTTP status. You must call the tool."}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
  echo "gated run: $GR — waiting for awaiting_approval"
  for i in $(seq 1 60); do
    ST=$(curl -sf -b "$JAR" "$BASE/api/runs/$GR" | python3 -c 'import sys,json;print(json.load(sys.stdin)["status"])')
    [ "$ST" = "awaiting_approval" ] && break
    [ "$ST" = "failed" ] && { echo "SMOKE FAILED: gated run failed before approval"; exit 1; }
    [ "$ST" = "done" ] && { echo "SMOKE FAILED: gated run finished without approval (policy not enforced!)"; exit 1; }
    sleep 2
  done
  [ "$ST" = "awaiting_approval" ] || { echo "SMOKE FAILED: never suspended (status=$ST)"; exit 1; }
  AP=$(curl -sf -b "$JAR" "$BASE/api/approvals" | python3 -c 'import sys,json;a=[x for x in json.load(sys.stdin) if x["runId"]=="'"$GR"'"];print(a[0]["id"])')
  echo "approving $AP"
  curl -sf -b "$JAR" -X POST "$BASE/api/approvals/$AP" -d '{"decision":"approved"}' >/dev/null
  for i in $(seq 1 60); do
    ST=$(curl -sf -b "$JAR" "$BASE/api/runs/$GR" | python3 -c 'import sys,json;print(json.load(sys.stdin)["status"])')
    [ "$ST" = "done" ] && break
    [ "$ST" = "failed" ] && { echo "SMOKE FAILED: gated run failed after approval"; exit 1; }
    sleep 2
  done
  [ "$ST" = "done" ] || { echo "SMOKE FAILED: gated run stuck (status=$ST)"; exit 1; }
  echo "GATED SMOKE OK"
fi
