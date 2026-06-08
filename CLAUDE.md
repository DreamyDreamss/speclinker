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
| `/sl-recon` | `skills/sl-recon/SKILL.md` | project.env, 소스코드 존재 | RECON (INF) |
| `/sl-recon-sch` | `skills/sl-recon-sch/SKILL.md` | docs/05_설계서/_domain_plan.json + INF 존재 | RECON (SCH 분리) |
| `/sl-recon-uis` | `skills/sl-recon-uis/SKILL.md` | _tmp/recon_checkpoint.json | RECON |
| `/sl-recon-doc` | `skills/sl-recon-doc/SKILL.md` | docs/05_설계서/ INF 존재, _tmp/recon_checkpoint.json | RECON |
| `/sl-aidd [FUNC-ID]` | `skills/sl-aidd/SKILL.md` | docs/00_FUNC/FUNC_MAP.md 존재 | AIDD (story 루프: 구현·QA·테스트 통합) |
| `/sl-change <SR-ID> [--quick\|--full]` | `skills/sl-change/SKILL.md` | project.env, docs/05_설계서/ (로컬 파일 또는 NETWORK=open) | DELTA (변경 전주기·경량 통합) |
| `/sl-status [--coverage\|--next\|--publish]` | `skills/sl-status/SKILL.md` | docs/00_FUNC/FUNC_MAP.md | 추적 (커버리지·진행·갭·게시 통합) |
| `/sl-test` | `skills/sl-test/SKILL.md` | 소스 존재(SOURCE_*_PATH) | 전체 |
| `/sl-context` | `skills/sl-context/SKILL.md` | docs/05_설계서/ INF 존재 | RECON 후 |
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
| `agents/spec-agent.md` | Phase-A(SAD+도메인 확정) | **Sonnet** | 순차/병렬 조율 (sl-recon이 `model:"sonnet"` 명시 — frontmatter opus 덮어씀) |
| `agents/rd-agent.md` | FUNC_v1.0 생성 | **Haiku** | 인덱스 포맷팅(기계적 — v3.24 opus→haiku) |
| `agents/srs-agent.md` | SRS 집약 | **Sonnet** | 사실 집계/합성(v3.24 opus→sonnet) |
| `agents/sad-agent.md` | 아키텍처 설계서 | Opus | 패턴 매칭 + Self-Critique |
| `agents/ddd-api-agent.md` | API 명세 (INF-XXX) | Sonnet | DSPy-style 구조화 출력(비즈룰 — 유지; 대량 비용시 SL_DISPATCH_MODEL=haiku) |
| `agents/ddd-db-agent.md` | DB 스키마 (SCH-XXX) **enrichment** — 코드값·비즈주의·컬럼설명·상시필터 의미 + 다중 DB MCP(ora/db2/mdb)로 타입·FK참조컬럼 사실채움 (구조·관찰조인은 build_sch_static) | **Haiku** | LLM-TODO 마커 보강(추출형 — v3.24 sonnet→haiku) |
| `agents/ddd-ui-agent.md` | SOP급 화면설계 (UIS) | Sonnet | 소스 권위(슬라이스 Read) + DOM 스냅샷 골격, §2 작업 시나리오·탭별 §4·마커 (v3.9 가이드형) |
| `agents/ddd-batch-agent.md` | 배치 명세 (BAT-XXX) | **Haiku** | 배치 확정 판별 + MCP DB 스케줄 조회(v3.24 sonnet→haiku) |
| `agents/rtm-agent.md` | FUNC_MAP 체인 + 품질 게이트 | Opus | Constitutional AI |

### 코드·테스트 에이전트

| 태스크 | 서브에이전트 | 모델 | 이유 |
|--------|-----------|------|------|
| 코드 생성 | `agents/dev-agent.md` | Sonnet | 코드 품질 — 유지 |
| QA 게이트 | `agents/qa-agent.md` | Sonnet | dev와 분리된 독립 컨텍스트 3-Layer 검증 — 유지 |
| 테스트 | `agents/test-agent.md` | **Haiku** | TC 생성(기계적 — v3.24 sonnet→haiku) |

