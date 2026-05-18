#!/usr/bin/env bash
# Speclinker: knowledge-graph + 스펙 + linked-req-cache → si-graph.json (단일 진입점)
# 사용: bash finalize_si_graph.sh [프로젝트-루트]
# 기본값: 현재 디렉터리

set -e
ROOT="$(cd "${1:-.}" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/ua_req_bridge.js" "$ROOT"
