# RECON 파이프라인 전체 문서

> **현행 기준: v2.57** (2026-06-04 재작성 — 실제 SKILL 파일 기준)
> 커맨드 흐름: **`/sl-recon` → `/sl-recon-uis` → `/sl-recon-doc`** (3-Phase)
>
> ⚠️ **변경 이력 주의:** v2.19 시절엔 INF/SCH 생성을 별도 `/sl-recon-inf`가 담당하는 4-Phase
> 구조였으나, **도메인 선택형 RECON 리팩토링**으로 INF·SCH 생성이 `/sl-recon` 내부(STEP 4-3 / 5)로
> 통합되었고 `/sl-recon-inf`는 **삭제(deprecated→removed)** 되었다. 이 문서는 현행 3-Phase 기준이다.

---

## 전체 흐름 요약

```
/sl-recon  (STEP 0~6)  ── 스캔·도메인확정·INF·BAT·SCH 생성까지
  STEP 0     MCP 연결 상태 확인
  STEP 0.5   POC 모드 상태 확인
  STEP 1     소스 구조 스캔 (scan_source.js) → _tmp/source_index.json
  STEP 1.7   처리 도메인 선택 (카탈로그 기반, 사용자 선택)
  STEP 1.5   프로젝트 Profile 생성·로드 (.speclinker/profile.yaml)
  STEP 2     Phase-A: SAD + 도메인 목록 확정
             2-0 소스 인덱스 압축 / 2-1 spec-agent 도메인 확정 / 2-2 POC 도메인 필터
  STEP 3     ✋ 사용자 도메인 검토 (필수 체크포인트)
  STEP 4     router_inventory 생성 + INF 명세 작성
             4-1 router_inventory / 4-2 call chain 사전계산(+sch_draft)
             4-3 INF 생성 (dispatch_inf_gen.py → ddd-api-agent ×N배치) + INF/_TOC.md
                 ※ v3.8.0: INF frontmatter anchors[](full-chain) + 코드값 의도(scan_code_literals), 본문=abstract
             4-B BAT 생성 (ddd-batch-agent)
  STEP 5-0   SCH 스킵 게이트 (build_sch_todo.py) — 이미 생성된 테이블 제외(idempotent)
  STEP 5-A   SCH 정적 스켈레톤 (build_sch_static.py) — 컬럼·인덱스·FK·ERD·링크·색인 zero-token, 의미는 LLM-TODO
  STEP 5-B   SCH 의미 enrichment (dispatch_sch_gen.py → ddd-db-agent) — 코드값·비즈주의만, 필요 도메인 병렬
  STEP 5-1   INF→SCH 링크 패치 (link_inf_sch_new.py)
  STEP 6     완료 체크포인트(phase=recon-analysis) → 다음: /sl-recon-uis

/sl-recon-uis  (STEP 6-*)  ── 화면 탐색·UIS 설계서
  (도메인 선택) ✋ 인수 없으면 전체/특정 도메인 사용자 확인 → _recon_uis_mode.json
  STEP 6-0-GOTO  form URL 직접 goto 캡처 (기본 모드)
  STEP 6-0       정적 Fallback (앱 미실행 시)
  STEP 6-1       Chrome + 로그인 (브라우저 환경 준비)
  STEP 6-2       BFS 전수 탐색 (E2E 스타일) — 6-2-1 초기화 / 6-2-2 BFS 캡처 루프
  STEP 6-2-3     BFS 결과 → INF 매핑으로 도메인 결정 + ID 배정
  STEP 6-2-4     ✋ 화면 목록 + 도메인 코드 검토 (필수 체크포인트)
  STEP 6-3       UIS 스펙 생성 (ddd-ui-agent 배치)
  STEP 6-3-B     UIS ↔ INF 링크 연결 (link_uis_inf.py)
  STEP 6-4       _TOC.md 생성 → 다음: /sl-recon-doc

/sl-recon-doc  (STEP 9~11)  ── 색인·FUNC·SRS·RTM·IA
  STEP 9     Phase-C: 색인 + FUNC 생성 + FUNC_MAP
             9-0 build_funcs_index.py / 9-0-1 build_si_graph.py
             9-1 merge_index.py (전체 색인 3종) / 9-2 rd-agent / 9-3 srs-agent / 9-4 rtm-agent
  STEP 10    IA 맵 생성 (ia_map_builder.py)
  STEP 11    si-graph 갱신 확인 → RECON 완료
```

---

## Phase 1: `/sl-recon` (STEP 0~6)

기존 소스코드를 정적 분석해 **도메인을 확정하고 INF(API 명세)·BAT(배치)·SCH(DB 스키마)까지 생성**한다.

