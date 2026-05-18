#!/bin/bash
# 산출물 변경사항 추적 — git diff로 어떤 REQ-ID가 변경됐는지 확인

set -e

source project.env 2>/dev/null || true

# git 초기화 확인
if [ ! -d ".git" ]; then
    git init
    git add .
    git commit -m "chore: /init 초기 커밋" --allow-empty 2>/dev/null || true
    echo "git 저장소 초기화 완료"
    exit 0
fi

# 변경된 산출물 파일 확인
CHANGED_DOCS=$(git diff --name-only HEAD -- '*.md' 2>/dev/null | grep -E "^(docs/)?(01_RD|02_RTM|03_SRS|04_SAD|05_DDD)/" || true)

if [ -z "$CHANGED_DOCS" ]; then
    echo "변경된 산출물 없음"
    exit 0
fi

echo "변경된 산출물 파일:"
echo "$CHANGED_DOCS"

# 변경된 REQ-ID 추출
echo ""
echo "영향받는 REQ-ID:"
git diff HEAD -- $CHANGED_DOCS 2>/dev/null | grep "^+.*REQ-[A-Z]-[0-9]" | \
    grep -oE "REQ-[A-Z]+-[0-9]+" | sort -u || echo "(없음)"
