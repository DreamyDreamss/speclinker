#!/bin/bash
# 환경 자동 감지 — MODE(SI-A/SI-B/ITO-ASIS/ITO-SDD) + NETWORK(open/closed) 결정

set -e

HAS_CODE=false
HAS_DOCS=false
NETWORK=closed
PROJECT_DIR="${1:-.}"

cd "$PROJECT_DIR"

# 소스코드 존재 확인
if find . \( -name "*.java" -o -name "*.py" -o -name "*.ts" -o -name "*.go" -o -name "*.js" \) \
   -not -path "./.git/*" -not -path "./node_modules/*" 2>/dev/null | head -1 | grep -q .; then
    HAS_CODE=true
fi
if [ -d "src" ] || [ -d "app" ] || [ -d "lib" ]; then
    HAS_CODE=true
fi

# 기존 산출물 존재 확인
if [ -f "docs/01_요구사항정의서/RD_v1.0.md" ] || [ -f "01_RD/RD_v1.0.md" ] || [ -f "docs/specs/RD_v1.0.md" ] || \
   [ -f "docs/02_추적표/RTM_v1.0.md" ] || [ -f "02_RTM/RTM_v1.0.md" ] || [ -f "docs/03_기능명세서/SRS_v1.0.md" ] || [ -f "03_SRS/SRS_v1.0.md" ]; then
    HAS_DOCS=true
fi

# 네트워크 연결 확인 (Atlassian Cloud 접근 가능 여부)
if curl -s --max-time 5 "https://api.atlassian.com" > /dev/null 2>&1; then
    NETWORK=open
fi

# 모드 결정
if [ "$HAS_CODE" = false ] && [ "$HAS_DOCS" = false ]; then
    MODE="SI-A"  # 신규 SI — 순방향
elif [ "$HAS_CODE" = true ] && [ "$HAS_DOCS" = false ]; then
    # ITO 운영 지표 확인 (ops 폴더, Incident 파일, 운영 키워드)
    if [ -d "docs/ops" ] || [ -d "ops" ] || \
       find . -name "Incident*" 2>/dev/null | head -1 | grep -q .; then
        MODE="ITO-ASIS"  # ITO 운영 — ASIS 뽑기
    else
        MODE="SI-B"  # 레거시 SI — 역방향
    fi
elif [ "$HAS_CODE" = true ] && [ "$HAS_DOCS" = true ]; then
    MODE="ITO-SDD"  # 기존 산출물 있음 — SDD 적용
else
    MODE="SI-A"
fi

# project.env 저장
cat > project.env << EOF
MODE=$MODE
NETWORK=$NETWORK
HAS_CODE=$HAS_CODE
HAS_DOCS=$HAS_DOCS
PROJECT_NAME=$(basename "$(pwd)")
AUTHOR=Claude
CREATED=$(date +%Y-%m-%d)
EOF

echo "감지 결과: MODE=$MODE | NETWORK=$NETWORK | HAS_CODE=$HAS_CODE | HAS_DOCS=$HAS_DOCS"
echo "project.env 저장 완료"
