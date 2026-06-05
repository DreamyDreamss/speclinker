# SpecLens 뷰어 재설계 — 설계서

- 날짜: 2026-06-05
- 대상: `docs/viewer/` (SpecLens — Docsify 기반 산출물 웹 뷰어)
- 관련 파일: `docs/viewer/docsify-sl.js`, `docs/viewer/sl-theme.css`, `docs/viewer/index.html`, `scripts/gen_docsify.py`, `skills/sl-viewer/SKILL.md`

## 1. 배경 / 문제 (사용자 관점 진단)

SpecLens는 기능(대시보드·도메인탭·INF/UIS/SCH 카드·상세 렌더·가이드)은 갖췄으나, 정작 이 도구의
**핵심 가치(화면·연결관계)를 보여주지 못한다.** 사용자(SI/ITO 엔지니어·PM·고객사·QA)가 매일 보는
대시보드/목록/상세의 완성도가 잘 만든 가이드 페이지에 비해 떨어진다.

진단된 5개 개선 영역(우선순위순):

1. **화면(UIS) 뷰어** — 1순위 산출물인 화면이 `80px object-fit:cover`로 잘려 식별 불가. 확대(라이트박스)·마커 오버레이 없음.
2. **연결관계** — `FUNC→UIS/INF/SCH→코드→TC` 체이닝이 도구 철학인데, 시각적 연결 패널/그래프가 없음 (텍스트 크로스링크 + ⚓앵커 개수뿐).
3. **길찾기** — 상세 진입 시 브레드크럼·뒤로가기 부재로 위치 상실. 검색이 사이드바에 노출 안 됨.
4. **대시보드** — 정렬·필터·갭 하이라이트 없음. 도메인 많아지면 긴 표.
5. **마감** — 반응형(하드코딩 margin)·접근성(`<div onclick>` 일색)·stale 경고 부재·BAT "준비 중" 플레이스홀더.

## 2. 목표 / 비목표

**목표**: 위 5개를 SpecLens의 기존 Gold Dark 디자인 톤·바닐라 JS(빌드리스) 구조를 유지한 채 개선.
범용성 원칙(스택 중립) 준수 — 특정 프로젝트 전제 금지.

**비목표**: 프레임워크 도입(React 등) 금지(현 docsify+바닐라 유지), 서버사이드 로직 추가 금지(정적 인덱스 유지),
실시간 협업·편집 기능 없음.

## 3. 데이터 모델 — `gen_docsify.py` 보강 (선행)

연결관계 패널은 인덱스에 관계 데이터가 있어야 클라이언트가 fuzzy 매칭 없이 정확히 그린다. 현 인덱스 필드:

- `infs[]`: id, name, method, path, anchor_count, domain, file, tbd_count
- `uis[]`: id, name, route, apis(=apis|api_hints), has_preview, preview, anchor_count, domain, file
- `schs[]`: id, table, inf[](참조 INF id 목록), domain, file
- `domains{}`: inf/uis/sch/bat, tbd_total, sprint_total, sprint_done

**추가/보강할 인덱스 필드 (zero-LLM, 정적 도출):**

| 필드 | 위치 | 도출 방법 |
|------|------|----------|
| `uis[].inf_ids` | UIS | `uis.apis`(URL/path/hint) ↔ `infs[].path` 매칭(정확+prefix)으로 INF id 해소. 매칭 실패분은 raw 문자열 유지 |
| `infs[].sch_ids` | INF | `schs[].inf[]` 역인덱스 — 이 INF를 참조하는 SCH 수집 |
| `infs[].func` / `uis[].func` / `schs[].func` | 전체 | frontmatter `linked_func` 우선, 없으면 `FUNC_MAP.md` 파싱으로 산출물→FUNC 역매핑. 없으면 생략 |
| `infs[].has_test` (선택) | INF | FUNC_MAP의 TC 컬럼 또는 test 산출물 존재로 boolean. 데이터 없으면 필드 생략(점진) |

> **원칙**: 모든 보강은 인덱스 **추가**만 — 기존 필드/경로 불변(뷰어 하위호환). 데이터 없으면 필드 생략하고
> 클라이언트는 "정보 없음"으로 graceful degrade. 멱등(재실행 안전).

## 4. 컴포넌트 설계

`docsify-sl.js`는 단일 IIFE에 렌더 함수들이 모여 있다. 재설계도 이 구조를 유지하되, 관계 해소 로직과
공통 상세 헤더(브레드크럼+연결패널)를 작은 헬퍼로 분리해 INF/UIS/SCH 상세가 공유한다.

### 4.1 UIS 상세 뷰어 (영역 ①)
- **큰 미리보기**: 카드 그리드의 80px 썸네일은 유지(목록용), 상세 진입 시 전폭 미리보기 렌더.
- **라이트박스**: 미리보기 클릭 → 풀스크린 오버레이(확대/ESC 닫기). 신규 `openLightbox(src)`.
- **마커 오버레이 ↔ 위젯표 연동**: 미리보기 위에 번호 마커(절대좌표), 하단 위젯표 행 hover 시 해당 마커 강조(+역방향).
  - 마커 좌표 출처: UIS 산출물에 마커 메타(좌표)가 있으면 사용. **없으면(현행 다수) 마커 오버레이는 생략하고 위젯표만** 표시(graceful). — 좌표 생성은 RECON 파이프라인 몫이라 본 재설계 범위 밖, 데이터 있을 때 자동 표시.
- **탭**: 화면당 디렉토리(탭=섹션) 구조에서 탭 칩 → 해당 탭 미리보기/위젯 전환.

