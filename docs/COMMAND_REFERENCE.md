# Speclinker 커맨드 레퍼런스 — 상세 동작 + 전체 플로우

> 현행 기준: **v3.35.5**. 커맨드 13개의 STEP별 동작·입출력·다음 단계를 정리한 정본 참조.
> 각 커맨드의 1차 진실은 `skills/{커맨드}/SKILL.md`이며, 본 문서는 그 요약 인덱스다.
> 관련 정본: `RECON_PIPELINE.md`(RECON 흐름) · `CLAUDE.md`(라우팅·모델·버전노트).

---

## 0. 한눈에 — 전체 플로우

```
                                  ┌─────────────────────────── 사람(SOP/협의) ───────────────────────────┐
                                  │                                                                      │
운영 소스코드                       ▼                                                                      │
   │                       [역추출 산출물 substrate]                                                      │
   │   ┌──────────── RECON (현행 → 스펙) ────────────┐                                                     │
   └──▶│ /sl-init      프로젝트 초기화·MCP·도메인 카탈로그                                                  │
       │ /sl-recon     스캔 → 도메인 확정 (✋게이트)        ─→ _domain_plan.json                            │
       │ /sl-recon-inf INF/BAT 명세 (✋범위게이트)          ─→ {도메인}/INF·BAT, inf_targets.json            │
       │ /sl-recon-sch DB 스키마 SCH (쿼리계약)             ─→ {도메인}/SCH, table_registry.json            │
       │ /sl-recon-uis 화면설계서 UIS (CDP 가이드캡처)       ─→ {도메인}/UIS                                 │
       │ /sl-recon-doc FUNC/SRS/RTM/IA맵                    ─→ FUNC_MAP.md, SRS, RTM                       │
       └──────────────────────────────────────────────┘                                                  │
                                  │                                                                      │
       ┌──────── 보조/탐색 ───────┐ │                                                                      │
       │ /sl-context 프로젝트패턴   │ │                                                                      │
       │ /sl-ia      IA 트리        │ │                                                                      │
       │ /sl-viewer  SpecLens 뷰어  │◀┘  ← 사람 열람 + SR 작업보드(CDP)                                      │
       │ /sl-status  커버리지·진행  │                                                                       │
       └───────────────────────────┘                                                                      │
                                  │                                                                      │
   ┌────────── AIDD / 변경 (스펙 → 코드) ──────────┐                                                        │
   │ /sl-change  SR(Jira/로컬) → 영향분석 → TO-BE 설계 → 스펙 현행화 ─→ 변경관리/{SR}                        │
   │ /sl-aidd    FUNC=story 루프: 생성→✋승인→dev→qa게이트→test→✋확인  ─→ 소스코드 + linked_func             │
   │ /sl-test    TC 작성·실행·TR·Jira 버그                                                                  │
   └──────────────────────────────────────────────┘                                                      │
                                  └──────────────────────────────────────────────────────────────────────┘
```

**추적 축**: RECON·AIDD = **FUNC-ID**(`FUNC-{도메인}-{NNN}`, `FUNC_MAP.md`가 SSoT) · 변경관리 = **SR-ID**.

**대표 파이프라인**

| 상황 | 순서 |
|---|---|
| 기존 코드 분석(납품) | `sl-init` → `sl-recon` → `sl-recon-inf` → `sl-recon-sch` → `sl-recon-uis` → `sl-recon-doc` → (`sl-ia`·`sl-context`·`sl-viewer`) |
| 기존 코드 + 개발 | …RECON… → `sl-aidd` → `sl-test` |
| 변경·유지보수(Jira) | `sl-change <SR>` → `sl-aidd` → `sl-test` |
| 변경·유지보수(로컬) | `sl-change --new SR-001` → (요구사항 작성) → `sl-change SR-001` → `sl-aidd` |
| 소규모 변경 | `sl-change --quick "설명"` |

---

## 1. 커맨드 분류 (13개)

