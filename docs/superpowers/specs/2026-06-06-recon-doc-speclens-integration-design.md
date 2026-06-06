# RECON-doc 현행화 마무리 + SpecLens 통합 + 연결 그래프 — 설계서

- 날짜: 2026-06-06
- 버전 목표: v3.12.0
- 관련: `skills/sl-recon-doc/SKILL.md`, `agents/rtm-agent.md`, `scripts/build_funcs_index.py`, `scripts/build_si_graph.py`, `scripts/gen_docsify.py`, `docs/viewer/{docsify-sl.js,sl-theme.css,index.html}`
- 선행 설계: `2026-06-05-speclens-redesign-design.md` (연결관계 데이터·패널), v3.11.x(recon-doc/sl-ia UIS 경로 현행화)

## 1. 배경 / 문제

RECON Phase-3(`/sl-recon-doc`)와 SpecLens 뷰어 사이에 다음 문제가 객관 검토로 확인됨:

1. **si-graph는 orphan 산출물** — `build_si_graph.py`가 `.understand-anything/si-graph.json`을 만들지만 **읽는 코드가 0**(과거 understand-dashboard SI탭용, 그 대시보드 폐기). 가치(스펙→소스)는 INF `anchors:`(full-chain 소스앵커)와 `spec_index`가 이미 더 정확히 커버.
2. **rtm-agent 프롬프트가 stale 필드 참조** — `related_sch`(실제 INF에 없는 필드), `used_by_screens`(실제는 `screens:`) → FUNC_MAP의 INF↔SCH/화면 연결이 추론으로 약화.
3. **funcs_index에 INF→SCH 링크 없음** — rd/srs/rtm가 SCH 연결을 못 받아 FUNC_MAP "연관 SCH"를 rtm(Opus)이 추론으로 메움.
4. **SpecLens가 recon-doc 산출물을 거의 활용 못 함** — `gen_docsify` 인덱스에 `funcs` 키 없음. `goToId`는 INF/UIS/SCH만 해소 → 크로스링크·연결패널의 **"linked FUNC" 칩 클릭이 죽은 클릭**. SRS·FUNC_v1.0·OVERVIEW·3대 색인은 뷰어에 비노출.
5. **스펙 연결을 시작점부터 그래프로 보는 수단 없음** — 도구 철학(FUNC→UIS/INF/SCH 체이닝)인데 시각 그래프 부재. 데이터(`spec_index`의 inf_ids·sch_ids·func)는 이미 존재.

## 2. 목표 / 비목표

**목표**: recon-doc 파이프라인을 가볍고 사실기반으로 정리하고, 그 산출물을 SpecLens에서 제대로 활용하며, 스펙 연결을 시작점 N-hop 그래프로 본다. 범용성(스택 중립)·빌드리스(docsify+바닐라) 유지.

**비목표(별도 설계로 분리)**: FUNC_v1.0/SRS의 LLM 생성 축소 재설계, sl-ia↔recon-doc 통합 리팩토링, si-graph 부활.

## 3. 컴포넌트 설계

### A. recon-doc 파이프라인 정리

#### A1. si-graph 제거
- `skills/sl-recon-doc/SKILL.md`: **STEP 9-0-1 블록 삭제**. STEP 11은 si-graph 확인 제거 → 최종 완료 체크포인트만 유지.
- `scripts/build_si_graph.py`: 파일 상단 STATUS를 `DEPRECATED`로 표기(삭제하지 않음 — 외부 참조/회귀 안전). 동작 변경 없음, 단지 파이프라인이 호출 안 함.
- 동기화: `docs/RECON_PIPELINE.md`(STEP 9-0-1/11 행 제거), `scripts/README.md`(build_si_graph DEPRECATED 표기).
- 완료 안내 문구에서 si-graph 언급 제거.

> 결정 근거: si-graph는 무소비. 스펙→소스는 INF `anchors:` + `spec_index`로 충분. 삭제 대신 deprecated로 두어 안전.

