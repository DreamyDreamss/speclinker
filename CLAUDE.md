# Speclinker — 플러그인 두뇌 (CLAUDE.md)

## 개요

이 파일은 SM(운영 중 시스템) 스펙 역생성 + AIDD 자동화 플러그인 Speclinker의 라우팅 규칙을 정의합니다.
현행 소스에서 INF/SCH/UIS/FUNC를 역추출(RECON)하고, FUNC-ID 단위 AIDD·변경관리(DELTA)를 수행합니다.
사용자 입력을 분석하여 적절한 스킬(Skill)로 라우팅하고, 서브에이전트를 조율합니다.
(SI/신규구축용은 별도 플러그인 — 이 플러그인에 GENESIS 순방향 모드는 없습니다.)

## ⚠️ 핵심 설계 원칙 — 범용성 (MUST)

> **Speclinker는 특정 프로젝트·기술 스택에 종속되지 않는 범용 도구다.**
> 이 플러그인을 개발·수정할 때 아래 원칙을 반드시 지킨다. 위반은 결함으로 간주한다.

1. **스택 중립**: Java/Kotlin Spring, Next.js(React/TS), Vue, NestJS, FastAPI/Django(Python), Go 등
   어떤 스택에서도 동작해야 한다. 특정 프로젝트(예: nkshop) 구조를 전제하지 않는다.

2. **언어 중립 신호 우선**: 도메인 분류·경로 추출 등은 **모든 언어에 존재하는 신호**를 1차 기준으로 한다.
   - ✅ 1차: 파일 **디렉토리 경로**(`relPath`) — 모든 언어·프레임워크에 존재
   - ⚠️ 보조: 언어별 메타데이터(Java `package`, 어노테이션 등) — 있으면 보강, 없어도 동작
   - ❌ 금지: 특정 언어 전용 필드(`package`)에만 의존하는 로직 → 타 스택에서 0건/전부 unknown

3. **프레임워크 보일러플레이트 자동 흡수**: 경로 공통 prefix(`src/main/java/...`, `src/app/`, `src/pages/`,
   `app/`, 회사 패키지 prefix 등)는 자동 감지·제거한다. 하드코딩 금지.

4. **멀티모듈 대응**: 한 워크스페이스에 여러 모듈(admin/scm, api/web/batch 등)이 섞일 수 있다.
   단일 prefix를 가정하지 말고, 모듈 경계를 자동 처리한다.

5. **다중 스택 검증 의무**: 새 스크립트·스킬은 **최소 2개 이상 이질적 스택**으로 검증한다.
   (예: Java Spring 프로젝트 + Next.js 프로젝트). 단일 프로젝트 통과만으로 완료 처리 금지.

> **참고 실측**: nkshop-bos-admin = Java Spring(`*Controller.java`, `package` 존재),
> KDI = Next.js(`src/app/{도메인}/page.tsx`, `package` 없음). 두 구조 모두 도메인 추출이 동작해야 한다.

## ⚠️ 참조 문서 동기화 (MUST)

> **신규 기능 추가·프로세스 변경·파이프라인 STEP 재배치·파일/경로 구조 변경 시, 아래 "정본 참조 문서"를
> 같은 변경 안에서 반드시 함께 갱신한다.** 코드/스킬만 바꾸고 참조 문서를 방치하면 문서가 stale 되어
> (특히 다음 세션의) 분석을 오도한다. 위반은 결함으로 간주한다. — 실제 사고 사례: `RECON_PIPELINE.md`가
> v2.19에 멈춰 있어 "recon은 INF를 안 만든다"는 오분석을 유발했고, legacy `sl-recon-inf`를 현행으로 착각함.

### 정본 참조 문서 레지스트리

| 문서 | 무엇의 정본인가 | 언제 갱신 |
|------|----------------|----------|
| `docs/RECON_PIPELINE.md` | RECON 3-Phase 커맨드별 STEP·에이전트·산출물 흐름 | recon 계열 STEP/에이전트/산출경로 변경 시 |
| `CLAUDE.md` (이 파일) | 커맨드 라우팅표 · 서브에이전트 모델표 · 파이프라인 · **버전 노트** | 스킬/에이전트/라우팅/모델 변경 시 |
| `scripts/README.md` | 스크립트 목록 · 사용 STEP · 스크립트 간 의존 흐름 | 스크립트 추가/삭제/호출위치 변경 시 |
| `README.md` | 스킬 트리 · 파이프라인 개요 | 스킬 추가/삭제 시 |
| `docs/SETUP_GUIDE.md` | 사용자 실행 순서(Phase) | Phase 구성 변경 시 |
| `templates/*.md` | 산출물 형식의 정본 | 산출물 구조 변경 시 |
| 해당 `skills/*/SKILL.md`, `agents/*.md` | 그 커맨드/에이전트의 실제 동작 | 동작 변경 시 (1차 진실의 원천) |