| 분류 | 커맨드 | 한 줄 |
|---|---|---|
| **공통** | `/sl-init` | 프로젝트 초기화(디렉토리·project.env·MCP·도메인 카탈로그) |
| **RECON** | `/sl-recon` | 스캔 + 도메인 확정 (✋게이트) |
| | `/sl-recon-inf` | 확정 도메인 → INF(API)·BAT 명세 (✋범위게이트) |
| | `/sl-recon-sch` | INF tables → DB 스키마 SCH(쿼리 작성 계약) |
| | `/sl-recon-uis` | CDP 가이드 캡처 → 화면설계서 UIS(SOP+JIT) |
| | `/sl-recon-doc` | 색인 + FUNC/SRS/RTM/IA |
| **AIDD/변경** | `/sl-aidd` | FUNC=story BMAD 루프(구현·QA·테스트) |
| | `/sl-change` | SR 전주기(분류·영향분석·TO-BE·스펙현행화) |
| | `/sl-test` | TC 작성·실행·TR·Jira 버그 |
| **추적/탐색** | `/sl-status` | 커버리지·갭·진행·추천 |
| | `/sl-context` | 프로젝트 고유 패턴 추출 |
| | `/sl-ia` | IA 트리 + menu-path 보완 |
| | `/sl-viewer` | SpecLens 웹 뷰어(+SR 작업보드) |

---

## 2. 커맨드별 상세 동작

### `/sl-init` — 프로젝트 초기화
> 모든 작업의 출발. `project.env`·디렉토리·MCP 템플릿·도메인 카탈로그 생성.

| STEP | 동작 | 산출/효과 |
|---|---|---|
| 0 | 소스 경로 수집 | `SOURCE_*_PATH` 결정 |
| 1 | 네트워크 환경 확인 | `NETWORK=open\|closed` |
| 2 | `project.env` 생성 | 핵심 설정 파일 |
| 2-B | 화면 캡처 설정 | `PREVIEW_BASE_URL` 등(UIS용) |
| 3 | 디렉토리 생성 | `docs/00_FUNC`~`docs/05_설계서`·`viewer` 등 |
| 4 | MCP 연동 설정(오픈망) | `.mcp.json` 인라인 생성, DB MCP 스코프 선택(프로젝트/전역/스킵), Jira SR 보드 JQL 질문 |
| 5 | RTM 초기화 | `docs/02_추적표` |
| 5.5 | 소스 스캔 + 도메인 카탈로그 | `source_index.json` + 도메인 후보 |
| 6 | 다음 단계 안내 | → `/sl-recon` |

**전제**: 없음. **다음**: `/sl-recon`.

---

### `/sl-recon` — 스캔 + 도메인 확정 (RECON Phase 1)
> 소스를 정적 분석해 **도메인을 확정**한다. INF/SCH/UIS는 이후 페이즈 커맨드가 담당(v3.35 분리).

| STEP | 동작 | 비고 |
|---|---|---|
| 0 | MCP 연결 상태 확인 | 매 실행 재시도, 결과 `_tmp/mcp_status.json`(project.env 불변) |
| 0.5 | POC 모드 확인 | `POC_MODE`/`POC_DOMAINS`/`POC_SKIP_UA` |
| 1 | 소스 구조 스캔 | `scan_source.js`(tree-sitter, zero-LLM) → `_tmp/source_index.json` (api/form route 분류) |
| 1.7 | 처리 도메인 선택 | 카탈로그 기반, 사용자 선택 → `POC_DOMAINS` |
| 1.5 | 프로젝트 Profile | `profile-agent`(없을 때) → `.speclinker/profile.yaml` |
| 2 | Phase-A: SAD + 도메인 확정 | `spec-agent`(sonnet): 2-0 인덱스 압축 / 2-1 도메인 확정 / 2-2 POC 필터 → `SAD_v1.0.md`, `docs/05_설계서/_domain_plan.json` |
| **✋3** | **사용자 도메인 검토(필수 체크포인트)** | 코드명·도메인 수정 후 진행. **확인 전 다음 금지** |
| 4 | INF는 `/sl-recon-inf`로 위임 | 도메인 확정 체크포인트(`phase=recon-domain`) 저장 → 다음 안내 |

**전제**: `project.env`, 소스 존재. **다음**: `/sl-recon-inf`.

---

### `/sl-recon-inf` — INF(API)·BAT 명세 (RECON Phase 1.5)
> 확정 도메인 기준으로 **INF 대상 census**를 만들고 INF/BAT 명세를 생성. 소스 변경 후 단독 재실행 가능.

