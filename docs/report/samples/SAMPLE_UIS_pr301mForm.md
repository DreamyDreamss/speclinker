---
화면ID: pr301mForm
화면명: 상품등록폼
라우트: /app/product/appreg/pr301mForm
도메인: product
req-f: "[TBD]"
UIS-ID: UIS-PRD-001
revision_history:
  - version: 1.0
    date: 2026-06-05
    author: ddd-ui-agent (capture.js + generate_uis_spec.py)
    change: 최초 자동 생성 (capture.js auto-annotate 0탭 기반)
---

# UIS-PRD-001: 상품등록폼

> **UIS-ID:** UIS-PRD-001 | **API:** [TBD] | **DB:** [TBD]

**근거 소스:**
- 실서비스 캡처 — `https://office-t.kshop.co.kr/app/product/appreg/pr301mForm`
- 탭 0개 자동 발견·캡처


## 0. 화면 미리보기

> 아래 이미지의 원 안 번호는 4 위젯 표의 번호와 1:1 대응. 탭별 상세는 4에서 확인.

![[preview.png]]

## 1. 화면 기본 정보

| 항목 | 내용 |
|------|------|
| 화면 ID | pr301mForm |
| 화면명 | 상품등록폼 |
| 라우트 | `/app/product/appreg/pr301mForm` |
| 도메인 | product |
| 화면 유형 | 주화면 (Master + Detail 다탭) |
| 접근 권한 | [TBD — 소스 분석 필요] |
| 진입 조건 | [TBD] |


## 2. 와이어프레임 + 디스크립션 마커

> 각 탭의 `_annotated.png`가 곧 2 와이어프레임 역할.
> 마커 번호 `N` = 4 위젯 표의 `번호` 컬럼과 1:1 매칭.
> ASCII 와이어프레임은 생략 (실제 캡처가 더 정확).


## 3. 블록 정의

| 블록 ID | 번호 | 설명 | 소스 컴포넌트 |
|--------|------|------|------------|
| BL-01 | - | 상단 헤더 (탭·검색조건) | [TBD] |
| BL-02 | - | 좌측 목록 그리드 | [TBD] |
| BL-03 | - | 우측 상세 폼 (탭 본문) | [TBD] |
| BL-04 | - | 하단 액션 영역 | [TBD] |


## 4. 위젯 정의

> auto-annotate가 자동 발견한 button·input·select·a. `[TBD]` 항목은 사람이 보완.

## 5. 인터랙션 이벤트 매핑

> capture.js가 dump한 `api_hints`/`handler_calls` + INF-{도메인} 디렉토리 매칭으로 자동 채움.
> 매칭 안 된 항목은 path만 표시 + `[매칭 INF 없음]`.

| 이벤트 | 트리거 위젯 | 전이 상태 | API 호출 | 성공 시 UI | HTTP 코드 | 도메인 에러 | 화면 메시지 | 후속 행동 |
|--------|-----------|---------|---------|----------|---------|----------|----------|---------|
| 페이지 진입 | route mount | ST-01 | [TBD] | ST-03 | - | - | - | - |


## 6. 화면 상태 정의

| 상태 ID | 상태명 | 진입 조건 | UI 표현 | 와이어프레임 |
|--------|--------|---------|--------|-----------|
| ST-01 | 초기 | 페이지 첫 로드 | 빈 폼, 그리드 비어있음 | 2 |
| ST-02 | 로딩중 | API 요청 중 | 액션 버튼 비활성 + 로딩 오버레이 | 2 |
| ST-03 | 정상 | 응답 성공 | 데이터 표시 | 2 |
| ST-04 | 빈 결과 | API 200, 데이터 0건 | "조회된 결과가 없습니다" | 2 |
| ST-05 | 오류 | API 4xx/5xx | 에러 메시지 alert | 2 |


## 7. 화면 전환

```mermaid
flowchart LR
  THIS[UIS-PRD-001 상품등록폼]
  THIS -->|[TBD]| NEXT1[UIS-F-XXX 다음화면]
```

| 이벤트 / 조건 | 이동 대상 | 대상 UIS-ID | 전달값 |
|-------------|----------|-----------|--------|
| [TBD] | [TBD] | UIS-F-XXX | - |


## 8. 조건부 렌더링 (권한·상태)

> capture.js가 dump한 DOM 신호(disabled / hidden / aria-hidden / v-if / data-role 등)만 표시.
> 정적 분석 한계 — 변수 기반 조건은 [TBD]로 두고 사람·LLM 보완 필요.

| 조건/신호 | 영향 위젯 | 숨김/비활성 | 비고 |
|----------|----------|------------|------|
| [TBD — 정적 분석 신호 없음] | [TBD] | [TBD] | 사람 보완 필요 |


## 9. 미확인 사항

- 4 `disabled_when` — DOM 신호(disabled/v-if/aria-hidden 등)는 자동, 변수 기반 동적 조건은 사람·LLM 보완
- 4 `연결 API` — `api_hints` 매칭 안 된 항목(`[매칭 INF 없음]` 표시): handler 함수 안에서 동적 URL 생성하는 경우 — 사람 보완
- 3 블록 정의의 실제 영역 분할 — 사람 검수 (capture.js auto-annotate 보강 가능)
- 7 화면 전환의 실제 다음 화면 — RTM 매핑 후
- 8 조건부 렌더링 — DOM 정적 신호 외 변수 기반 조건은 사람·LLM 보완

---

> 자동 생성 도구 (Phase 6.4 U6~U11 완비):
> - 캡처: `capture.js --tabs=auto --auto-annotate` (DOM 메타 11종 + api_hints + condition_hints dump)
> - spec.md: `generate_uis_spec.py` (4 풀자동 + 5 INF cross-link + 8 조건 신호 자동)
> - INF cross-link 매칭률은 5 표에서 `[매칭 INF 없음]` 항목 수로 확인