| STEP | 핵심 동작 | 스크립트 / 에이전트 | 주요 출력 |
|------|----------|-------------------|----------|
| 0 | MCP 연결 확인 | 인라인 | `_tmp/mcp_status.json` |
| 0.5 | POC 모드 확인 | 인라인 | 콘솔 |
| 1 | 소스 구조 스캔 (tree-sitter AST) | `scripts/scan_source.js` | `_tmp/source_index.json` |
| 1.7 | 처리 도메인 선택 (카탈로그) | 인라인 (사용자 선택) | `project.env` POC_DOMAINS |
| 1.5 | 프로젝트 Profile | `profile-agent` (없을 때) | `.speclinker/profile.yaml` |
| 2 | Phase-A: SAD + 도메인 확정 | `spec-agent` (sonnet) | `SAD_v1.0.md`, `_domain_plan.json` |
| 3 | ✋ 사용자 도메인 검토 | 없음 | `_domain_plan.json` (확정) |
| 4-1 | router_inventory 생성 | 인라인 | `_tmp/router_inventory.json` |
| 4-2 | call chain 사전계산 | `resolve_call_chain.py` | `_tmp/router_inventory_with_chain.json`, `_tmp/sch_draft/{도메인}/` |
| 4-3 | **INF 생성** | `dispatch_inf_gen.py` → `ddd-api-agent` (sonnet, ×N배치) | `{도메인}/INF/INF-*.md`(frontmatter anchors[] full-chain, 본문 abstract), `_TOC.md` |
| 4-B | BAT 생성 | `ddd-batch-agent` (sonnet) | `{도메인}/BAT/BAT-*.md` |
| 5-0 | SCH 스킵 게이트 (idempotent) | `build_sch_todo.py` | `_tmp/sch_todo.json` (생성 대상 도메인+누락 테이블) |
| 5-A | **SCH 정적 스켈레톤** | `build_sch_static.py` (zero-token: sch_facts → sch_draft+DDL+ORM+선택 DB드라이버) | `{도메인}/SCH/SCH-{CODE}-NNN.md`(사실+LLM-TODO), `{도메인}/DB_{도메인}.md`, `DB_Schema.md`, `sch_enrich_todo.json` |
| 5-B | **SCH 의미 enrichment** | `dispatch_sch_gen.py` → `ddd-db-agent`(enrichment, 서브프로세스 병렬, 필요 도메인만) | LLM-TODO 마커 채움(코드값·비즈주의·컬럼설명) |
| 5-1 | INF→SCH 링크 패치 | `link_inf_sch_new.py` | INF `## 참조 테이블` `[TBD]`→`[[SCH-XXX]]` |
| 6 | 완료 체크포인트 | 인라인 | `_tmp/recon_checkpoint.json` (phase=recon-analysis) |

> **SCH 구조 (v2.56~):** 테이블 1개 = 파일 1개(`{도메인}/SCH/SCH-{CODE}-NNN.md`, frontmatter 필수)
> + 슬림 도메인 개요(`DB_{도메인}.md`: 도메인 ERD + 테이블 목록, DDL 없음)
> + 전역 색인(`DB_Schema.md`: 파일 직링크, 앵커 없음). INF 구조와 대칭. 3NF 검증결과 섹션은 작성 안 함.

---

## Phase 2: `/sl-recon-uis` (STEP 6-*)

**진입 전제:** `_tmp/recon_checkpoint.json`(phase=recon-analysis), `_domain_plan.json`, `{도메인}/INF/`

| STEP | 핵심 동작 | 스크립트 / 에이전트 | 주요 출력 |
|------|----------|-------------------|----------|
| (선택) | ✋ 도메인 선택 — 인수 없으면 전체/특정 도메인 사용자 확인 (form 화면 수 미리보기) | 인라인 + `build_uis_goto_plan.py` | `_tmp/_recon_uis_mode.json` (domain_filter) |
| 6-0-GOTO | form URL 직접 goto 캡처 (기본) | `capture.js` | preview.png |
| 6-0 | 정적 Fallback (앱 미실행) | 인라인 | `screen_inventory_static.json` 기반 |
| 6-1 | Chrome + 로그인 | `runtime_capture.js --bootstrap` | `.preview-storage.json` |
| 6-2 | BFS 전수 탐색 (E2E) | `detect_capture_strategy.js`, `ai_nav.js` | BFS 화면 목록 |
| 6-2-3 | BFS→INF 매핑·도메인 결정·ID 배정 | `screen_inventory.py` | 화면↔도메인 매핑 |
| 6-2-4 | ✋ 화면목록 + 도메인코드 검토 | 없음 | 확정 |
| 6-3 | UIS 스펙 생성 | `ddd-ui-agent` (sonnet, 3개씩) | `{도메인}/UI/{화면}/spec.md` |
| 6-3-B | UIS↔INF 링크 | `link_uis_inf.py` | spec.md §5 INF 링크 |
| 6-4 | _TOC.md 생성 | 인라인 | `{도메인}/UI/_TOC.md` |

