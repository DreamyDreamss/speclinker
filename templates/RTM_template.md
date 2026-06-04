---
doc_id: RTM-001
doc_type: 요구사항 추적 매트릭스
version: 1.0
status: draft
created: YYYY-MM-DD
updated: YYYY-MM-DD
project: {프로젝트명}
author: Claude (자동 생성)
linked_docs:
  - RD-001
  - SRS-001
---

# 요구사항 추적 매트릭스 (Requirements Traceability Matrix)

> **문서 목적**: REQ-ID를 공통 키로 설계→코드→테스트 전 체인을 추적한다.  
> **DELTA 활용**: `domain` 컬럼을 기준으로 sl-change가 관련 ID만 선택적으로 로드한다.  
> 스펙 체인: `SR → REQ → SRS → UIS → INF → SCH ← TC ← 코드`

---

## 1. 상태값 범례

| 상태 | 의미 |
|------|------|
| ⬜ 미착수 | 작업 시작 전 |
| 🔄 진행중 | 설계 또는 개발 진행 중 |
| 🧪 테스트중 | 구현 완료, 테스트 진행 중 |
| ✅ 완료 | 테스트 통과, 완전 완료 |
| ❌ 제외 | 범위 제외 또는 취소 |
| 🔁 변경중 | SR에 의해 변경 진행 중 |

---

## 2. 기능 요구사항 추적

> `domain` 컬럼 — sl-change Step 5에서 RTM을 인덱스로 사용할 때 필터 기준.  
> 도메인명은 `docs/05_설계서/{도메인}/` 폴더명과 일치해야 한다.

| domain | REQ-ID | 요구사항명 | SRS-ID | UIS-ID | INF-ID | SCH-ID | TC-ID | SR-ID | 상태 |
|--------|--------|-----------|--------|--------|--------|--------|-------|-------|------|
| auth | [REQ-F-001](../01_요구사항정의서/RD_v1.0.md#REQ-F-001) | | SRS-F-001 | [UIS-F-001](../05_설계서/auth/UI_auth.md#UIS-F-001) | [INF-001](../05_설계서/auth/API_auth.md#INF-001) | [SCH-001](../05_설계서/auth/SCH/SCH-001.md) | TC-F-001 | | ⬜ |
| order | [REQ-F-002](../01_요구사항정의서/RD_v1.0.md#REQ-F-002) | | SRS-F-002 | [UIS-F-002](../05_설계서/order/UI_order.md#UIS-F-002) | [INF-003](../05_설계서/order/API_order.md#INF-003) | | | | ⬜ |

> 파일 링크 규칙:
> - UIS/INF/SCH는 도메인 파일의 `## ID` 앵커로 직접 연결
> - SR-ID는 변경이 발생했을 때 채워진다 (예: `SR-1234`)

---

## 3. 비기능 요구사항 추적

| domain | REQ-ID | 요구사항명 | SRS-ID | INF-ID | 설계 문서 | 측정 방법 | TC-ID | 상태 |
|--------|--------|-----------|--------|--------|----------|----------|-------|------|
| infra | REQ-NF-001 | | SRS-NF-001 | | | 성능 테스트 | TC-NF-001 | ⬜ |

---

## 4. 변경 요구사항 추적 (DELTA)

> SR 한 건 = REQ-C 한 행. sl-change 실행 시 자동 추가된다.

| SR-ID | REQ-ID | 변경 유형 | 변경 요약 | domain | 영향 INF | 영향 SCH | 영향 UIS | 변경일 | 상태 |
|-------|--------|---------|----------|--------|---------|---------|---------|--------|------|
| SR-1234 | REQ-C-001 | API_MODIFY | 로그인 토큰 만료 시간 변경 | auth | INF-001 | | | YYYY-MM-DD | 🔄 |

> 변경 유형: `SCREEN_MODIFY` / `SCREEN_NEW` / `API_MODIFY` / `API_NEW` / `DB_CHANGE` / `BUG_FIX` / `IMPROVEMENT` / `COMPOSITE`

---

## 5. 도메인 색인

> sl-change Step 4에서 도메인 특정 후 이 표로 로드할 파일을 결정한다.

| domain | API 파일 | DB 파일 | UI 파일 | REQ 수 |
|--------|---------|---------|---------|--------|
| auth | [API_auth.md](../05_설계서/auth/API_auth.md) | [DB_auth.md](../05_설계서/auth/DB_auth.md) | [UI_auth.md](../05_설계서/auth/UI_auth.md) | 0 |
| order | [API_order.md](../05_설계서/order/API_order.md) | [DB_order.md](../05_설계서/order/DB_order.md) | [UI_order.md](../05_설계서/order/UI_order.md) | 0 |

---

## 6. 커버리지 요약

| 구분 | 전체 | 완료 | 진행중 | 미착수 | 완료율 |
|------|------|------|--------|--------|--------|
| 기능 요구사항 | 0 | 0 | 0 | 0 | 0% |
| 비기능 요구사항 | 0 | 0 | 0 | 0 | 0% |
| 변경 요구사항(SR) | 0 | 0 | 0 | 0 | 0% |
| **전체** | **0** | **0** | **0** | **0** | **0%** |

---

## 7. 변경 이력

| 버전 | 날짜 | 변경 내용 | SR-ID | 작성자 |
|------|------|----------|-------|--------|
| 1.0 | YYYY-MM-DD | 최초 생성 | | Claude |