### 변경 완료 전 체크리스트 (DoD)

```
[ ] 동작을 바꾼 SKILL/agent/script가 1차 진실의 원천 — 여기부터 정확히 수정했는가?
[ ] 위 레지스트리에서 영향 문서를 모두 골라 같은 변경에 포함했는가?
[ ] STEP 번호·커맨드 순서·산출물 경로를 바꿨다면 RECON_PIPELINE.md를 현행화했는가?
[ ] 스킬/에이전트를 삭제했다면 라우팅표·파이프라인·README·다른 스킬의 "다음 커맨드"·전제조건
    문구에서 그 참조를 전부 제거했는가? (grep로 잔존 0 확인)
[ ] CLAUDE.md 버전 노트(> vX.Y) 1줄을 추가했는가? plugin.json version도 bump했는가?
[ ] 산출물 형식을 바꿨다면 templates/ 정본도 같이 바꿨는가?
```

> **자기검증 권장:** 변경 후 `grep -rn "<삭제/변경 키워드>" skills agents scripts docs templates`로 잔존 참조 0을 확인.

## 커맨드 라우팅 규칙

| 사용자 입력 | 라우팅 스킬 | 전제 조건 | 분류 |
|-----------|-----------|---------|------|
| `/sl-init` | `skills/sl-init/SKILL.md` | 없음 | 공통 |
| `/sl-recon` | `skills/sl-recon/SKILL.md` | project.env, 소스코드 존재 | RECON |
| `/sl-recon-uis` | `skills/sl-recon-uis/SKILL.md` | _tmp/recon_checkpoint.json | RECON |
| `/sl-recon-doc` | `skills/sl-recon-doc/SKILL.md` | docs/05_설계서/ INF 존재, _tmp/recon_checkpoint.json | RECON |
| `/sl-aidd [FUNC-ID]` | `skills/sl-aidd/SKILL.md` | docs/00_FUNC/FUNC_MAP.md 존재 | AIDD (story 루프: 구현·QA·테스트 통합) |
| `/sl-change <SR-ID> [--quick\|--full]` | `skills/sl-change/SKILL.md` | project.env, docs/05_설계서/ (로컬 파일 또는 NETWORK=open) | DELTA (변경 전주기·경량 통합) |
| `/sl-status [--coverage\|--next\|--publish]` | `skills/sl-status/SKILL.md` | docs/00_FUNC/FUNC_MAP.md | 추적 (커버리지·진행·갭·게시 통합) |
| `/sl-test` | `skills/sl-test/SKILL.md` | 06_소스코드/ 존재 | 전체 |
| `/sl-context` | `skills/sl-context/SKILL.md` | docs/05_설계서/ INF 존재 | RECON 후 |
| `/sl-drift [도메인] [--since Nd]` | `skills/sl-drift/SKILL.md` | git 저장소, docs/05_설계서/ INF | SDD 유지 |
| `/sl-ia [도메인\|--update-only]` | `skills/sl-ia/SKILL.md` | docs/05_설계서/UIS/ spec.md 존재 | RECON 후 |

## 전제 조건 체크

모든 커맨드 실행 전 다음을 확인한다:

```bash
!cat project.env 2>/dev/null || echo "project.env 없음 — /sl-init 먼저 실행 필요"
```

## 서브에이전트 조율

### 산출물 생성 파이프라인 (spec-agent 오케스트레이터 → 전문 서브에이전트)

| 에이전트 | 역할 | 모델 | 기법 |
|--------|------|------|------|
| `agents/spec-agent.md` | Phase-A(SAD+도메인 확정) | **Sonnet** | 순차/병렬 조율 |
| `agents/rd-agent.md` | FUNC_v1.0 생성 | **Sonnet** | 인덱스 포맷팅 |
| `agents/srs-agent.md` | SRS 집약 | **Sonnet** | 사실 집계 |
| `agents/sad-agent.md` | 아키텍처 설계서 | Opus | 패턴 매칭 + Self-Critique |
| `agents/ddd-api-agent.md` | API 명세 (INF-XXX) | Sonnet | DSPy-style 구조화 출력 |
| `agents/ddd-db-agent.md` | DB 스키마 (SCH-XXX) **enrichment** — 코드값·비즈주의·컬럼설명만 (사실은 build_sch_static가 생성) | Sonnet | LLM-TODO 마커 보강 |
| `agents/ddd-ui-agent.md` | SOP급 화면설계 (UIS) | Sonnet | 소스 권위(슬라이스 Read) + DOM 스냅샷 골격, §2 작업 시나리오·탭별 §4·마커 (v3.9 가이드형) |
| `agents/ddd-batch-agent.md` | 배치 명세 (BAT-XXX) | Sonnet | 배치 확정 판별 + MCP DB 스케줄 조회 |
| `agents/rtm-agent.md` | FUNC_MAP 체인 + 품질 게이트 | Opus | Constitutional AI |