#### A2. rtm-agent 프롬프트 현행화
- `agents/rtm-agent.md` 및 `skills/sl-recon-doc/SKILL.md`의 9-4 프롬프트 데이터 소스 항목 수정:
  - `used_by_screens` → `screens`(INF frontmatter 실제 필드) **또는** funcs_index의 화면↔INF(아래 A3로 이미 사실 연결됨)를 1차로.
  - `related_sch` → INF frontmatter `tables:` + SCH frontmatter `inf:` 역인덱스(funcs_index가 제공, A3).
- 출력 컬럼 `| UIS-ID | 화면명 | Route | SRS-F | FUNC-ID | 호출 INF | 연관 SCH |`는 유지.

#### A3. funcs_index에 INF→SCH 링크
- `scripts/build_funcs_index.py`:
  - 신규 함수 `collect_sch_index(domains)` — 각 도메인 `SCH/SCH-*.md` frontmatter(`sch-id`, `table`, `inf`) 스캔 → `{INF-ID: [SCH-ID...]}` 역인덱스(+ `{SCH-ID: {table, inf}}`).
  - INF 인덱스 항목에 `sch_ids: [...]` 추가.
  - funcs_index 출력에 `schs` 섹션(SCH-ID→{table,inf}) + 각 func entry의 `inf[]`에 sch_ids 포함.
- 효과: rtm이 "연관 SCH"를 사실 링크로 받음(추론 불필요).

### B. SpecLens 통합 (중간 범위)

#### B1. gen_docsify `funcs[]` 인덱싱
- `scripts/gen_docsify.py`:
  - 신규 `scan_funcs(spec_root)` — `docs/00_FUNC/FUNC_MAP.md`(있으면) 표 파싱으로 `{FUNC-ID: {uis,inf,sch}}` 추출 + `docs/00_FUNC/domains/FUNC_*.md`/`FUNC_v1.0.md`에서 FUNC-ID·기능명 수집.
  - index에 `funcs: [{id, name, domain, file, uis, inf, sch}]` 추가. `file`은 FUNC_MAP.md(앵커 없이 파일)로 폴백.
  - 도메인별 OVERVIEW 경로: `domains[d]['overview']`에 `docs/05_설계서/{d}/OVERVIEW_{d}.md` 존재 시 경로 기록.
  - 하위호환: FUNC_MAP/OVERVIEW 없으면 `funcs:[]`·overview 미설정(graceful).

#### B2. goToId가 FUNC 해소 + 크로스링크 보정
- `docs/viewer/docsify-sl.js`:
  - `goToId(id)`에 funcs 분기 추가 — `INDEX.funcs`에서 매칭 → 해당 func.file(FUNC_MAP.md)로 이동(앵커 가능하면 FUNC-ID 헤딩).
  - 크로스링크 정규식 `FUNC-[a-z]+-\d+` → `FUNC-[A-Za-z]+-\d+`(대문자 도메인코드 대응).
  - `resolveCurrentEntity`에 FUNC 타입 인식 추가(브레드크럼/패널 일관).

#### B3. 도메인 뷰 OVERVIEW 노출
- `renderDomainView`: 도메인 헤더에 `domains[d].overview` 있으면 "📖 도메인 개요" 링크(openSpec). 기존 FUNC_MAP 사이드바 네비 유지.
- SRS: 전용 노출 없음 — 크로스링크/직접 라우팅으로 도달(현행 유지).

### C. 스펙 연결 그래프 (mermaid)

#### C1. 그래프 빌드 (클라이언트, zero 추가데이터)
- `docs/viewer/docsify-sl.js` 신규 `buildSpecGraph(startId, depth)`:
  - 시작 엔티티에서 `spec_index` 관계로 BFS:
    - UIS →(inf_ids)→ INF, INF →(sch_ids)→ SCH, SCH →(inf 역)→ INF, * →(func)→ FUNC, FUNC →(uis/inf/sch)→ 산출물.
  - depth 기본 2, 노드타입 토글(UIS/INF/SCH/FUNC).
  - mermaid `graph LR` 문자열 생성: 노드 id=안전화, 라벨=ID+한글명, 타입별 class 색.

