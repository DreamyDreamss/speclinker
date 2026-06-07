#!/bin/bash
# TC 실행 및 결과 집계

set -e

source project.env 2>/dev/null || true

RESULTS_FILE="docs/08_테스트결과보고서/test_results_$(date +%Y%m%d_%H%M%S).txt"
mkdir -p docs/08_테스트결과보고서

echo "테스트 실행 시작: $(date)" | tee "$RESULTS_FILE"
echo "MODE: $MODE | PROJECT: $PROJECT_NAME" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

PASS=0
FAIL=0
SKIP=0

# 단위 테스트 실행 (언어별 자동 감지)
if [ -f "pom.xml" ]; then
    echo "Maven 단위 테스트 실행..." | tee -a "$RESULTS_FILE"
    mvn test 2>&1 | tail -20 | tee -a "$RESULTS_FILE"
    [ $? -eq 0 ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))

elif [ -f "package.json" ]; then
    echo "npm 테스트 실행..." | tee -a "$RESULTS_FILE"
    npm test 2>&1 | tail -20 | tee -a "$RESULTS_FILE"
    [ $? -eq 0 ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))

elif [ -f "requirements.txt" ] || [ -f "pyproject.toml" ]; then
    echo "pytest 실행..." | tee -a "$RESULTS_FILE"
    python -m pytest -v 2>&1 | tail -30 | tee -a "$RESULTS_FILE"
    [ $? -eq 0 ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))

elif [ -f "go.mod" ]; then
    echo "Go 테스트 실행..." | tee -a "$RESULTS_FILE"
    go test ./... 2>&1 | tail -20 | tee -a "$RESULTS_FILE"
    [ $? -eq 0 ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))

else
    echo "테스트 프레임워크를 감지할 수 없습니다." | tee -a "$RESULTS_FILE"
    echo "실제 소스 트리(SOURCE_*_PATH)의 테스트를 수동으로 실행하세요." | tee -a "$RESULTS_FILE"
    SKIP=$((SKIP+1))
fi

echo "" | tee -a "$RESULTS_FILE"
echo "=== 테스트 결과 요약 ===" | tee -a "$RESULTS_FILE"
echo "통과: $PASS | 실패: $FAIL | 건너뜀: $SKIP" | tee -a "$RESULTS_FILE"
echo "결과 파일: $RESULTS_FILE"