### 코드·테스트 에이전트

| 태스크 | 서브에이전트 | 모델 | 이유 |
|--------|-----------|------|------|
| 코드 생성 | `agents/dev-agent.md` | Sonnet | 반복 실행 태스크 |
| QA 게이트 | `agents/qa-agent.md` | Sonnet | dev와 분리된 독립 컨텍스트 3-Layer 검증 |
| 테스트 | `agents/test-agent.md` | Sonnet | 반복 실행 태스크 |

> **v3.13.0** (스펙 활용성 + REQ 잔재 제거): 사용자 관점 recon 스펙 가독성·활용성 개선. ①**REQ(req-f) 전면 제거** — v3.0 REQ 폐기 누락분(ddd-api/ddd-ui frontmatter `req-f`, build_funcs_index `reqF`, merge_index 색인 `req_f` 컬럼[헤더는 FUNC-ID인데 값은 [TBD]였던 오표기]) 정리. 역공학은 요구사항 추출 불가 → req-f 부재가 정상. **srs-f는 유효축(SRS는 RECON 산출물) 유지**. ②INF H1 아래 `> 개요:` 1줄(업무관점) — 비개발자 훑기용(ddd-api-agent). ③SpecLens가 **raw YAML frontmatter를 접이식 '📋 메타데이터' 블록**으로 렌더(모든 스펙 상단 yaml 노출 노이즈 제거, anchors 등 정보는 펼치면 보존). ④**INF 본문 테이블명→SCH 크로스링크**(spec_index.schs.table 정확매칭, 녹색) — 템플릿 변경 없이 모든 INF가 스키마로 점프. (C 원안=tables frontmatter 본문이동은 build_sch_todo 게이트 의존이라 폐기→뷰어 접이식으로 대체). 회귀 10테스트 + playwright 스모크.
> **v3.12.0** (RECON-doc 현행화 마무리 + SpecLens 통합 + 연결그래프): ①orphan si-graph 제거(sl-recon-doc STEP 9-0-1/11, build_si_graph DEPRECATED — 소비처 0, 스펙→소스는 INF anchors+spec_index가 대체) ②rtm 9-4 프롬프트 사실링크화(`related_sch` 미존재필드 제거→funcs_index `infs[].sch_ids`) ③`build_funcs_index` INF→SCH 링크(`collect_sch_index`, nkshop 183 INF) ④`gen_docsify` `funcs[]` 인덱싱(FUNC_MAP 파싱)+`domains[].overview` ⑤SpecLens `goToId` FUNC 해소(죽은클릭 수정)+크로스링크 대소문자+도메인 OVERVIEW 링크 ⑥**스펙 연결 mermaid 그래프**(연결패널 🕸버튼, 시작점 N-hop 깊이1~3, 노드 클릭 이동). 테스트 test_funcs_index_uis(3)/test_speclens_index(7) + playwright 그래프 스모크. 설계·플랜 docs/superpowers/{specs,plans}/2026-06-06-recon-doc-speclens-integration*. **범위 밖(별도)**: FUNC_v1.0/SRS LLM 축소 재설계.
> **v3.11.1** (sl-ia 동일 결함 핫픽스 + IA 경로 정정): `/sl-ia`도 v3.9 미전파로 top-level `docs/05_설계서/UIS`만 스캔→도메인중첩(`{도메인}/UIS`)에서 0개 FAIL이던 결함 수정(전제조건·STEP3을 도메인중첩+top-level+레거시UI glob로, api_hints 폴백 추가). nkshop 0→2 검증. v3.11.0 편집 중 잘못 적은 IA 산출 경로 `06_IA`→실제값 `00_IA/IA_MAP.md`로 정정(sl-recon-doc·RECON_PIPELINE).
> **v3.11.0** (sl-recon-doc 현행화 — v3.9 UIS 미전파 결함 수정): v3.9 UIS 재설계가 화면 출력을 `{도메인}/UI/{screenId}/`→`{도메인}/UIS/UIS-{CODE}-{NNN}_{화면명}/`로 바꿨으나 Phase-3(sl-recon-doc) 소비자들이 미갱신돼 **화면 0개·FUNC/SRS/FUNC_MAP 빈손**이던 결함. ①`build_funcs_index.py`·`build_si_graph.py`·`merge_index.py` 화면 디렉토리 스캔을 'UIS' 우선·'UI' 하위호환으로 수정(specPath도 실제 디렉토리명 사용) ②INF 식별 정규식 현행화: build_funcs_index 본문참조 `INF-\d+`→`INF-[A-Z]+-\d+`, build_si_graph 파일매칭 `^INF-\d+\.md$`→`^INF-.+\.md$`(실제 INF-PRD-001 형식 — si-graph INF 노드 0→815) ③sl-recon-doc 전제조건에서 **삭제된 `screen_inventory.json`(v3.9 생성기 삭제) 의존 제거** → UIS spec.md 존재로 게이트, 최종 체크포인트도 동일 ④STEP 10의 미존재 `ia_map_builder.py` 호출 제거 → IA는 `/sl-ia` 안내 ⑤완료메시지·rd/srs-agent 출력 경로·RECON_PIPELINE.md UI→UIS 동기화. 검증: nkshop 실데이터 화면 0→2(FUNC 0→2, si-graph uis 0→2, UI_Spec 색인 0→4), 회귀 테스트 `test_funcs_index_uis.py`(UIS+레거시UI 2개). gen_obsidian_index는 deprecated라 제외.
> **v3.10.0** (SpecLens 뷰어 재설계): 뷰어에 ①UIS 미리보기 라이트박스 확대+카드 확대 ②INF/UIS/SCH 상세 **연결관계 패널**(UIS→호출 API→관련 테이블→linked FUNC, 클릭 이동) ③**브레드크럼**+사이드바 **글로벌 구조검색** ④대시보드 헤더정렬+**연결 갭 배지**+stale 경고 ⑤반응형(≤900px 사이드바 토글)·키보드 접근성(role=button Enter/Space, focus-visible)·BAT탭 조건부('준비 중' 제거) 추가. `gen_docsify.py` 인덱스에 관계필드 보강(`uis.inf_ids`·`inf.sch_ids`·`*.func`·`gaps`, 전부 추가=하위호환, 없으면 graceful degrade). 2스택 픽스처 단위테스트 `scripts/tests/test_speclens_index.py`(5). docsify-sl.js/sl-theme.css/sl-viewer SKILL/scripts-README 동기화. 설계서·플랜 `docs/superpowers/{specs,plans}/2026-06-05-speclens-redesign*`. **실데이터(nkshop) 호환성 검증서 CRITICAL fix**: 실 UIS `api_hints`는 `"METHOD [INF-ID](link)"`/`"METHOD /path"`(따옴표 가능) 형식 → resolve_uis_inf를 ①박힌 INF-ID 추출 ②메서드 토큰 제거 후 경로 ③컨텍스트 접두(/app) suffix 매칭으로 수정(초판은 0/2→수정 2/2 해소). RECON-only엔 FUNC_MAP 없어 linked FUNC는 graceful 생략.
> **v3.9.0** (UIS 생성 근본 재설계): 화면설계서를 라이브 캡처(BFS/goto)에서 만드는 4한계(권한·메뉴컨텍스트 위젯 누락, 세션의존·truncation, UIS↔INF 미연결, 프레임워크 idiom 무한케이스)를 한 뿌리로 진단. **`/sl-recon-uis`를 가이드형 대화 세션으로 전면 재작성**(BFS 전수탐색·goto 일괄캡처 폐기): ⓐ 사용자가 메뉴로 화면 진입(메뉴컨텍스트·권한 살아있어 auth:button까지 완전 렌더) ⓑ DOM=중립 뼈대/소스=의미, **에이전트가 소스를 읽어 일반화**(파서 아님—스택중립) ⓒ raw경로 조인키로 INF 매핑(순서무관·양방향). **신규** `capture_screen_dom.js`(메뉴진입 현재화면 캡처, 위젯 최다 프레임 선택, 위젯상한 제거, --list-tabs/--tab-text 가이드형 탭 순회) + `collect_screen_slice.py`(screenId stem 매칭으로 core/related 슬라이스 + 엔드포인트 추출, 스택중립). **ddd-ui-agent 재정의**: SOP급 출력(§1 목적·§2 작업 시나리오·§3 블록·§4 위젯·액션[탭별 §4.{N}]·§5 권한·§6 데이터·anchors), 마커=§4 문서화 위젯 자동출력. **출력 규약**: `{domain}/UIS/UIS-{CODE}-{NNN}_{화면명}/`(화면당 디렉토리, 탭=섹션—한 라우트·한 저장이면 별도 UIS 아님). **SpecLens**: gen_docsify 도메인별 UIS 스캔 + 뷰어 이미지 경로 재작성 훅(`![[]]`/상대 `![]()` → 문서 디렉토리 기준)으로 화면당 디렉토리 자산 렌더. link_uis_inf 새 경로 대응. 실측 검증: pr201Form(상품등록) goto 187위젯(권한버튼 누락) vs 메뉴진입 216위젯(전부 렌더) + 8탭 순회 캡처(위젯 222→56 차등). 설계문서 `docs/superpowers/specs/2026-06-05-uis-interactive-source-authority-design.md`.
> **v3.3.0** (B3): `/sl-status` 추적 통합 — sl-rtm(커버리지·갭·게시) + sl-sprint(진행·추천·sprint-status 생성) 흡수·삭제. 플래그 --coverage/--next/--publish, 무플래그=통합 대시보드. sl-drift·rtm-agent 보존. skills 12. **명령어 통합(B) 완료: 19→12.**
> **v3.2.0** (B1): `/sl-change` DELTA 단일 통합 — sl-plan/sl-analyze/sl-quick 흡수·삭제(analyze는 sl-change 전주기와 중복, quick은 `--quick` 분기, plan 경량리포트는 --quick 1단계). **REQ-C/RD_v 폐기 → SR 단일 추적축**(RTM이 SR→INF/SCH/UIS 직접). skills 13. RECON·AIDD 무영향.
> **v3.1.0** (B2): `/sl-aidd`를 BMAD story 루프로 재구성 — sl-dev/sl-check/sl-review 스킬 흡수·삭제, `agents/qa-agent.md`(독립 컨텍스트 3-Layer 게이트) 신설, `scripts/build_story.py`(FUNC→STORY 마크다운) 신설, FUNC별 story 파일(docs/00_FUNC/stories/) + 상태머신(Draft→Approved→InProgress→Review→Done) + 사람 승인 3지점. dev/test 에이전트는 재사용(루프가 서브 호출). func_context_bundle mode·ensure_ascii 잔존버그 제거. 추적 축 FUNC-ID 불변.
> **v3.0.0**: SM 전용 전환 — GENESIS 모드·REQ-ID/RD·MODE 개념 전면 제거. 추적 축 = FUNC-ID(RECON) + SR(DELTA). sl-genesis/RD_template/미참조 legacy 스크립트 삭제, 공유 에이전트(rd/srs/spec/sad/rtm) RECON 경로만 보존, 항상 linked_func, ddd-* 크로스링크 FUNC-ID만. SI(신규구축)용은 별도 플러그인. plugin.json description SM 중심으로 갱신.
> **v3.8.0** (INF 레이어 재설계): 소스=진실, 스펙=소비자별 레이어. **4-1** full-chain 앵커(INF frontmatter `anchors:` 배열=controller→service→DAO/mapper, spec_graph_build가 읽음, ddd-api-agent 지침). **4-2** `scan_code_literals.py`(쿼리 코드값+소스 JT_CODE 그룹신호 추출→의도복원, nkshop 195컬럼/58 그룹복원) + ddd-db-agent DB/probe 해소 지침. **4-3** INF 본문=짧은 abstract(정본 진실은 앵커, 코드값 의도만 포함). **4-4** `eval_anchor_coverage.py`(앵커 체인 커버리지+메타 정확도, 검증가능; eval_fidelity 폐기—self-consistency는 충실도 아님). **4-5** `build_domain_overview.py`를 sl-recon-doc STEP 9-5(사람 SOP 레이어, 기계인덱스 분리). brownfield SDD 정리: AS-IS=서술(코드=진실)/TO-BE=처방(스펙=진실).
> **v3.7.0** (개선 로드맵 T1~T4): **T1** `extract_entities.py`(SR/첨부→엔티티 자동추출) + build_change_context **ripple 랭킹·편재격리**(JT_CODE 176노이즈→광역공통자원)·전이(--hops). **T2** freshness 게이트(소스>스펙 mtime→STALE, 소스를 1차진실). **T3** `eval_fidelity.py`(테이블추출 P/R/F1, nkshop 실측 P0.70/R0.18/F0.28=결함#1 정량입증) + `eval_aidd.py`(A/B 하네스). **T4** ddd-db-agent 코드값 사실역인용(출처표기·[미확인]) + `build_domain_overview.py`(신규자 SOP 내러티브, 기계인덱스 분리). 단위테스트 7파일.
> **v3.6.0** (RECON 실전결함 수정): nkshop RECON 세션에서 도출된 CRITICAL 3건 수정. **C-1** STEP 4-1 도메인 매칭이 절대경로 filePath vs 상대 rootPaths로 항상 False→INF 0개 조용한 실패: filePath/relPath 양쪽 startswith로 보강 + 0건 WARN 가드. **C-2** 두 디스패처(dispatch_inf_gen/sch_gen)의 인덱스 기반 done[]이 inventory 변경 시 신규작업 stale-skip: `inventory_hash` 불일치 시 done/failed 자동 리셋(sch_gen은 파일스캔 폴백 없어 더 시급했음). **C-3** build_uis_goto_plan이 모든 kind=form을 독립화면 취급→jwork/legacy MVC에서 *List/*Pop 등 AJAX 조각 직접 goto시 프레임워크 예외("전부 익셉션"의 원인): screenId *Form 진입 휴리스틱+조각접미사 제외, jwork 감지 시만 적용(Next.js 무영향), SL_FRAGMENT_SUFFIXES/SL_ENTRY_REGEX override.
> **v3.5.0**: sl-change AS-IS 주입을 요약스펙 로드 → **그래프 기반 영향슬라이스 + 소스앵커 JIT read**로 전환. `spec_graph_build.py`(스펙 frontmatter서 forward/reverse 그래프), `build_change_context.py`(SR 엔티티→영향슬라이스+근거소스 앵커(file:line)+ripple 경고 브리프, zero-LLM), `extract_attachments.py`(PPT/Word/Excel 추출, lazy). sl-change Step 1-D(첨부추출)+Step 5(그래프 JIT). 에이전트가 앵커 file:line을 Read해 최신·정밀 AS-IS 확보(요약 손실·stale 회피). 프로세 스펙은 납품물·폴백 유지. spec_graph.json 없어도 동작. nkshop 검증: 공통코드 JT_CODE 변경→176 INF ripple 자동검출.
> **v3.4.0**: SCH 생성 하이브리드화 — 사실(컬럼·타입·인덱스·FK·ERD·링크·DB_{도메인}·DB_Schema)은 `build_sch_static.py`(zero-token, `sch_facts.py`로 sch_draft+CREATE TABLE+ORM+선택적 DB드라이버 merge), 의미(코드값·비즈주의·컬럼설명)만 `dispatch_sch_gen.py`(enrichment 디스패처, dispatch_inf_gen 미러)가 ddd-db-agent(enrichment 모드)에 위임. sl-recon STEP 5 = 5-0(skip)/5-A(static)/5-B(enrich)/5-1(link). SCH 출력 형식·경로 무변경(뷰어/링크 무영향). 토큰 ~70%↓ + 컨텍스트 격리 + 실패 자동 재시도. 무DB는 컬럼명 스켈레톤+LLM-TODO 폴백(nkshop 검증).
> v2.60: 뷰어 이름 **SpecLens** 명명 — index.html 타이틀·docsify-sl.js 로고/대시보드·/sl-viewer 스킬·README 반영. (플러그인명 Speclinker는 유지, 뷰어 정체성만 SpecLens)
> v2.59: SCH 생성 멱등성 — sl-recon STEP 5-0 `build_sch_todo.py` 신설(INF tables: 합집합 vs 기존 SCH frontmatter 비교 → 누락 테이블 있는 도메인만 `_tmp/sch_todo.json`). 누락 0 도메인은 ddd-db-agent 미호출, 부분 도메인은 `existing` 전달해 누락분만 생성. ddd-db-agent에 "이미 생성된 SCH 테이블 재생성 금지" 입력 추가. INF의 group_already_done과 동형 — recon 재실행 시 INF·SCH 모두 스킵.
> v2.58: sl-recon-uis 도메인 선택 체크포인트 추가 — 인수 없이 실행하면 도메인 목록(도메인별 goto form 화면 수 미리보기)을 보여주고 전체/특정 도메인을 사용자에게 질문(INF 도메인선택과 동형). 인수 주어지면 프롬프트 생략. 도메인 필터는 build_uis_goto_plan.py 3번째 인자(relPath 기반 assign_file_domains)로 goto 플랜에 적용. RECON_PIPELINE.md Phase 2 정합.
> v2.57: RECON 문서 현행화 + 참조문서 동기화 강제. legacy `/sl-recon-inf` 삭제(INF·SCH 생성은 v2.53 도메인선택형 리팩토링으로 이미 `/sl-recon` STEP 4-3/5에 통합됨). `link_inf_sch_new.py`를 `/sl-recon` STEP 5-1로 재배선(INF→SCH 링크 패치 누락 복구). sl-recon STEP 5 SCH 프롬프트를 개별파일 구조로 정정. RECON_PIPELINE.md/README/SETUP_GUIDE/scripts-README의 stale recon-inf·DB_Schema_{domain} 참조 일괄 제거. CLAUDE.md에 "참조 문서 동기화(MUST)" 레지스트리+DoD 신설.
> v2.56: SCH 명세 테이블당 개별파일 구조 + 뷰어 경로/링크 라우팅 수정. SCH가 INF와 대칭(`{도메인}/SCH/SCH-{CODE}-NNN.md` 개별파일 + 슬림 `DB_{도메인}.md`(도메인 ERD+목록) + `DB_Schema.md` 파일직링크 색인). 앵커(#SCH) 전면 폐기 → INF↔SCH 정확 네비게이션. gen_docsify scan_schs(spec_index.schs[]) + docsify-sl.js goToId SCH해소·SCH탭 + link_inf_sch/merge_index SCH/스캔. 뷰어는 프로젝트 루트 서빙 + 동적 basePath + 자산 자동복사(gen_docsify). 3NF 검증결과/통과여부 산출물에서 제외.
> v2.55: INF 생성 병렬화 개선 — dispatch_inf_gen.py domain_lock 제거(INF-ID 사전배정 신뢰 → 단일 도메인도 병렬 3) + 타임아웃 600→1800초 + stagger 누적버그 수정(간격 방식). ddd-api-agent infIdStart 절대준수(폴더스캔 채번 금지).
> v2.54: 뷰어 사용자 가이드 추가 — docsify-sl.js renderGuide(사이드바 📖 가이드 → 빠른시작 파이프라인·전체 명령어·동작방식·FUNC-ID 체이닝). spec_index 없어도 접근 가능.
> v2.53: 도메인 선택형 RECON + UIS goto 캡처 + **범용성 강화**. scan_source.js에 Next.js/Nuxt 파일경로 라우팅 인식(inferFileBasedRoutes) 추가 — tree-sitter AST 미감지 라우트 보강. build_domain_catalog.py(relPath 디렉토리 기반 범용 도메인 분류, Java+Next.js 검증) + build_uis_goto_plan.py(form URL goto 플랜) 신규. sl-init Step5.5(스캔+카탈로그) / sl-recon STEP1.7(도메인 선택→POC_DOMAINS) / sl-recon-uis STEP6-0-GOTO(form URL 직접 캡처, BFS 폴백). 도메인 분류 기준=relPath(package 전용 금지).
> v2.52: Docsify 웹 뷰어 구현 — gen_docsify.py(스캔→spec_index.json) + docsify-sl.js(대시보드·INF/UIS 탭·Quick Nav·크로스링크·IA 트리) + /sl-ia(IA_MAP.md 자동생성+menu-path 보완). sl-viewer Obsidian→Docsify 교체.
> **v2.39+**: sl-recon STEP 1은 `scan_source.js` (제로-LLM 정적 스캔). v2.41: 컨텍스트 경로 자동 감지(web.xml/Spring Boot/NestJS/FastAPI/.env 6종) + 클래스 레벨 `/*` 와일드카드 strip. v2.44: STEP 1에 tree-sitter 파싱 결과 예시(source_index.json 스키마·필드 설명) 추가. v2.45: resolve_call_chain.py가 source_index.json 재활용 — 파일 재read·os.walk 제거, fast path/fallback 자동 분기. v2.46: dead code 정리 — UA 대시보드·ua_req_bridge.js 참조 제거, link_inf_sch.py(0바이트) 삭제. v2.48: install.ps1 검증 목록 정정(sl-spec→sl-genesis, req_scan.sh→req_scan.py, plugin.json 제거), UA 관련 문서 일괄 정리, installed_plugins.json 자동 등록 추가. v2.49: dispatch_inf_gen.py 도메인별 순차 Lock(INF-ID 레이스 컨디션 방지) + LAUNCH_STAGGER=3(claude CLI 초기화 충돌 방지). v2.50: 5개 산출물 템플릿 SM+AIDD 최적화 — INF(비즈니스룰·트랜잭션순서·사이드이펙트), SCH(코드값·비즈니스주의사항), BAT(비즈니스룰·재처리방법), UIS(apis/related-screens frontmatter), FUNC_MAP(BAT컬럼). v2.51: SDD 파이프라인 전체 구현 — sl-context/plan/check/review/sprint/drift/quick 신규 + sl-analyze/change/dev 강화 + BMAD MIT 차용 템플릿 5종.

모델 분리 전략: 단일 Opus 대비 약 60~70% 비용 절감 (Sonnet 에이전트 10개 중 5개)

## FUNC-ID 체이닝 원칙 (범용 주축)

- **FUNC-ID가 개발 추적의 주축**
- FUNC-ID 형식: `FUNC-{도메인}-{NNN}` (예: `FUNC-order-001`)
- FUNC_MAP.md가 단일 진실의 원천(Single Source of Truth)
- 변경관리는 `SR-ID`(변경요청)로 추적 — `/sl-change` 워크플로우

### 추적 주석 형식

- 모든 생성 코드 상단에 `linked_func: FUNC-domain-NNN` 주석 삽입.

## 환경 분기 원칙

```bash
!cat project.env | grep NETWORK
```

- `NETWORK=open`: MCP 연동 활성화 (Jira, GitHub, Confluence)
- `NETWORK=closed`: 로컬 스크립트만 사용, MCP 비활성화

## 산출물 타입 옵션

| 타입 | 폴더 구조 | 대상 |
|------|----------|------|
| `dev` | specs/req/ api/ db/ | 개발자 전용 빠른 참조 |
| `biz` (기본) | docs/00_FUNC ~ docs/08_테스트결과보고서 | PM·고객사·QA 포함 표준 구조 |
| `split` | docs/specs/ + docs/artifacts/ | ITO 운영 최적, 전체 이해관계자 |

## 에러 처리

| 상황 | 대응 |
|------|------|
| project.env 없음 | `/sl-init` 실행 안내 |
| docs/05_설계서/ 없음 | `/sl-recon` 실행 안내 |
| 06_소스코드/ 없음 | `/sl-aidd` 실행 안내 |
| MCP 연결 실패 | 로컬 파일 fallback 안내 |
| UA 미설치 | `npm install -g understand-anything` 안내 |

## 상황별 파이프라인

| 상황 | 파이프라인 |
|------|-----------|
| 기존 코드 (RECON + AIDD) | sl-init → sl-recon → **sl-aidd** → sl-test |
| 기존 코드 (RECON 분석만) | sl-init(스캔+카탈로그) → sl-recon(도메인 선택) → sl-recon-uis(goto 캡처) → 납품 |
| 변경·유지보수 (Jira) | sl-change &lt;SR&gt; → **sl-aidd** |
| 변경·유지보수 (로컬) | sl-change --new SR-001 → (요구사항 작성) → sl-change SR-001 → **sl-aidd** |
| **SDD 전체 파이프라인** | sl-recon → **sl-ia** → **sl-context** → sl-status → sl-change → **sl-aidd** (story 승인→구현→QA→테스트) |
| SDD 소규모 변경 | **sl-change --quick** "설명" (SR 없이 경량 경로) |
| SDD 드리프트 점검 | **sl-drift** (주기적 스펙-코드 정합성 감지) |

### AIDD 핵심 루프 (sl-aidd 내부)

```
FUNC 선택 → build_story.py (STORY-{FUNC-ID}.md 생성, status=Draft)
         → ✋ 사람 승인 (Draft→Approved)
         → dev-agent (코드 생성, linked_func 주석, Approved→InProgress→Review)
         → qa-agent (독립 컨텍스트 3-Layer 게이트: PASS/CONCERNS/FAIL)
                    FAIL → 사람 확인 후 재작업(Review→InProgress)
         → test-agent (TC 실행)
         → ✋ 사람 최종 확인 → req_scan.py(커버리지) + FUNC_MAP ✅ + story=Done
         → 다음 FUNC 반복
```

## 플러그인 설치 및 사용

```bash
# 마켓플레이스 등록 (최초 1회)
/plugin marketplace add DreamyDreamss/speclinker

# 설치
/plugin install speclinker@speclinker

# 사용
/sl-init          # 프로젝트 초기화
/sl-recon         # 현행 소스 → 스펙(INF/SCH/UIS/FUNC) 역생성
/sl-aidd          # FUNC 단위 AI 개발 (코드+테스트)
```