| STEP | 동작 | 산출 |
|---|---|---|
| 전제 | `_domain_plan.json` 존재 확인 | 없으면 중단 → `/sl-recon` |
| I-0 | source_index 갱신 | 기본 재스캔(소스 변경 자동 반영), `POC_SKIP_UA`면 재사용 |
| 4-1 | router_inventory 생성 | 도메인별 controller→api route→INF-ID 채번. **전체 census `.speclinker/inf_targets.json`**(뷰어 커버리지 expected) + `_tmp/router_inventory.json`(미생성만) |
| **✋I-1** | **생성 범위 확인(필수 체크포인트)** | 도메인별 전체/생성/미생성 표시 → [전체/특정도메인/재확정/취소]. **확인 전 dispatch 금지**(POC는 자동) |
| 4-2 | call chain 사전 계산 | `resolve_call_chain.py` → controller→service→DAO→query 경로 주입 + `_tmp/sch_draft/` |
| 4-3 | INF 명세 생성(디스패처) | `dispatch_inf_gen.py` → `ddd-api-agent`(sonnet ×N배치, 멱등·재시도) → `{도메인}/INF/INF-*.md`(anchors full-chain) + `_TOC.md` |
| 4-B | BAT 생성 | 배치 후보 → `ddd-batch-agent` → `{도메인}/BAT/BAT-*.md` |
| 6 | 완료 체크포인트(`phase=recon-analysis`) | → 다음 안내 |

**전제**: `_domain_plan.json`. **다음**: `/sl-recon-sch`.

---

### `/sl-recon-sch` — DB 스키마 SCH (RECON Phase 2.5)
> INF의 `tables:` 합집합을 권위로 **SCH = 쿼리 작성 계약**(타입·키·조인·상시필터·코드값) 생성.

| STEP | 동작 | 산출 |
|---|---|---|
| 전제 | `_domain_plan.json` + INF 존재 | 없으면 중단 → `/sl-recon-inf` |
| 5-0' | 추출대상 테이블 레지스트리 갱신 | `build_table_registry.py` → `.speclinker/table_registry.json`(INF∪SQL∪UIS 발견출처·생성여부, carry-forward) |
| 5-0 | SCH 스킵 판정(멱등) | `build_sch_todo.py` → 누락 테이블 도메인만 |
| 5-0.5 | 쿼리 패턴 채굴(zero-token) | `scan_query_patterns.py`+`scan_code_literals.py` → `_machine/query_patterns.json`(관찰조인·상시필터·코드값) |
| 5-A | 정적 스켈레톤(zero-token) | `build_sch_static.py` → 컬럼(키열)·인덱스·FK·관찰조인·ERD·LLM-TODO 마커 |
| 5-B | 의미 enrichment | `dispatch_sch_gen.py` → `ddd-db-agent`(haiku): 코드값·비즈주의 + **환경별 DB MCP**(ora/db2/mdb)로 미상 타입·NULL·FK 사실 채움 |
| 5-1 | INF↔SCH 링크 패치 | `link_inf_sch_new.py` |
| 6 | 레지스트리·인덱스 갱신 | `gen_docsify.py` → 다음 안내 |

**전제**: INF. **다음**: `/sl-recon-uis`.

---

### `/sl-recon-uis` — 화면설계서 UIS (RECON Phase 2)
> 사용자가 메뉴로 진입한 실화면을 **CDP로 캡처 + 소스 판독**해 SOP급 화면설계서를 만드는 가이드형 세션.

| STEP | 동작 | 산출 |
|---|---|---|
| 전제 | `PREVIEW_BASE_URL`(인터랙티브) 또는 소스폴백 | INF 유무 무관(조인키=raw 경로) |
| U1 | Chrome CDP(9222) + 로그인 | 사용자가 메뉴로 실화면 진입(권한·컨텍스트 살아있음) |
| U2 | 가이드형 세션 루프(화면 1개씩) | 현재화면 캡처(`capture_screen_dom.js`, 탭 검출) → 사용자 구조 확인 → 탭 순회 캡처 → 소스 슬라이스(`collect_screen_slice.py`) → `ddd-ui-agent`(sonnet) → `{도메인}/UIS/UIS-{CODE}-{NNN}_{화면명}/`(spec.md+이미지+탭) |
| U2'' | 소스폴백(앱 미구동) | DOM 없이 소스 슬라이스만 |
| U3 | 전체 sweep: UIS↔INF 재연결 | `link_uis_inf.py`(api_hints raw경로 ↔ INF path 조인, 양방향) |
| U4 | SpecLens 인덱스/IA 갱신 | `gen_docsify.py` → 다음 안내 |