> **v3.34.3** (SRS·UIS 링크 클릭 이동 버그 2종 — CDP 라이브 검증): ①**SRS 클릭→인덱스가 뜸**: `scan_srs`가 모든 SRS의 `file`을 인덱스(`SRS_v1.0.md`)로 박아 클릭 시 색인이 떴음 → **도메인 상세(`domains/SRS_{도메인}.md`)로 가리키게 수정**(존재 시, 없으면 인덱스 폴백). ②**UIS 내 INF 링크 이동 안 됨**: beforeEach `.md` 상대링크 재작성이 `](#/docs/...)` 형식이라 **docsify가 `#`를 같은-페이지 헤딩 앵커로 해석→`?id=` 쿼리로 변질**(라우트 이동 X). → **`#/`→`/`(절대경로 라우트 링크)로 수정**. docsify가 `/docs/...md`를 정상 라우터 링크로 변환. (FUNC_MAP·색인문서 인라인 .md 링크 전부 동일 수혜.) **CDP(9222) 라이브 검증**: UIS-PRD-002의 INF-PRD-528 클릭→INF 문서 이동 확인, SRS 클릭→SRS_product.md(SRS-F-001 본문) 렌더 확인. 14 테스트 그린.
> **v3.34.2** (SR보드 로드=목록만, 분석은 지연): 사용자 지적 "보드에서 지라 가져오는 건 목록 조회인데 왜 전수 분석을 하나". v3.34.0 STEP4-2가 티켓마다 build_change_context+scan_sr_material 자동 실행(69건=69회 낭비)이던 것을 제거. **STEP4-2=목록만 inject**(`impact:null`/`material:null`), **STEP4-3=카드 버튼([영향분석]/[자료]/[변경]) 누를 때 그 SR 1개만 지연 분석**. 뷰어는 이미 null→"영향 미산정"+[영향] 버튼으로 지연분석 지원(로직 무변경, SKILL 과잉사양만 제거).
> **v3.34.1** (sl-init이 SR보드 JQL을 실제로 질문): v3.34.0이 project.env 템플릿엔 JIRA_PROJECT/JIRA_JQL을 넣었지만 init에 *명시적 질문 단계*가 없었음. **Step 4-2에 Jira 선택 시 "SR 보드 조회 범위" 질문 추가** — 1)JIRA_PROJECT 키 2)커스텀 JIRA_JQL 3)나중에(보드 실행 시 질문). 폴더명(PROJECT_NAME)≠지라키 경고 포함.
> **v3.34.0** (SR 보드 ↔ Jira 결합 분리 + JQL 설정화): 사용자 지적 ①"스펙 1개 재생성하는데 왜 Jira가 필요?"(watch/regen이 SR보드 STEP3에 묶여 MCP_JIRA 전제였음) ②"어떤 티켓 가져올지 지정 안 했는데 전체 들고오나?"(기본 JQL=`assignee=currentUser() AND project={PROJECT}`인데 {PROJECT} 출처가 없고 PROJECT_NAME=폴더명≠지라키 → 에러 또는 전체조회). **재구조화**: sl-viewer STEP3을 **STEP3(인터랙티브=CDP+watch, Jira 불필요 — 재생성/[⚙생성] 버튼 동작) + STEP4(SR보드=Jira)** 로 분리. 큐 액션표에 Jira 필요여부 열(✕ regen-spec 항상 / ○ sync·analyze·change SR보드 / △ dossier). **JQL 설정화**: STEP4-1 우선순위 `JIRA_JQL`(최우선·임의필터) > `JIRA_PROJECT`(assignee+project+notDone) > **둘 다 없으면 전체조회 금지·질문**. sl-init project.env에 JIRA_PROJECT/JIRA_JQL 항목+안내 추가. **실검증**(jira.ktalpha.com MCP): 사용자 실필터 `(시스템구분="KDI/KDI파트너" OR component=KDI) AND statusCategory!=Done` → 미완료 69건 정상조회(custom field 파싱 OK). nkshop-bos-admin project.env에 JIRA_PROJECT=KSHOPSR + 위 JQL 설정. 스킬/스크립트 로직 무변경(문서·구조만).
> **v3.33.0** (PLUGIN_PATH 업데이트 내성 — 자가치유): 사용자 지적 "설치 캐시 경로엔 버전(3.32.0)이 박혀 있어 `/plugin update` 시 옛 폴더가 삭제되면 project.env의 PLUGIN_PATH가 stale돼 스킬·스크립트가 깨진다 — 애초에 왜 필요하냐". 진단: `${CLAUDE_PLUGIN_ROOT}`는 **hooks/MCP/monitors의 command 필드에서만 보장**(공식 superpowers도 스킬 마크다운엔 안 씀) → 스킬 bash에서 의존 불가. **해법(저위험)**: `setup-deps.js`(SessionStart 훅 — hook이라 `__dirname` 기준으로 현재 설치 버전 PLUGIN_ROOT를 100% 앎)에 **STEP 0 selfHealPluginPath** 추가 — project.env의 PLUGIN_PATH가 비었거나 **존재하지 않는 경로**면 현재 설치 경로로 갱신, **유효한 경로(개발용 로컬 경로 포함)는 존중(미변경)**. 스킬/에이전트/스크립트 본문은 무수정(zero-risk). 단위검증 4케이스(stale 교체/valid dev 유지/missing 추가/타 라인 보존) 통과. sl-init Step2에 자가치유 안내. **부수**: nkshop-bos-admin project.env의 PLUGIN_PATH를 로컬 dev(D:/gen-harness)→설치 캐시(.../3.32.0)로 정정해 설치본을 참조하게 함(자가치유가 이후 업데이트마다 유지). 캐시 정리: 옛 speclinker 캐시 버전 44개 삭제(3.32.0만 유지).
> **v3.32.0** (SCH 명령 분리 + 테이블 레지스트리 + SRS 단일 재생성 + nkshop docs 정리): 설계검토 후속. ①**`/sl-recon-sch` 분리**(완전 수동): recon STEP5(SCH) 전체를 신규 `skills/sl-recon-sch/SKILL.md`로 이관(build_table_registry→build_sch_todo→scan_query_patterns/code_literals→build_sch_static→dispatch_sch_gen→link_inf_sch_new→gen_docsify). recon STEP5는 포인터로 교체, STEP6 다음단계=`/sl-recon-sch`. 순서: recon(INF)→**recon-sch(SCH)**→recon-uis→recon-doc. plugin.json 11→12, CLAUDE/README 동기화. ②**추출대상 테이블 레지스트리**: 신규 `scripts/build_table_registry.py`→`.speclinker/table_registry.json`(영속 SSoT). 발견출처 추적 INF(`tables:`)∪SQL(`_tmp/sch_draft`)∪UIS(→INF→tables)+used_by_inf/screens+sch_id/generated, carry-forward(소스 휘발 보존). gen_docsify가 매 빌드 시 갱신·소비. **자동 생성대상은 INF tables 유지**(사용자 결정) — SQL/UIS-only는 뷰어에 '미생성' 노출+[⚙생성] 온디맨드. 실데이터 검증 nkshop 664테이블(생성630/미생성34). ③**뷰어 커버리지 확장**: gen_docsify build_coverage가 SCH=레지스트리 기반(출처태그 INF/SQL/화면+사용화면), SRS 커버리지 신설(화면1:1, 미커버 화면=미생성). docsify-sl: SCH 미생성행 출처태그, SRS탭 배지+미생성행, **UIS 상세 연결패널 "참조 테이블(SCH N/M)"**(미생성 테이블 점선칩+[⚙생성]), 사이드바 ✦N. ④**SRS 단일 재생성**: srs-agent "단일 SRS-F 모드"(target UIS-ID→그 SRS-F 섹션만 SRS_{도메인}.md 교체+색인행 갱신, 나머지 보존), build_funcs_index `--screen/--out` 단일화면 필터, sl-viewer STEP5 srs 핸들러 화면단위로. ⑤**nkshop docs 정리**: 비정식 디렉토리 삭제(.obsidian·00_입력자료·01_요구사항정의서[빈]·05_설계서/_tmp[transient]) → 정식 9종+viewer만 유지(RTM/SAD/05 내용 보존). 신규 test_table_registry 3종, 전체 91 테스트 그린.
> **v3.31.0** (drift 완전제거 + 뷰어 auto-loop + 생성/미생성 커버리지 + 리사이즈 패널): 사용자 설계검토 후속 4건. ①**sl-drift 완전 삭제**(mtime 휴리스틱=사용자가 거부한 그 방식이 스킬로 잔존): `skills/sl-drift/` 삭제, plugin.json/README(12→11)/CLAUDE/scripts-README/docsify-sl 명령팔레트에서 제거, 무효 CSS클래스 `sl-drift-src`→`sl-sr-src`. (변경감지는 추후 git-diff 기반 별도.) ②**REFACTOR_PLAN.md 모순정리**: 상단 §12(전부완료)와 정면충돌하던 하단 Phase1~5 중복 미완체크리스트(44줄) 제거 + 메타에 "§12가 진행상태 SSoT" 명시 + Phase6.4 (예정)→(완료). ③**뷰어 auto-loop(토큰-효율 long-poll)**: `sl_board_cdp.js`에 `watch`/`alive` 서브커맨드. watch는 Node 내부서 4초(–interval)마다 큐 확인하다 **실제 버튼클릭·CDP죽음·탭닫힘·idle(~25분)일 때만** 1회 이벤트출력 후 종료 → 유휴 시 LLM토큰 0. `cdp-closed`/`no-viewer` 반환 시 세션이 재실행 안 함 = **CDP 생명주기=루프 생명주기**(Chrome 닫으면 폴링 자동정리). sl-viewer STEP3-4를 watch 기반으로 교체. ④**생성/미생성 커버리지**: gen_docsify에 `build_manifest`(도메인별 expected 스냅샷을 `.speclinker/spec_manifest.json`에 영속, _tmp 휘발 시 carry-forward) + `build_coverage`(expected vs 생성.md → `domains[d].coverage{inf,sch,uis:{expected,generated,missing[]}}`). expected출처: INF=`_tmp/router_inventory_with_chain.json`(apiRoutes로 INF-ID 결정론 재구성), UIS=`.speclinker/screen_plan.confirmed.json`→static, SCH=생성INF의 tables 합집합(라이브). 뷰어: 도메인탭 `생성/전체`배지(미생성 빨강)·미생성 회색점선행+[⚙ 생성](genSpec→regen-spec큐 missing:true, 백업·삭제 생략)·사이드바 ✦N 배지. ⑤**우측 연결관계 패널 드래그 리사이즈+반응형**: 좌측 가장자리 핸들 pointer드래그 → `--sl-relpanel-w` CSS변수(min200/max min(60vw,560))·localStorage 기억·뷰포트축소 시 재클램프, `.content` right 연동. 가이드 GUIDE_VERSION 3.1.0→3.31.0 + "이 뷰어 기능" 섹션 신설. 테스트 88 그린(신규 test_coverage 3종).
> **v3.30.2** (뷰어 3종 픽스 — 플러그인 원본 반영): nkshop 라이브서 발견(그 세션은 프로젝트 복사본만 고쳐 gen_docsify 재실행 시 소실 → 플러그인 원본 docs/viewer/docsify-sl.js에 영구반영). ①**FUNC_MAP/SRS 등 색인문서의 상대 `.md` 링크 404(빈화면)**: docsify가 `../03_기능명세서/...md`를 상대해석하며 docs/ 접두 잃던 버그 → beforeEach에서 현재 문서디렉토리(vm.route.file) 기준으로 **절대 라우트 `#/docs/...`로 사전변환**(`](상대.md#)` 정규화, http/절대/#/mailto 제외). ②**도메인 클릭 시 스크롤 최하단 잔존** → renderDomainView 끝에 `window.scrollTo(0,0)`. ③**사이드바 도메인 카운트에 SRS 수 추가**(✎ --c-srs, ⬡INF ▭UIS ⛁SCH 옆). 자산은 gen_docsify가 매 /sl-viewer 실행 시 플러그인→프로젝트 docs/viewer/ 복사(index.html/docsify-sl.js/sl-theme.css) — 영구반영은 원본 수정 필수.
> **v3.30.1** (문서뷰 좌측정렬 버그픽스): 사용자 "화면 나오는거 가운데 몰려 보기 안좋다". 원인: docsify 기본 `.content{position:absolute;left:300px}`에 sl-theme의 `margin-left:220px`가 **합산돼 본문 left=520px**로 밀려 가운데처럼 보임(커스텀뷰 #sl-main은 정상, 문서뷰만). 수정: `.content`를 `left:220px !important; right:0; margin:0`로 docsify의 left 직접 덮어씀 + has-relpanel/has-qnav를 `margin-right`→`right`로(absolute 정합), 모바일도 `left:0`. 검증: computed content left 520→220, width 956(풀폭). 헤드리스 캡처 확인.
> **v3.30.0** (개별 스펙 재생성 버튼 + mtime 변경점검 제거): 사용자 지적 "mtime 변경감지는 쓸데없다(clone/touch에 속음) — 걷어내고, 화면에서 개별 스펙 재생성 버튼을 달라". **제거**: v3.26 mtime 변경점검 일체(`detect_drift.py`+test+drift.sample.json, docsify-sl renderDrift/showDrift/driftScan/driftBadge/getDrift/tryDriftFallback·🔄변경점검 nav·__slDrift, sl_board_cdp `drift` 서브커맨드, sl-viewer STEP5 drift, drift CSS). (변경 *감지*는 추후 git diff 기반 재설계 — mtime은 부정확.) **추가**: SpecLens INF/SCH/UIS/SRS 상세의 **연결관계 패널에 [🔄 재생성] 버튼** → `regenSpec(id,kind)` → 큐 `{regen-spec,target,kind}` → /sl-viewer 세션이 **그 스펙 1개만 재생성**(speclinker 명령). 메커니즘=기존 멱등성: 대상 백업·삭제→해당 단계 재실행(INF=dispatch_inf_gen group_already_done / SCH=build_sch_todo→static→enrich / UIS=sl-recon-uis 재캡처 / SRS=recon-doc 9-3)→gen_docsify→status 주입. INF/SCH는 파일 1개 깔끔, UIS는 CDP 재캡처, SRS는 색인단위. `slEnqueue`는 보존(제네릭 큐). README/scripts-README/sl-viewer SKILL 동기화, scripts 39→38. 13+4 테스트 그린.
> **v3.29.0** (sl-init MCP 등록 스코프 선택 — 전역=항목만 추가, creds 수동): 사용자 결정 "설치 시점 전역 자동은 비추(creds·컨텍스트·오염), init에서 선택". **sl-init Step 4-1B 신설**: DB≥1일 때 "①프로젝트(.mcp.json) ②전역(모든 프로젝트) ③건너뜀" 질문. **전역 선택 시 접속정보 안 물음** — `install.py --global-template --db oracle,mariadb`(신규, 비대화형)가 `~/.claude.json`(사용자 스코프)에 `claude mcp add --scope user`로 서버 항목을 **`CHANGE_ME` placeholder creds**로 추가하고 **설정파일 경로+채울 키를 출력** → 사용자가 직접 아이디/비번 입력. 이미 등록(claude mcp get)이면 스킵. 전역 선택 DB는 4-3 .mcp.json서 제외(중복방지), Jira/Wiki·프로젝트DB만 .mcp.json. 내장서버 있는 oracle/db2/mariadb만 대상(postgres/mssql=npx 프로젝트스코프). 회귀 test_install_global(명령구성·스킵, run_silent monkeypatch로 실등록 없이 검증). install.py 모드: `--global`(대화형 즉시등록)·`--global-template`(비대화형 placeholder, init용)·`--yes`(libs만). 14테스트 그린.
> **v3.28.0** (전역 DB MCP 등록 + README 전면 재작성): ①**`install.py --global`**(방식 B): 라이브러리 설치 + DB 접속정보 1회 입력(getpass) → `claude mcp add --scope user db-{oracle/db2/mariadb}`로 **사용자 스코프(모든 프로젝트) 등록**. 서버 env 정확매칭(ORA_*/DB2_*/MDB_*), 명령은 `sys.executable {server}.py`(libs 설치된 동일 python). 회사 DB 고정 시 "한 번 등록→전역". creds는 보안상 수동(자동화 불가). 단순 libs만은 `--yes`. ②**README 전면 재작성**(stale 대거 정정): 삭제된 build_si_graph/link_inf_sch 참조·존재안하는 `.mcp.json.example` copy·`python3` 체크·SI/ITO 옛 태그라인·잘못된 설치경로·skills 13(실제12)/agents 14(실제15) 제거. 신규 반영: SessionStart 자동 의존성설치, install.py --global(전역MCP), SpecLens SR보드/변경점검, Windows python3 스텁 주의, SL_DISPATCH_PARALLEL/MODEL. README 참조 파일 전수 실존 검증, python3 실행참조 0, 13+4 테스트 그린.
> **v3.27.3** (콜드 인스톨 하드닝 — 백지 환경 동작 보장): 완전 백지 설치 전면검토. **콜드 브레이커 2건 수정**: ①**`python3`→`python` 표준화**(스킬+에이전트 18파일 ~59건) — Windows 공식설치는 `python.exe`만이고 `python3`는 Store stub(가짜)이라 깨짐. setup-deps/install.py의 탐지후보 python3는 .py/.js라 유지. ②**`templates/mcp/*.json` 개발경로**(`D:/gen-harness/...`)→`{PLUGIN_PATH}` placeholder(소비처 0이나 복붙 안전). **검증 OK(무수정)**: package.json에 playwright-core+tree-sitter 4종 등록(setup-deps `npm install` 동작), scan_source tree-sitter→regex graceful 폴백(빌드툴 없어도 OK), sl-init이 .mcp.json을 `{PLUGIN_PATH}` 치환 인라인 생성(정상), setup-deps python 탐지(python/python3/py)+MCP libs 조건부 자동설치, plugin.json 등록=실제파일 일치, /home/user 경로는 문서 예시(무해). **잔여(환경 전제, graceful)**: node+python3 사전설치 필요(Claude Code 전제), 첫 SessionStart npm/pip 인터넷(실패시 regex폴백), tree-sitter 네이티브빌드 툴(없으면 폴백), DB MCP creds·Chrome(선택기능)은 수동. 하드코딩 개발경로 0 확인.
> **v3.27.2** (UIS 산출물 가독성 — 특수문자 정리): 사용자 "UIS 마커·스펙 산출물에 이상한 기호(특수문자)". 주범 `§`(섹션기호 59)·`№`(numero 9)·`①`(2) 제거 → **`## 0. 화면 미리보기` … `## 8.` 깔끔한 번호 섹션 + `| 번호 | 위젯 |` 표**. 정본 일괄정리(ddd-ui-agent·UI_Spec_v1.0_template·SPEC_CONVENTIONS·annotate_preview·build_markers·build_domain_overview·link_uis_inf): `§`→제거+헤더 점부여, `№`→번호, `①`→(1). 교차참조 어색구문 6건 다듬음(「N. 제목」). 마커 이미지(annotate_preview)는 원래 숫자원이라 무변경. **→ 화살표는 동작흐름(동작→API→결과) 의미라 유지**. §가 파서 로직 의존 0 확인(텍스트/주석뿐) — 기능무영향. 샘플 SAMPLE_UIS도 정리. 정본 § 0건 검증.
> **v3.27.1** (전체 건강검진 + dead code 정리 — 신뢰성): 변경 누적으로 무결성 점검. **전체 그린 기준선**: py 테스트 13파일·node 1 전부 PASS, py_compile 0실패, JS `node --check` 전부, JSON 유효, plugin.json 에이전트/스킬 등록=실제파일 완전일치. **dead code 제거**(무호출 검증 후): `screenshot.js`(0바이트 빈파일)·`build_si_graph.py`(v3.12 폐기·소비처0)·`eval_fidelity.py`(eval_anchor_coverage로 대체·임포트0)+`test_eval_fidelity.py`·`gen_obsidian_index.py`(SpecLens로 대체·무호출). scripts 43→39. **stale 참조 정리**: README 죽은행 3개·func_context_bundle 주석(gen_obsidian→spec_graph_build 정정)·sl-viewer 노트. **오탐 확인(유지)**: `build_markers.py`(ddd-ui-agent가 .py 없이 참조 — 사용중), `screen_inventory_static.json`(sl-recon 생산→sl-recon-uis 정적폴백/collect_screen_slice/spec_graph_build 소비 — 살아있음). 기능 변경 0(순수 정리·검증).
> **v3.27.0** (SR 티켓별 자료 도시에 — DRM/부실 SR 보강 루프): SR 본문이 부실하거나 첨부가 DRM/HWP라 자동분석 불가한 현실 대응. 티켓별 폴더 `docs/변경관리/{SR}/`(sl-change 기존 구조 재사용)에 **사용자 보강 영역 `inputs/`** 추가 — 보드에서 캡처·메모를 직접 넣어 AIDD에 반영. 신규 `scripts/scan_sr_material.py`(zero-LLM): 도시에 점검(본문길이·첨부 파싱가능성·_extracted 추출불가 마커·inputs 유무)→ state(ok/thin/drm). 보드: SR카드 **⚠보강 배지 + [📁자료] 버튼**, 상세 드로어 **티켓 자료 섹션**(경로·첨부 ✕파싱불가·inputs 목록·[폴더 열기]/[새로고침]). 큐 액션 `open-dossier`(inputs/ 생성+탐색기 열기)·`refresh-material`(scan 재실행). sl-change Step 1-D-2: **inputs/·_notes.md 병합**(부실/DRM이어도 사용자 자료로 분석 계속). sr_board.json srs[].material. 회귀 test_sr_material(thin/drm/ok/inputs). 헤드리스 캡처로 UI 검증(board/drawer). v3.25 보드·v3.26 변경점검과 동일 CDP 큐 구조.
> **v3.26.0** (SpecLens 변경 점검 — 버튼 트리거 스펙 최신화): 소스가 바뀌었는데 스펙이 안 따라온 INF/SCH/UIS를 **뷰어 버튼으로 감지·재생성**. 사용자 요청대로 "버튼 눌러서 하는 변경감지" 먼저. 신규 `scripts/detect_drift.py`(zero-LLM): 각 스펙 frontmatter `anchors:` 소스 mtime > 스펙 .md mtime → STALE, 소스 삭제 → MISSING(freshness 게이트 동일 원칙, gen_docsify 파서 재사용)→`docs/viewer/drift.json`. 뷰어: 사이드바 **🔄 변경 점검**(빨강 카운트 배지) + `renderDrift`(도메인 그룹·타입배지·사유·소스칩·[재생성]/[도메인 재생성] 버튼, `.sl-driftview` 래퍼로 board 타이머와 격리) + `window.__slDrift` 훅 + 정적 폴백(drift.json fetch, 샘플 docs/report/samples/drift.sample.json). CDP `sl_board_cdp.js drift <file>`(window.__slDrift 주입+onDrift). 버튼→큐 액션: `drift-scan`(detect_drift 실행+주입)·`regen-spec`(target=ID)·`regen-domain`. sl-viewer SKILL STEP5 변경점검. 회귀 test_detect_drift(2: stale/fresh/missing, no-anchors). **후속 슬라이스**: 디스패처 `--only <id>` 강제 재생성 실행부(현재 regen 액션은 큐 적재+도메인 재recon, 단일파일 강제는 미구현) / gen_docsify 자동 stale 배지(passive).
> **v3.25.0** (SpecLens SR 작업보드 — 엔터프라이즈 업무 콘솔): SpecLens를 "스펙 뷰어"에서 **담당 지라 SR 기반 업무 콘솔**로 확장. 사용자가 뷰어에서 본인 SR 목록(칸반)을 보고, 각 SR의 영향범위(INF/SCH/UIS/FUNC 칩, 클릭→스펙점프)를 확인하고, 버튼으로 영향분석·AIDD(`/sl-change`)·승인을 트리거. **새 명령어 0개** — `/sl-viewer` 세션이 MCP(지라)+CDP(SpecLens)를 둘 다 쥐므로 그 세션이 직접 처리(별도 서버 없음). **통신=CDP(9222)**, 기존 캡처가 쓰는 검증 채널 재활용: `scripts/sl_board_cdp.js`(playwright `connectOverCDP`) `inject`(window.__slBoard 주입+renderBoard)/`status`(__slStatus 병합)/`poll`(__slQueue 버튼클릭 수집). 신규 뷰어 모듈: docsify-sl.js `renderBoard`(칸반 5열·SR카드·영향칩·진행배지·상세 드로어·필터/검색·토스트)+`window.__slBoard/__slStatus/__slQueue` 훅+사이드바 📋 SR 작업보드, sl-theme.css 보드 스타일. **정적 폴백**: 세션 없으면 `docs/viewer/sr_board.json` fetch(읽기 전용 — 샘플 `docs/report/samples/sr_board.sample.json`). sl-viewer SKILL: STEP2 서버 백그라운드 + STEP3(지라 MCP풀→build_change_context 영향산정→inject→큐폴링 처리, `/loop` 선택). **안전**: CDP 다리는 페이지 read/write만, 실제 변경은 세션이 sl-change 사람승인 게이트 거쳐 수행(큐=의도만, 브라우저發 임의실행 없음). 설계 docs/superpowers/specs/2026-06-07-speclens-sr-workboard-design.md. 검증: node --check(docsify-sl·sl_board_cdp), CSS 균형 — 라이브 CDP 왕복은 사용자 세션 검증.
> **v3.24.1** (v3.24 모델 override 핫픽스): 스킬이 Agent 호출 시 `model:` 명시 전달 시 frontmatter를 덮어쓴다는 함정 발견. **sl-recon-doc 9-2가 rd-agent를 `model:"sonnet"`로 강제** → v3.24의 rd→haiku가 무효였음 → `model:"haiku"`로 수정(실제 절감 적용). spec-agent는 frontmatter=opus이나 sl-recon이 `"sonnet"` 강제 → 실효 Sonnet으로 CLAUDE 모델표 정정. (test/ddd-batch=override 없음 frontmatter 적용 ✓, ddd-db=dispatch_sch_gen haiku ✓, rtm=9-4 model 미지정 opus 유지 ✓). 교훈: 에이전트 모델 변경 시 **frontmatter + 스킬의 명시 `model:` 둘 다** 확인.
> **v3.24.0** (토큰 비용 절감 — 모델 적정화 sonnet/opus→haiku): 사용자 "토큰소모 너무많아" 검토. **발견된 불일치**: rd-agent·srs-agent가 frontmatter상 `opus-4-7`로 실행 중(CLAUDE.md 표는 Sonnet 표기 — 과소비). 태스크 성격별 재배정: ①**Haiku로**(기계적/추출형) — `rd-agent`(FUNC 인덱스 포맷팅, opus→haiku), `ddd-db-agent`(SCH enrichment=LLM-TODO 마커 채움, sonnet→haiku), `ddd-batch-agent`(sonnet→haiku), `test-agent`(TC 생성, sonnet→haiku), **dispatch_sch_gen 기본 모델 sonnet→haiku**(SCH 대량 디스패치=최대 토큰 절감 지점) ②**Sonnet 유지**(합성/판단/코드품질) — srs(opus→sonnet 다운), ddd-api(INF 비즈룰), ddd-ui(SOP), dev, qa ③**Opus 유지** — sad, rtm, spec(오케스트레이터, 저빈도). **토큰 절약 모드**: 대량 INF까지 더 줄이려면 `SL_DISPATCH_MODEL=claude-haiku-4-5-20251001`(dispatch_inf_gen/sch_gen 공통 env). haiku는 sonnet과 쿼터 분리라 주간한도 회피에도 유리. 품질 민감(INF 비즈룰·코드생성·QA게이트)은 Sonnet 유지로 정확도 보존.
> **v3.23.0** (개선안 잔여 종결 — L-2 cp949 + L-4 MCP 동시접속): nkshop 개선안 마지막 2건. **L-2(Windows cp949)**: skill 인라인 파이썬 `-c` 스니펫이 `sys.stdout.reconfigure` 누락 시 em-dash(—)·한글에서 UnicodeEncodeError → 47개 `-c` 스니펫 전수에 `import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');` 상단 표준화(이미 있는 건 스킵, 패치 스크립트로 41개 주입). **L-4(Oracle MCP 동시접속 DPY-4011)**: 메인+서브프로세스 병렬 접속 시 간헐 연결종료 → 3개 MCP 서버(oracle/db2/mariadb) `_query`에 **transient 오류(DPY-4011/ORA-03113/2006/SQL30081 등) 감지 시 엔진 dispose+재접속 재시도(2회, 백오프)** 내장 + dispatch_sch_gen `MAX_PARALLEL`을 `SL_DISPATCH_PARALLEL` env로 노출(Oracle 잦으면 2로 낮춤). SETUP_GUIDE 트러블슈팅 추가. **→ nkshop 개선안(_tmp/speclinker_plugin_improvements.md) 전 항목 종결**(C-4/H-1/H-3/M-1/M-3/M-5/L-2/L-4 등 완료, M-1[타입공백]은 v3.18 MCP·M-1[chain]은 v3.22로 해소).
> **v3.22.0** (M-1: resolve_call_chain — service/impl + MyBatis 네임스페이스 해소, sch_draft 품질): nkshop 실측 결함 "service는 찾되 dao/query=0 → sch_draft 0테이블 → SCH가 전적으로 MCP 의존". 근본원인 2개: ①**Spring service/impl 분리** — 컨트롤러가 service *인터페이스*를 import하면 인터페이스엔 DAO import가 없고 *Impl*에만 있어 체인이 인터페이스에서 멈춤 ②**jwork류 문자열 네임스페이스 SQL** — typed Mapper 인터페이스 없이 `sqlSession.selectList("ns.id")` 문자열로 호출해 import 추적으론 XML 도달 불가. 수정: ①`impl_files()`로 service의 `*Impl`/`*ServiceImpl`를 class_index에서 찾아 traverse에 추가(인터페이스 import 0이어도 Impl이 import한 DAO/Mapper 도달) ②`_namespace_index()`(모든 *.xml `<mapper namespace>` 인덱스, 워크스페이스당 1회 메모) + `find_query_files_by_namespace()`(소스의 MyBatis 호출 문자열→namespace 최장prefix 매칭→XML)를 컨트롤러·서비스·Impl·DAO에 적용. 둘 다 스택중립(비Java/비MyBatis는 no-op). 회귀 `test_resolve_chain_m1.py`(impl_files·namespace·통합체인 3). 효과: service/impl·MyBatis 프로젝트에서 dao/query>0 → sch_draft 테이블·evidence·INF매핑 채워짐 → SCH(타입 외 구조)·v3.20 anchors·v3.19 조인 품질 향상. **개선안 잔여**: L-2(인라인 cp949 5스킬)·L-4(MCP 동시접속)만 남음.
> **v3.21.0** (설치 자동화 + sl-init 구조 정리 — SM 정합): ①**MCP 라이브러리 자동설치**: 기존엔 setup-deps.js(SessionStart)가 playwright/Pillow/tree-sitter만 깔고 DB MCP libs(mcp·sqlalchemy·pandas·oracledb/pymysql/ibm_db)는 수동(mcp-servers/install.py)이라 "설치했는데 MCP 안 됨"이 발생. 수정: setup-deps.js가 `project.env`의 `MCP_DB_oracle/db2/mariadb=true`(=/sl-init 기록)를 보고 **선언된 DB 드라이버+코어를 자동 설치**(미사용 프로젝트엔 안 깔아 pandas/ibm_db 빌드부담 회피, 전부 graceful). install.py에 `--yes` 비대화형 모드 추가. 등록(.mcp.json)+creds는 보안상 수동 유지. ②**sl-init 디렉토리 정리**: **`docs/00_입력자료` 제거**(소비처 0 — 유일 참조가 삭제된 /sl-genesis 안내였음), **`06_소스코드/{src,tests,reviews}` 제거**(greenfield 잔재 — SM은 실소스를 직접 수정). dev-agent가 생성코드를 06_소스코드 대신 **`SOURCE_*_PATH` 실소스 트리에 기존 패키지/레이어 관례대로** 배치(linked_func 주석). req_scan/run_tests/sl-test/docsify-sl/SPEC_CONVENTIONS의 06_소스코드 참조를 실소스로 전환. 죽은 `/sl-genesis` 안내(sl-init 2곳·sl-change 1곳) 제거. **`docs/02_추적표`는 유지**(sl-change DELTA가 RTM 도메인색인·SR추적에 실사용 — 쓰임새 확인됨). SETUP_GUIDE 자동설치 안내 갱신.
> **v3.20.0** (JIT 배선 완결 + SCH 근거 anchors 구조화): v3.19 잔여 2건 처리. **①query_patterns JIT 배선**: `func_context_bundle`이 FUNC가 만지는 테이블에 한정해 `_machine/query_patterns.json`의 조인·상시필터를 추려 번들(`query_patterns`/`tables` 필드)에 싣고, `build_story`가 STORY에 **🔧 쿼리 작성 가이드(JIT)** 표(조인 경로·상시필터)를 주입 → dev-agent가 마크다운 재파싱 없이 구조화 소비. **동시 버그수정**: `find_sch_content`가 `DB_*.md`만 보고 **개별 `SCH-*.md`를 안 읽던 결함**(v2.56 개별파일 구조 이후 방치 — dev-agent가 SCH 컬럼/관계 상세를 못 받았음) → 개별 SCH 파일 1순위 로드. **②SCH anchors 구조화**: build_sch_static `collect_anchors`가 sch_draft evidence(쿼리)·DDL 소스·referencedByRouter(컨트롤러)를 frontmatter `anchors:` 배열로 emit(INF는 file:line 풀체인, SCH는 테이블 정의·사용 소스 파일 목록 — JIT 소스 정밀조회). gen_docsify scan_schs `anchor_count` 추가(⚓ 배지 INF 동형). 회귀 test_sch_static(anchors 단언)+test_story_query_patterns 2. **stale 데이터 진단(별건)**: 사용자가 지목한 nkshop INF-PRD-002의 "테이블명 있는데 SCH 빈칸"은 구버전 산출물(req-f·구포맷 `|테이블|SCH|`+[TBD]) + SCH가 scm 도메인으로 분류(SCH-SCM-xxx)돼 옛 `[[SCH-PRD-001]]`조차 stale. 코드는 v3.17에서 이미 수정(단일목록+뷰어 자동크로스링크)됨 → /sl-recon 재생성 시 해소(또는 link_inf_sch_new 경량 재실행).
> **v3.19.0** (SCH = "쿼리 작성 계약" — JOIN·상시필터 정확화, AIDD 쿼리 생성용): "소스만으론 정확한 쿼리를 못 만든다"는 문제 해결. LLM이 *정확한* 쿼리를 쓰려면 ①실테이블/타입(v3.18 ✅) ②**올바른 JOIN 키** ③코드값 ④**상시 필터 관례** ⑤인덱스가 필요한데, ②④는 카탈로그(describe)로는 불가 — **실제 쿼리에만 존재**(특히 레거시는 FK 미선언이라 `*_get_foreign_keys`가 빈손). 신규 `scan_query_patterns.py`(zero-token): 소스 SQL/XML에서 alias→table 해소 후 **관찰 등가조인쌍**(논리 FK)과 **상시필터**(soft-delete `_YN/_FL`·테넌트 `COMP/SITE_CD` — 바인드파라미터 `:BIND`도 포착)를 채굴→`docs/05_설계서/_machine/query_patterns.json`(영속 JIT 기계레이어). build_sch_static: 컬럼표에 **키(PK/FK)열** + `### 관계(FK/관찰된 조인)`에 **참조컬럼·출처(DB FK/쿼리관찰(N))** + **🔧 쿼리 작성 가이드(상시필터) 접이식**(뷰잉 가독성 보존). ddd-db-agent: **다중 DB MCP 일반화**(ora_/db2_/mdb_ — DB_TYPE별 prefix, 하드코딩 제거) + FK 참조컬럼·상시필터 의미 보강. 고아였던 scan_code_literals도 STEP 5-0.5로 배선. **2층 원칙(평가 결론)**: SCH.md=사람 레이어(접이식 노이즈 격리)/`_machine/*.json`=JIT 기계 레이어(마크다운 재파싱 없이 직접 소비) — 한 마크다운이 JIT 원천이 되면 안 됨. 회귀 test_sch_static 4(scan_query_patterns 추가). 잔여(권고): query_patterns를 spec_index/AIDD story 번들에 연결, SCH 근거 구조화 anchors.
> **v3.18.0** (SCH 타입 = DB MCP 권위화, JIT/AIDD 메타데이터): 플러그인 내장 Oracle MCP(`mcp-servers/oracle_schema_server.py`, `ora_describe_table`=data_type/NULL/PK/default)를 SCH 타입 채움에 실제 연결. 기존 결함: build_sch_static(스크립트, MCP 불가; sch_facts는 pymysql/psycopg2만)가 미상 타입을 `<!-- LLM-TODO -->`로 두는데 ddd-db-agent enrichment는 "타입 읽기전용"이라 **MCP가 있어도 타입을 안 채움**→추론값 잔존. 수정: ①ddd-db-agent enrichment가 미상 타입/NULL/PK/⚠️추론 DDL을 `ora_describe_table`로 사실 채움(이미 채워진 값은 불변, MCP 미연결 시만 추론 유지) ②build_sch_static이 타입미상 도메인을 enrich 대상에 포함(needs_type)→dispatch_sch_gen이 호출. SCH가 AIDD JIT 메타데이터(정확 컬럼·타입 기반 코드생성)로 기능하기 위함. 잔여(권고): SCH 근거소스를 INF처럼 구조화 anchors(mapper file:line)로 — JIT 소스 정밀 조회용.
> **v3.17.0** (INF 참조테이블 [TBD] 근절): ddd-api-agent `## 참조 테이블`을 `| 테이블 | SCH |`(SCH 컬럼=[TBD] placeholder)에서 **단일 테이블 목록(`- TABLE`)**으로 변경. SpecLens 뷰어가 본문 테이블명→SCH 자동 크로스링크 + INF↔SCH는 frontmatter tables↔SCH.table 정방향 인덱싱이라 [TBD]/링크 placeholder 불필요. nkshop 실측서 본문 [TBD] 4299줄의 주범이 이 참조테이블 SCH컬럼 [TBD](link_inf_sch 교체 미실행 잔존)였음. link_inf_sch_new는 새 목록포맷에 graceful no-op. 기존 산출물은 /sl-recon 재생성(+DB MCP) 시 새 포맷·권위 SCH타입으로 갱신.
> **v3.16.0** (SpecLens v4 전면 재디자인 — 사용자 UX): 사용자 피드백("보기 불편")으로 전면 정제. CDP 라이브 진단으로 구조결함 수정: ①클릭한 문서가 목록(#sl-main) 아래 화면밖 렌더→커스텀뷰/문서뷰 display 상호배타(body.sl-custom-view) ②FUNC_MAP/SRS 색인이 크로스링크 누락(doneEach 게이트 협소)→전 문서 적용 ③UIS 본문 이미지 src 2중 prepend로 깨짐→상대경로 docsify 위임 ④직접 doc URL 진입 시 loadIndex가 대시보드로 덮어쓰던 회귀 수정. **v4 디자인**: 정제 다크 토큰(deep bg·라운드 카드·차분한 골드 #e6c79c·타입색 ⬡INF#7aa2ff ⛁SCH#52c489 ▭UIS#e6c79c ◆SRS#c79bf0) / 대시보드=커버리지 링 카드 / 목록=필터 바+행 ⛁테이블·⚓앵커 배지 / 사이드바=도메인별 타입 카운트. 별건 데이터버그도 수정: **INF↔SCH 연결을 INF.tables↔SCH.table 정방향 매칭 추가(가짜 미연결 759→167)**. nkshop 실데이터로 RECON-doc 전체(rd/srs/rtm 에이전트 실행) + SpecLens CDP 스크린샷 검증. 설계 docs/superpowers/specs/2026-06-06-speclens-v4-redesign-design.md. 잔여(폴백 폴리시): ⌘K 팔레트·UIS 마커↔위젯 좌표연동.
> **v3.15.1** (nkshop 전수 e2e 검증 + 발견 결함 수정): 실데이터로 RECON-doc 전체 실행(스크립트 + rd/srs/rtm 에이전트) 후 SpecLens 19항목 헤드리스 전수테스트(19/19 PASS). 발견·수정: ①**frontmatter 접이식이 실파일 CRLF/BOM에 미동작**→raw YAML 노출(정규식 `^﻿?---\r?\n` 허용) ②**scan_funcs가 FUNC_MAP 갭/요약표까지 파싱**→funcs 중복(fid dedup, 색인표 우선) ③**FUNC-ID 규약 불일치**(srs=FUNC-product vs rd/rtm=FUNC-PRD domain-code)→SRS↔FUNC 죽은링크: rd/rtm 에이전트에 "FUNC-{도메인디렉토리명}, domain-code 금지" MUST 규칙 명시(srs와 일치). 검증: SRS 합성 품질 실증(복붙 아닌 구조적 종합 — "8탭 단일 엔드포인트 집약" 통찰), 연결패널·테이블링크·mermaid 그래프(34노드)·검색·갭 전부 정상. test_speclens_index scan_funcs dedup 회귀 추가.
> **v3.15.0** (SRS 합성형 재설계 + SpecLens 1급 노출): SRS를 "UIS 재포장"에서 **사용자(PM·고객·QA)용 업무 명세 뷰잉 문서**로 재설계. **토큰 원칙**: LLM은 ①기능요약 ②업무흐름(화면 가로지름) ③비즈규칙 종합(INF규칙+SCH코드값+UIS§5, 출처표기) ④예외 에만; ⑤연관산출물 ⑥데이터영향은 funcs_index 기계 조립(복붙·추론 금지). srs-agent 합성형 6섹션 + SRS 템플릿 정본 재작성(REQ/SRS-NF 제거). gen_docsify `srs[]` 인덱싱(+domains.srs_count). SpecLens **SRS 1급 노출**: goToId/크로스링크(SRS-F-\d+)·연결그래프 노드(보라)·도메인 '기능명세' 탭·연결패널(UIS↔SRS 양방향). 테스트 test_speclens_index(scan_srs 2) + playwright 스모크. 계획 docs/superpowers/plans/2026-06-06-srs-synthesis-redesign.md. **Task5(합성 품질 실증)는 실제 srs-agent 실행 필요→다음 RECON 세션에서 검증**(복붙 아닌 종합인지). UIS=화면 분해 / SRS=기능(업무) 관점.
> **v3.14.0** (RECON 실전 개선안 잔여분 — scan 정확도/디스패치 견고성): nkshop 실전 결함목록(`_tmp/speclinker_plugin_improvements.md`) triage 후 열린 항목 처리(CRITICAL 6/7·H-2·M-4는 이미 닫힘). **C-4**(CRITICAL): scan_source가 `MAPPING_JACKSON_JSON_VIEW` 반환 ajax 핸들러를 form 오분류→**INF 조용히 누락**하던 결함 — API_BODY_SIGNALS에 JSON-view 시그널 추가(nkshop 누락 5핸들러 api 복구). **H-3**: `@RequestMapping(method=POST)` 미파싱(전부 ANY)→method 속성 파싱(POST 4970/ANY 2809). **H-1**: 모델 주간한도 시 haiku 자동 폴백(`SL_DISPATCH_MODEL`/`SL_DISPATCH_FALLBACK`) + **M-5** 성공 시 failed[] 정리. **M-3**: BAT 오탐 축소(약한 키워드 제거·디렉토리 한정·Mapper/Model 제외·@Scheduled 우선, nkshop 배치 42→8 전부 실제). 회귀 `test_scan_source.js`(node 4). 계획 docs/superpowers/plans/2026-06-06-recon-open-improvements.md. **잔여(보류)**: L-2(인라인 cp949 reconfigure, 5스킬), M-1(resolve_call_chain dao/query), L-4(MCP 동시접속).
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
| 소스 경로(SOURCE_*_PATH) 없음 | `/sl-init`로 소스 위치 재설정 안내 |
| MCP 연결 실패 | 로컬 파일 fallback 안내 |
| UA 미설치 | `npm install -g understand-anything` 안내 |

## 상황별 파이프라인

| 상황 | 파이프라인 |
|------|-----------|
| 기존 코드 (RECON + AIDD) | sl-init → sl-recon → **sl-aidd** → sl-test |
| 기존 코드 (RECON 분석만) | sl-init(스캔) → sl-recon(INF) → **sl-recon-sch(SCH)** → sl-recon-uis(화면) → sl-recon-doc(FUNC/SRS) → 납품 |
| 변경·유지보수 (Jira) | sl-change &lt;SR&gt; → **sl-aidd** |
| 변경·유지보수 (로컬) | sl-change --new SR-001 → (요구사항 작성) → sl-change SR-001 → **sl-aidd** |
| **SDD 전체 파이프라인** | sl-recon → **sl-ia** → **sl-context** → sl-status → sl-change → **sl-aidd** (story 승인→구현→QA→테스트) |
| SDD 소규모 변경 | **sl-change --quick** "설명" (SR 없이 경량 경로) |

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
