#!/bin/bash
# Jira MCP 연동 — REQ-ID를 Jira Epic/Story로 자동 등록 (오픈망 전용)

set -e

source project.env 2>/dev/null || true

if [ "$NETWORK" != "open" ]; then
    echo "폐쇄망 환경: Jira 연동 건너뜀. 로컬 산출물만 생성됩니다."
    exit 0
fi

RD_FILE="${1:-docs/01_요구사항정의서/RD_v1.0.md}"

if [ ! -f "$RD_FILE" ]; then
    echo "오류: RD 파일을 찾을 수 없습니다: $RD_FILE"
    exit 1
fi

# REQ-ID 목록 추출
REQ_IDS=$(grep -oE "REQ-F-[0-9]+" "$RD_FILE" | sort -u)

echo "Jira 연동 대상 REQ-ID 목록:"
echo "$REQ_IDS"
echo ""
echo "Jira MCP를 통해 아래 작업을 수행하세요 (오픈망):"
echo "1. use_mcp_tool mcp-atlassian jira_create_issue:"
echo "   - project: $PROJECT_NAME"
echo "   - issuetype: Epic"
echo "   - summary: [REQ-ID] 요구사항명"
echo ""
echo "폐쇄망 대안: acli 스크립트 또는 수동 등록"

cat << 'JIRA_GUIDE'
## Jira MCP 연동 방법

Claude Code에서 mcp-atlassian이 설정된 경우:
- 위 REQ-ID 목록을 기반으로 Jira Epic을 자동 생성합니다
- 각 Epic에 Story를 SRS-ID로 연결합니다
- RTM의 Jira 링크 컬럼이 자동 업데이트됩니다

MCP 설치: `claude mcp add mcp-atlassian -- uvx mcp-atlassian`
JIRA_GUIDE