### 4.2 연결관계 패널 (영역 ②) — INF/UIS/SCH 상세 공통
- 신규 `renderRelationPanel(entity, type)` — 우측 패널(기존 Quick Nav 자리 통합 또는 병치).
- UIS: 호출 API(`inf_ids`→INF 칩, method 배지) · 관련 테이블(INF들의 `sch_ids` 합집합→SCH 칩) · linked FUNC.
- INF: 사용 화면(`used_by_screens`/역인덱스) · 관련 테이블(`sch_ids`) · linked FUNC.
- SCH: 참조 API(`inf[]`) · 그 API를 쓰는 화면 · linked FUNC.
- 모든 칩 클릭 → `goToId()` 재사용(기존 함수). 데이터 없는 섹션은 미표시.

### 4.3 브레드크럼 + 검색 (영역 ③)
- **브레드크럼**: 상세 렌더 시 `🏠 대시보드 › {도메인} › {타입} › {ID}` + "← 도메인" 버튼. 라우트 hash에서 도메인/타입/ID 파싱.
- **글로벌 검색**: 사이드바 상단에 검색 입력 1급 노출. 입력 시 인덱스(infs/uis/schs)에서 id·name·path·table·route를 즉시 필터 → 결과 드롭다운(클릭 시 `goToId`/`openSpec`). docsify 전문검색과 병존(구조 검색=빠른 점프).

### 4.4 대시보드 강화 (영역 ④)
- 도메인 테이블 **헤더 클릭 정렬**(완성도·완료율·각 카운트 오름/내림).
- **필터 바**: 도메인명 검색 + 메서드 필터(INF 목록 뷰에서). 
- **갭 배지**: 연결 끊긴 산출물(예: `inf_ids` 0인 UIS, `used_by_screens` 0인 INF) 개수를 도메인 행/대시보드에 배지로 노출 → 품질 가시화.

### 4.5 마감 (영역 ⑤)
- **반응형**: 사이드바 접기 토글(햄버거), 좁은 폭(<900px)에서 사이드바 오버레이화 + 본문 margin 제거. 하드코딩 220/175 margin → CSS 변수/클래스.
- **접근성**: 클릭 요소를 `role="button"` + `tabindex` + Enter/Space 핸들 + `:focus-visible` 스타일. 키보드 내비 가능.
- **stale 경고**: `generated_at` vs 산출물 최신 mtime 비교 불가(정적)이므로, gen_docsify가 인덱스에 `source_count`/생성시각을 남기고 뷰어는 생성 후 경과시간이 길면 "인덱스 갱신 권장" 안내(soft). 
- **BAT 탭**: 데이터(`schs`처럼 bat 목록) 있으면 목록 렌더, 없으면 탭 자체를 숨김(현 "준비 중" 제거).

## 5. 영향 범위 / 하위호환

- 수정: `docsify-sl.js`(렌더 로직), `sl-theme.css`(신규 컴포넌트 스타일·반응형), `scripts/gen_docsify.py`(인덱스 필드 추가), `index.html`(필요시 검색 자산).
- `gen_docsify.py`는 부트스트랩 자산을 프로젝트로 복사하므로, 플러그인 원본 갱신 = 사용자 `/sl-viewer` 재실행 시 자동 반영.
- **하위호환**: 인덱스 신규 필드는 모두 optional, 구 인덱스로도 뷰어 동작(기능 graceful degrade).
- 참조 문서 동기화(MUST): `skills/sl-viewer/SKILL.md`(사용법 갱신), `scripts/README.md`(gen_docsify 출력 필드), `CLAUDE.md` 버전 노트 + `plugin.json` version bump.

## 6. 검증 / 테스트

- **데이터 도출**: `gen_docsify.py`의 신규 관계 해소(uis→inf, inf→sch 역인덱스, func 매핑)에 단위테스트 추가(`scripts/tests/`). 픽스처는 **2스택**(Java Spring + Next.js) 산출물 샘플로 범용성 검증(CLAUDE.md 의무).
- **뷰어 동작**: e2e 샘플(`docs/report/samples/e2e_pr301`) 인덱스로 로컬 서빙하여 ①~⑤ 수동 확인(브레드크럼/연결패널/라이트박스/정렬/반응형/키보드).
- **회귀**: 구 인덱스(신규 필드 없음)로도 빈손 없이 렌더되는지 확인(하위호환).

## 7. 구현 순서 (제안)

1. `gen_docsify.py` 인덱스 보강(관계 필드) + 단위테스트 — 모든 UI가 이 데이터에 의존하므로 선행.
2. 공통 상세 헤더(브레드크럼) + 연결관계 패널(②③ 핵심).
3. UIS 상세 뷰어(큰 미리보기·라이트박스·마커/위젯 연동) (①).
4. 대시보드 정렬·필터·갭 배지 (④).
5. 글로벌 검색(사이드바) (③ 나머지).
6. 마감 — 반응형·접근성·stale·BAT (⑤).
7. 참조 문서 동기화 + 버전 bump + 커밋.

## 8. 미해결 / 가정

- **마커 좌표**: 현 UIS 산출물에 마커 절대좌표 메타가 없을 수 있음 → 있으면 오버레이, 없으면 위젯표만(범위 밖의 RECON 파이프라인 의존). 본 설계는 "데이터 있으면 표시"로 한정.
- **linked FUNC**: frontmatter `linked_func` 또는 `FUNC_MAP.md` 중 실제 존재하는 소스로 매핑. 둘 다 없으면 FUNC 섹션 생략.
- **has_test**: 데이터 가용 시 점진 추가(필수 아님).
