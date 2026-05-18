#!/bin/bash
# 내장 UA 브리지로 si-graph.json 갱신
# knowledge-graph.json 재생성은 Claude 에이전트가 담당 (shell에서 불가)
# 이 스크립트는 linked_req 스캔 + si-graph 병합만 수행한다

set -e

PROJECT_ROOT="${1:-.}"
PLUGIN_DIR="$(dirname "$0")/../.."

echo "=== REQ-ID 스캔 ==="
bash "$PLUGIN_DIR/scripts/req_scan.sh" "$PROJECT_ROOT"

echo ""
echo "=== si-graph.json 갱신 ==="
node "$PLUGIN_DIR/scripts/ua_req_bridge.js" "$PROJECT_ROOT"

echo ""
echo "완료. knowledge-graph.json 재생성이 필요하면 /sl-spec --sad 를 실행하세요."
