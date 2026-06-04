#!/bin/bash
# 프로젝트 산출물 디렉토리 구조 생성

set -e

source project.env

mkdir -p docs/00_입력자료 \
         docs/02_추적표 \
         docs/03_기능명세서 docs/03_기능명세서/srs \
         docs/04_아키텍처설계서 \
         docs/05_설계서 docs/05_설계서/screens \
         docs/07_테스트케이스 \
         docs/08_테스트결과보고서 \
         06_소스코드/src 06_소스코드/tests 06_소스코드/reviews

echo "디렉토리 생성 완료"

cat > README_DIRS.md << EOF
# 프로젝트 산출물 구조

| 폴더 | 역할 |
|------|------|
| docs/00_입력자료/ | 기획 문서·인터뷰·회의록 원본 (sl-spec 입력) |
| docs/02_추적표/ | FUNC 추적 매트릭스 (RTM, FUNC 기반) |
| docs/03_기능명세서/ | 기능 명세서 (SRS_v1.0.md) |
| docs/03_기능명세서/srs/ | 도메인별 SRS 분리 파일 |
| docs/04_아키텍처설계서/ | 시스템 아키텍처 설계서 |
| docs/05_설계서/ | 상세 설계서 (API_Design.md, DB_Schema.md, UI_Spec.md) |
| docs/05_설계서/screens/ | 화면별 UI 명세 개별 파일 |
| docs/07_테스트케이스/ | 테스트 케이스 명세서 |
| docs/08_테스트결과보고서/ | 테스트 결과 보고서 |
| 06_소스코드/src/ | 프로덕션 소스코드 |
| 06_소스코드/tests/ | 단위 테스트 |
| 06_소스코드/reviews/ | 코드 리뷰 결과 (sl-dev --review) |

생성일: $CREATED | 작성자: Claude
EOF

echo "README_DIRS.md 생성 완료"