---

## Phase 3: `/sl-recon-doc` (STEP 9~11)

**진입 전제:** `_tmp/recon_checkpoint.json`, `_tmp/screen_inventory.json`, `{도메인}/INF/INF-*.md` 1개 이상

| STEP | 핵심 동작 | 스크립트 / 에이전트 | 주요 출력 |
|------|----------|-------------------|----------|
| 9-0 | FUNC 통합 인덱스 | `build_funcs_index.py` | `_tmp/funcs_index.json` |
| 9-0-1 | SI 트레이싱 그래프 | `build_si_graph.py` | `.understand-anything/si-graph.json` |
| 9-1 | 전체 색인 3종 | `merge_index.py` | `API_Design.md`, `DB_Schema.md`, `UI_Spec_v1.0.md` |
| 9-5 | 도메인 SOP 개요(사람 레이어) | `build_domain_overview.py` | `{도메인}/OVERVIEW_{도메인}.md` (기계인덱스와 분리) |
| 9-2 | FUNC 생성 | `rd-agent` (sonnet) | `docs/00_FUNC/FUNC_v1.0.md` (+ domains/) |
| 9-3 | SRS 생성 | `srs-agent` (sonnet) | `docs/03_기능명세서/SRS_v1.0.md` (+ domains/) |
| 9-4 | FUNC_MAP 생성 | `rtm-agent` (**opus**) | `docs/00_FUNC/FUNC_MAP.md`, `linked-func-cache.json` |
| 10 | IA 맵 생성 | `ia_map_builder.py` | `_tmp/ia-map.json` |
| 11 | si-graph 갱신 확인 | 인라인 | checkpoint(phase=recon-complete) |

---

## 에이전트 사용 모델 요약 (현행)

| 에이전트 | 사용 STEP | 모델 | 역할 |
|---------|----------|------|------|
| `spec-agent` | recon 2-1 | sonnet | Phase-A: SAD + 도메인 확정 |
| `ddd-api-agent` | recon 4-3 | sonnet | INF(API 명세) 생성 |
| `ddd-batch-agent` | recon 4-B | sonnet | BAT(배치 명세) 생성 |
| `ddd-db-agent` | recon 5-B | sonnet | SCH enrichment — 코드값·비즈주의·컬럼설명만(사실은 build_sch_static) |
| `ddd-ui-agent` | recon-uis 6-3 | sonnet | UIS(화면 설계서) 생성 |
| `rd-agent` | recon-doc 9-2 | sonnet | FUNC 생성 |
| `srs-agent` | recon-doc 9-3 | sonnet | SRS 생성 |
| `rtm-agent` | recon-doc 9-4 | **opus** | FUNC_MAP + Constitutional 검증 |

---

## 산출물 디렉토리 (현행)

```
docs/05_설계서/
├── _domain_plan.json                 (recon 2 — 도메인 계획)
├── API_Design.md                     (recon-doc 9-1 — 전역 INF 색인)
├── DB_Schema.md                      (recon 5 / recon-doc 9-1 — 전역 SCH 색인, 파일 직링크)
├── UI_Spec_v1.0.md                   (recon-doc 9-1 — 전역 UIS 색인)
└── {도메인}/
    ├── INF/INF-*.md + _TOC.md        (recon 4-3)
    ├── SCH/SCH-{CODE}-NNN.md         (recon 5 — 테이블당 1파일)
    ├── DB_{도메인}.md                (recon 5 — 슬림 개요: 도메인 ERD + 테이블 목록)
    ├── BAT/BAT-*.md                  (recon 4-B)
    └── UI/{화면}/spec.md + _TOC.md   (recon-uis 6-3/6-4)
docs/00_FUNC/FUNC_v1.0.md, FUNC_MAP.md (recon-doc 9)
docs/03_기능명세서/SRS_v1.0.md          (recon-doc 9-3)
docs/04_아키텍처설계서/SAD_v1.0.md       (recon 2-1)
```

> **`_TOC.md`** = 디렉토리별 목차(인덱싱) 파일. 사람·Obsidian 탐색용. **Docsify 뷰어는 _TOC를 안 읽고 개별 파일(INF/SCH/spec.md)을 직접 스캔**한다(`gen_docsify.py`).