**전제**: `_tmp/recon_checkpoint.json`. **다음**: `/sl-recon-doc`.

---

### `/sl-recon-doc` — FUNC/SRS/RTM/IA (RECON Phase 3)
> 산출물을 **FUNC-ID로 집약**하고 SRS·RTM을 생성.

| STEP | 동작 | 산출 |
|---|---|---|
| 9 | Phase-C: 색인 + FUNC + FUNC_MAP | 9-0 `build_funcs_index.py` / 9-1 `merge_index.py` / 9-2 `rd-agent`(haiku, FUNC) / 9-3 `srs-agent`(sonnet, SRS 합성) / 9-4 `rtm-agent`(opus, FUNC_MAP 체인+게이트) → `docs/00_FUNC/FUNC_MAP.md`, `docs/03_기능명세서/` |
| 9-5 | 도메인 SOP 개요 | `build_domain_overview.py` → 신규자 내러티브 |
| 10 | IA 맵은 `/sl-ia`로 | 안내 |
| 11 | 완료 안내 | RECON 완료 |

**전제**: INF 존재, `recon_checkpoint.json`. **다음**: `/sl-ia`·`/sl-context`·`/sl-aidd`.

---

### `/sl-aidd` — FUNC=story BMAD 루프 (AIDD)
> FUNC-ID 단위 story 루프로 구현·QA·테스트를 반복. JIT 그라운딩이 story에 주입됨.

| STEP | 동작 |
|---|---|
| 0 | 사전 확인(`FUNC_MAP.md` 등) |
| 1 | 대상 FUNC 결정 |
| **2~6** | **FUNC(=story)별 순차 루프**: |
| 2 | SM: `build_story.py` → `STORY-{FUNC}.md`(INF 앵커+SCH 쿼리계약+UIS 주입), **✋승인**(Draft→Approved) |
| 3 | Dev: `dev-agent`(sonnet) 구현(앵커 Read로 실코드 JIT 판독, `linked_func` 주석) |
| 4 | QA: `qa-agent`(sonnet, 독립 컨텍스트) 3-Layer 게이트 **PASS/CONCERNS/FAIL** |
| 5 | Test: `test-agent`(haiku) TC 실행 |
| 6 | **✋최종 확인** + 상태갱신(`req_scan.py` 커버리지, FUNC_MAP ✅, story=Done) |
| 7 | 최종 커버리지 리포트 |

**전제**: `FUNC_MAP.md`. **추적**: FUNC-ID 불변.

---

### `/sl-change` — 변경 전주기 (DELTA)
> SR(Jira/로컬) 한 건을 받아 분류·영향분석·TO-BE 설계·스펙 현행화까지. `--quick`은 SR 없이 경량.

| Step | 동작 |
|---|---|
| 전제 | `project.env`, `docs/05_설계서/`(로컬 또는 `NETWORK=open`) |
| 1 | SR 수집(Jira MCP 또는 로컬 파일 + 첨부 추출) |
| 2 | SR 유형 분류 |
| 3 | 정보 충분성 검증(부실/DRM → 보강) |
| 4 | 1차 스코프(도메인 특정) |
| 5 | **AS-IS 그라운딩**(그래프 영향슬라이스 + 소스앵커 JIT read, `build_change_context.py`) |
| 6 | 영향범위 정밀 분석(ripple 랭킹·격리) |
| 7 | TO-BE 설계 |
| 8 | SR 산출물 생성(`docs/변경관리/{SR}/`) |
| 9 | 프로젝트 스펙 현행화 |
| 10 | RTM 현행화 |
| 10-B | Spec-First 승인 토큰 + `sprint-status.yaml` 업데이트 |
| 11 | Jira 상태 업데이트 + 완료 안내 |

**추적**: SR-ID 단일 축. **다음**: `/sl-aidd`.

---

### `/sl-test` — 테스트 (모드형)

| 호출 | 동작 |
|---|---|
| `/sl-test` | RTM/FUNC_MAP 기반 TC 작성·실행 → TR 생성 (`test-agent`) |
| `/sl-test --bug` | 실패 TC → Jira Bug 자동 등록 |
| `/sl-test --perf` | 성능 테스트(SRS 비기능 기준) |
| `/sl-test --report` | TR을 Confluence 게시(오픈망) |

