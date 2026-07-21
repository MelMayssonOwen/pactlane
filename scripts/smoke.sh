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