#### C2. 렌더 (오버레이)
- `docs/viewer/index.html`: mermaid CDN(`mermaid@10`) 추가, `startOnLoad:false`.
- `docsify-sl.js`: 연결패널 상단 "🕸 그래프로 보기" 버튼 → `openGraph(startId)`:
  - 풀스크린 오버레이(라이트박스류) + 깊이 슬라이더(1~3) + 타입 토글 + 닫기(ESC).
  - `mermaid.render`로 SVG 생성 → 오버레이에 삽입. 노드 클릭 → `goToId`(오버레이 닫고 이동).
  - 노드 과다(예: >60) 시 "깊이를 줄이세요" 경고.
- `sl-theme.css`: 그래프 오버레이·버튼·노드 색(타입별, 기존 토큰 재사용).

## 4. 데이터 흐름

```
RECON: build_funcs_index(+SCH링크) → funcs_index.json → rd/srs/rtm(FUNC_MAP 사실기반)
뷰어:  gen_docsify(scan_funcs+overview) → spec_index.json(funcs[]·gaps·관계필드)
       → docsify-sl.js: 연결패널/검색/브레드크럼 + goToId(FUNC해소) + buildSpecGraph→mermaid
```

## 5. 하위호환 / 영향
- 모든 인덱스 신규 필드(funcs, sch_ids, overview)는 optional → 구 인덱스로도 뷰어 동작(graceful).
- si-graph deprecated(삭제 아님) → 외부 스크립트가 직접 호출해도 동작.
- recon-doc 산출물 형식·경로 불변(FUNC_MAP/SRS/OVERVIEW 구조 유지).

## 6. 검증 / 테스트
- **Python(2스택)**: 
  - `test_funcs_index_uis.py` 확장 — SCH 링크(inf별 sch_ids) 검증.
  - `test_speclens_index.py` 확장 — `scan_funcs`(FUNC_MAP 파싱→funcs[]) + overview 경로 검증.
  - nkshop 실측: funcs_index inf.sch_ids 채워짐, FUNC_MAP 생성 후 spec_index.funcs 비어있지 않음.
- **JS**: `node --check`; playwright 헤드리스 — 합성 인덱스(funcs 포함)로 ①FUNC goToId 해소(죽은클릭 해소) ②"그래프로 보기" 버튼→mermaid SVG 노드 생성 확인.
- **회귀**: 구 인덱스(funcs 없음)로 빈손 없이 렌더.

## 7. 구현 순서(제안)
1. A3 build_funcs_index SCH 링크(+테스트) — 데이터 토대.
2. A2 rtm-agent 프롬프트 현행화(A3 의존).
3. A1 si-graph 제거(파이프라인 정리).
4. B1 gen_docsify scan_funcs+overview(+테스트).
5. B2 goToId FUNC 해소 + 크로스링크 보정.
6. B3 도메인 OVERVIEW 노출.
7. C1+C2 연결 그래프(mermaid).
8. 문서 동기화 + v3.12.0 bump + 커밋.

## 8. 미해결 / 가정
- FUNC_MAP 표 컬럼 순서는 rtm 출력에 의존 → `scan_funcs`는 행 내 ID 정규식(FUNC/UIS/INF/SCH) 수집 방식으로 컬럼 순서 비의존(견고).
- RECON-only에 FUNC_MAP 없으면 funcs[]·graph의 FUNC 노드 생략(graceful) — UIS/INF/SCH 그래프는 정상.
- mermaid 대규모 그래프 레이아웃 한계 → depth 제한·타입 필터로 완화(설계 내 포함).
