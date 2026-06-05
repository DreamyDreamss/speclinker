# product 도메인 개요 (신규자·신규요건 분석용)

> 사람용 SOP 레이어. 기계용 인덱스(INF/SCH frontmatter·앵커)와 분리된 개념 설명이다.

## 목적
상품 등록·변경·조회·승인, 가격, 팝업, 리뷰, 표준정보, 계약상담, 프로모션 관리

## 핵심 엔티티 (사용 빈도순 — 이 테이블부터 이해)

- **PRD_PC_APP_D** (1개 기능에서 사용) → SCH-PRD-012
- **PRD_PRD_M** (1개 기능에서 사용) → SCH-PRD-015
- **PRD_MD_M** (1개 기능에서 사용) → SCH-PRD-010
- **PRD_DLR_M** (1개 기능에서 사용) → SCH-PRD-008
- **PRD_CLS_M** (1개 기능에서 사용) → SCH-PRD-007
- **JT_CODE** (1개 기능에서 사용) → SCH-PRD-003
- **PRD_BRND_M** (1개 기능에서 사용) → SCH-PRD-006
- **PRD_PC_APP_CNSL_D** (1개 기능에서 사용) → SCH-PRD-011

## 대표 화면 (1개) — 화면으로 이해

> 이 시스템은 화면으로 이해한다. 각 화면이 무슨 API를 호출하는지로 동작을 파악.

- **상품등록폼** `/app/product/appreg/pr301mForm` — 연결 API 미확인(캡처 보강 필요) [UIS-PRD-001](docs/05_설계서/product/UIS/pr301mForm/spec.md)

## 대표 기능 (1개 중 진입점)

- POST `/product/appreg/pr301mAppList` — [INF-PRD-001](INF/INF-PRD-001.md)

## 신규자 진입점
1. **대표 화면**부터: 화면 1~2개를 열어 "무슨 버튼→무슨 API→무슨 결과"(UIS §5) 파악
2. **핵심 엔티티** 상위 2~3개의 SCH(DB_product.md)로 데이터 구조 파악
3. **대표 기능** INF 1~2개로 요청/응답·비즈니스 규칙 확인
4. 변경 시 `/sl-change`가 영향슬라이스+소스앵커로 정밀 그라운딩