**전제**: 소스 존재(`SOURCE_*_PATH`), FUNC_MAP.

---

### `/sl-status` — 추적·현황

| STEP | 동작 |
|---|---|
| 0 | 전제 확인(`FUNC_MAP.md`) |
| 1 | `sprint-status.yaml` 생성/갱신(선행) |
| 2 | 분기: `--coverage`(커버리지·갭) / `--next`(진행·추천) / `--publish`(게시) / 무플래그(통합 대시보드) |

---

### `/sl-context` — 프로젝트 패턴 추출
1 사전확인+프레임워크 감지 → 2 INF 패턴 수집 → 3 소스 샘플링 → 4 `docs/project-context.md` 생성 → 5 완료 보고. **전제**: INF 존재.

### `/sl-ia` — IA 트리
1 route 파일 스캔 → 2 UIS `menu-path` 일괄 업데이트 → 3 `docs/00_IA/IA_MAP.md` 생성 → 4 `spec_index.json` 갱신. **전제**: UIS spec.md 존재.

### `/sl-viewer` — SpecLens 웹 뷰어
| STEP | 동작 |
|---|---|
| 1 | `gen_docsify.py` → `spec_index.json` 갱신 + 뷰어 자산 동기화(플러그인→`docs/viewer/`) |
| 2 | 뷰어 서버 시작(프로젝트 루트, 백그라운드) → `http://localhost:5173/docs/viewer/index.html` |
| 3 | 인터랙티브 모드(CDP 9222 자동 기동 + `watch` 루프) — 버튼([🔄재생성]·[⚙생성]) 픽업. **Jira 불필요** |
| 4 | SR 작업보드(선택, Jira: `MCP_JIRA`+`JIRA_PROJECT/JQL`) |
| 5 | 개별 스펙 재생성([🔄] 버튼 → 그 스펙 1개만) |

---

## 3. 받쳐주는 것들

**서브에이전트(15)** — 생성: `spec-agent`(SAD/도메인, sonnet) · `rd-agent`(FUNC, haiku) · `srs-agent`(SRS, sonnet) · `sad-agent`(아키텍처, opus) · `ddd-api-agent`(INF, sonnet) · `ddd-db-agent`(SCH enrichment, haiku) · `ddd-ui-agent`(UIS, sonnet) · `ddd-batch-agent`(BAT, haiku) · `rtm-agent`(FUNC_MAP+게이트, opus). 코드: `dev-agent`(sonnet) · `qa-agent`(sonnet) · `test-agent`(haiku). 보조: `profile-agent` · `convention-learner` · `meta-extractor`.

**산출물 구조**
```
docs/
 ├ 00_FUNC/FUNC_MAP.md          ← 추적 SSoT, stories/STORY-*.md
 ├ 00_IA/IA_MAP.md
 ├ 02_추적표/ (RTM)
 ├ 03_기능명세서/ (SRS)
 ├ 05_설계서/
 │   ├ _domain_plan.json
 │   ├ _machine/query_patterns.json   ← JIT 기계 레이어
 │   └ {도메인}/{INF,SCH,UIS,BAT}/
 ├ 변경관리/{SR}/
 └ viewer/ (SpecLens: index.html·docsify-sl.js·spec_index.json)
.speclinker/  profile.yaml · inf_targets.json(census) · spec_manifest.json · table_registry.json · screen_plan.confirmed.json
_tmp/         (휘발성: source_index·router_inventory·mcp_status·recon_checkpoint …)
```

**MCP** — 내장(SELECT 전용, readonly 이중방어): `oracle/db2/mariadb_schema_server.py`(7 도구: list_schemas/tables·describe_table·get_indexes·get_foreign_keys·execute_select·full_table_spec). 외부 템플릿: MySQL·MSSQL·PostgreSQL(npx)·Atlassian(uvx mcp-atlassian, Jira+Confluence)·GitHub. 활성화: `project.env`의 `MCP_DB_*`·`MCP_JIRA`·`MCP_WIKI`·`NETWORK=open`.

**핵심 설계원칙** — ①소스=진실, 스펙=소비자별 레이어(기계 인덱스+앵커 / 사람 내러티브) ②사실=zero-token 스크립트, 의미만 LLM ③JIT 그라운딩(요약 주입 대신 그래프+소스앵커) ④멱등·스택중립·문서동기화. (상세: `docs/report/speclinker-paper.md`)
