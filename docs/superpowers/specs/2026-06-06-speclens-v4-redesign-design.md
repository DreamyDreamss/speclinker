# SpecLens v4 전면 재디자인 — 설계서

- 날짜: 2026-06-06
- 버전 목표: v3.16.0
- 대상: `docs/viewer/{docsify-sl.js, sl-theme.css, index.html}`
- 승인: 사용자 목업 승인(v4 통합안 — 좌측 트리 + 중앙 콘텐츠 + 우측 연결관계, Linear/Mintlify 정제 톤)

## 1. 배경 / 문제

현재 SpecLens는 **커스텀 뷰(#sl-main: 대시보드/도메인목록)와 docsify 문서뷰(.content)가 토글**되는 구조다. 사용성 문제:
- 항목 클릭 시 문서가 목록과 별개 영역에 떠 혼란(직전 v3.15.x에서 display 상호배타로 임시 봉합).
- 디자인이 화면마다 제각각(대시보드=표, 상세=raw 마크다운), 톤이 투박.
- 좌측 탐색이 도메인 목록뿐 — 스펙 항목까지 한 번에 못 봄.

## 2. 목표 / 비목표

**목표**: 전 화면을 하나의 **3-pane 셸(좌 트리 · 중앙 콘텐츠 · 우 연결관계)** + 정제된 디자인 토큰으로 통일. 빌드리스(docsify+바닐라 JS) 유지. 직전 수정(연결패널·크로스링크·그래프·frontmatter 접이식·이미지·INF↔SCH 정방향) **전부 보존**.

**비목표**: 프레임워크 도입 금지, 서버 로직 금지, 신규 산출물 타입 추가 금지. 마커 좌표 생성(RECON 파이프라인 몫)은 범위 밖 — 데이터 있을 때만 표시.

## 3. 디자인 토큰 (정제 톤)

`sl-theme.css` `:root` 교체:
- 배경 `--bg:#0b0d11`, 표면 `--surface:#13161c`, 표면2 `--surface-2:#0e1116`, 경계 `--border:#1f2630`/`--border-soft:#1c222b`
- 텍스트 `--text:#d7dde5`, 보조 `--muted:#717b88`, 흐림 `--faint:#5b6470`
- 강조(골드) `--accent:#e6c79c`
- 타입색: INF `--c-inf:#7aa2ff`, SCH `--c-sch:#52c489`, UIS `--c-uis:#e6c79c`, SRS `--c-srs:#c79bf0`, FUNC `--c-func:#c79bf0`
- 메서드: GET `#1f6feb` POST `#1b7a3e` PUT `#9e6a03` DELETE `#da3633`
- 반경 `--r:10px`/`--r-lg:14px`, 카드 그림자 `0 4px 20px rgba(0,0,0,.35)`
- 타입 아이콘(텍스트): ⬡ INF · ⛁ SCH · ▭ UIS · ◆ SRS

## 4. 레이아웃 — 3-pane 셸

```
┌──────────┬───────────────────────────┬────────────┐
│ 좌: 트리  │ 상단: 브레드크럼 + 액션바    │ 우: 연결관계 │
│ (208px)  ├───────────────────────────┤ (210px)    │
│ 검색⌘K   │ 중앙 콘텐츠                  │ (상세때만)  │
│ 대시보드  │  = 대시보드 | 목록 | 상세    │            │
│ 도메인▾   │                           │            │
│  ⬡▭⛁◆   │                           │            │
└──────────┴───────────────────────────┴────────────┘
```

- **좌 트리** (항상): 로고 · 검색(⌘K 표시) · 전역(대시보드/커버리지/IA) · 도메인 목록(펼치면 타입 그룹 ⬡INF/▭UIS/⛁SCH/◆SRS + 개수, 그룹 펼치면 항목). 항목 클릭 → 중앙 상세.
- **중앙 콘텐츠**: 한 영역에서 3모드 전환 — 대시보드(커버리지 링 카드) / 목록(탭+필터+정렬) / 상세(docsify md 렌더). 셸은 고정, 콘텐츠만 교체.
- **우 연결관계**: 상세(INF/UIS/SCH/SRS)일 때만. 기존 패널 재사용·정제.
- **상단 바**: 브레드크럼 + 액션(🕸 그래프 / ⧉ 원본).

### 구조 전환 (핵심)
현재 `#sl-main`(커스텀)↔`.content`(docsify) 토글을, **단일 셸**로 통합:
- 셸 DOM: `#sl-shell`(좌 `#sl-nav` + 중앙 `#sl-center` + 우 연결패널). docsify `.content`는 `#sl-center` **내부**의 문서 슬롯으로 위치(상세 모드일 때 표시), 대시보드/목록은 `#sl-center`의 커스텀 슬롯에 렌더.
- 모드 클래스 `body[data-view=dashboard|list|doc]`로 중앙 슬롯 표시 제어(상호배타, 직전 봉합을 정식화).

## 5. 컴포넌트

| 컴포넌트 | 책임 | 입력 |
|---|---|---|
| `renderNav()` | 좌측 트리(검색·전역·도메인/타입/항목) | INDEX |
| `renderDashboard()` | 커버리지 링 카드 + 요약 + 갭 | INDEX.domains/totals/gaps |
| `renderList(domain, tab)` | 탭(INF/UIS/SCH/SRS)+필터+정렬 목록 | INDEX.{infs,uis,schs,srs} |
| `renderListRow*()` | 타입별 행(메서드배지·id·name·연결수·앵커) | item |
| 상세(docsify) | md 렌더 + 브레드크럼 + 연결패널 + 크로스링크 + 그래프 + 이미지 | 문서 |
| `openGraph()` | 연결 그래프(기존 유지, 토큰만 정제) | INDEX 관계 |

> 기존 함수 보존·재사용: `injectBreadcrumb`/`injectRelationPanel`/`addCrosslinks`/`enhanceImages`/`openGraph`/`buildSpecGraph`/`goToId`/`search`/`resolveCurrentEntity` 및 인덱스 필드(inf_ids/sch_ids/func/srs/tables/gaps). 동작 불변, 셸/토큰만 교체.

## 6. 더 나은 아이디어(재량 적용)
- **⌘K 커맨드 팔레트**: 기존 사이드바 검색을 모달 팔레트로 승격(키보드 우선). 시간 제약 시 사이드바 인라인 검색 유지 + ⌘K 단축키만.
- **목록 행 연결 배지**: ⛁N(테이블)·⚓N(앵커)·화면N — 한눈에 풍부도/갭 파악.
- **커버리지 링**: conic-gradient 도넛(무라이브러리).
- **빈/에러 상태**·로딩 스켈레톤 정제.

## 7. 하위호환 / 위험
- spec_index 스키마 불변(읽기만). 구 인덱스로도 동작(graceful).
- 가장 큰 위험: docsify `.content`를 `#sl-center` 내부로 재배치 시 docsify 라우팅/렌더 타이밍. → `.content`를 옮기지 않고 **CSS로 위치만 잡고**(셸을 grid로) `body[data-view]`로 표시 제어하는 방식 우선(DOM 이동 최소화).
- 직전 수정 회귀 방지: 각 단계 후 nkshop CDP 스모크(연결패널·크로스링크·그래프·이미지·frontmatter·목록·대시보드).

## 8. 검증
- Python 인덱스 테스트 불변(스키마 안 바뀜) — 전부 green 유지.
- JS: `node --check` + nkshop CDP 헤드리스 전수(대시보드 링·목록 탭/필터·상세 연결패널·UIS 미리보기·그래프·검색·브레드크럼).
- 문서 동기화: sl-viewer SKILL · CLAUDE 버전노트 · plugin.json v3.16.0.

## 9. 미해결/가정
- 마커↔위젯 연동: 마커 좌표 데이터 없으면 위젯표만(graceful) — 본 범위는 표시 로직만.
- ⌘K 팔레트는 시간 여유 시; 최소 요건은 사이드바 검색 유지.
