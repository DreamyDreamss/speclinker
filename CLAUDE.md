# Speclinker — 플러그인 두뇌 (CLAUDE.md)

## 개요

이 파일은 SI/ITO 개발 전주기 자동화 플러그인 Speclinker의 라우팅 규칙을 정의합니다.
사용자 입력을 분석하여 적절한 스킬(Skill)로 라우팅하고, 서브에이전트를 조율합니다.

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

## 커맨드 라우팅 규칙

| 사용자 입력 | 라우팅 스킬 | 전제 조건 | 모드 |
|-----------|-----------|---------|------|
| `/sl-init` | `skills/sl-init/SKILL.md` | 없음 | GENESIS, RECON |
| `/sl-genesis [파일]` | `skills/sl-genesis/SKILL.md` | project.env, docs/00_입력자료/ | GENESIS |
| `/sl-recon` | `skills/sl-recon/SKILL.md` | project.env, 소스코드 존재 | RECON |
| `/sl-recon-uis` | `skills/sl-recon-uis/SKILL.md` | _tmp/recon_checkpoint.json | RECON |
| `/sl-recon-doc` | `skills/sl-recon-doc/SKILL.md` | docs/05_설계서/ INF 존재, _tmp/recon_checkpoint.json | RECON |
| `/sl-aidd [FUNC-ID]` | `skills/sl-aidd/SKILL.md` | docs/00_FUNC/FUNC_MAP.md 존재 | GENESIS, RECON |
| `/sl-analyze` | `skills/sl-analyze/SKILL.md` | project.env, docs/05_설계서/ | DELTA |
| `/sl-change <SR-ID>` | `skills/sl-change/SKILL.md` | project.env, docs/05_설계서/ (로컬 파일 또는 NETWORK=open) | DELTA |
| `/sl-rtm` | `skills/sl-rtm/SKILL.md` | docs/02_추적표/ 또는 docs/00_FUNC/ | 전체 |
| `/sl-dev` | `skills/sl-dev/SKILL.md` | docs/05_설계서/ 존재 | 전체 |
| `/sl-test` | `skills/sl-test/SKILL.md` | 06_소스코드/ 존재 | 전체 |
| `/sl-context` | `skills/sl-context/SKILL.md` | docs/05_설계서/ INF 존재 | RECON 후 |
| `/sl-plan [파일\|텍스트]` | `skills/sl-plan/SKILL.md` | project.env, docs/05_설계서/ | SDD |
| `/sl-check <SR-ID\|FUNC-ID\|--all>` | `skills/sl-check/SKILL.md` | docs/05_설계서/ INF, .speclinker/ | SDD |
| `/sl-review <SR-ID\|FUNC-ID>` | `skills/sl-review/SKILL.md` | TO-BE INF, 소스코드, project-context.md | SDD |
| `/sl-sprint [--status\|--next]` | `skills/sl-sprint/SKILL.md` | docs/00_FUNC/FUNC_MAP.md | SDD |
| `/sl-drift [도메인] [--since Nd]` | `skills/sl-drift/SKILL.md` | git 저장소, docs/05_설계서/ INF | SDD 유지 |
| `/sl-ia [도메인\|--update-only]` | `skills/sl-ia/SKILL.md` | docs/05_설계서/UIS/ spec.md 존재 | RECON 후 |
| `/sl-quick "설명"` | `skills/sl-quick/SKILL.md` | docs/05_설계서/ INF, project-context.md | SDD 경량 |

## 전제 조건 체크

모든 커맨드 실행 전 다음을 확인한다:

```bash
!cat project.env 2>/dev/null || echo "project.env 없음 — /sl-init 먼저 실행 필요"
```

## 서브에이전트 조율

### 산출물 생성 파이프라인 (spec-agent 오케스트레이터 → 전문 서브에이전트)

| 에이전트 | 역할 | 모델 (GENESIS) | 모델 (RECON) | 기법 |
|--------|------|--------------|-------------|------|
| `agents/spec-agent.md` | 파이프라인 오케스트레이터 | Opus | **Sonnet** (Phase-A만) | 순차/병렬 조율 |
| `agents/rd-agent.md` | REQ-ID 추출 + RD/FUNC 생성 | Opus | **Sonnet** | ReAct + Tree-of-Thoughts (GENESIS) / 인덱스 포맷팅 (RECON) |
| `agents/srs-agent.md` | SRS 상세화 | Opus | **Sonnet** | Chain-of-Thought + Reflexion (GENESIS) / 사실 집계 (RECON) |
| `agents/sad-agent.md` | 아키텍처 설계서 | Opus | Opus | 패턴 매칭 + Self-Critique |
| `agents/ddd-api-agent.md` | API 명세 (INF-XXX) | Sonnet | Sonnet | DSPy-style 구조화 출력 |
| `agents/ddd-db-agent.md` | DB 스키마 (SCH-XXX) | Sonnet | Sonnet | 3NF 검증 + ERD 생성 |
| `agents/ddd-ui-agent.md` | 화면 설계 (UIS-F-XXX) | Sonnet | Sonnet | 소스 증거 원칙 (preview는 capture.js가 처리) |
| `agents/ddd-batch-agent.md` | 배치 명세 (BAT-XXX) | Sonnet | Sonnet | 배치 확정 판별 + MCP DB 스케줄 조회 |
| `agents/rtm-agent.md` | RTM 체인 + 품질 게이트 | Opus | Opus | Constitutional AI (양쪽 모두 추론 필요) |

> RECON 모드 model 다운그레이드는 sl-recon SKILL.md에서 Agent 도구 호출 시 `model: "sonnet"` 파라미터로 처리.  
> agent 파일 frontmatter는 GENESIS 기본값을 유지한다.

### 코드·테스트 에이전트

| 태스크 | 서브에이전트 | 모델 | 이유 |
|--------|-----------|------|------|
| 코드 생성 | `agents/dev-agent.md` | Sonnet | 반복 실행 태스크 |
| 테스트 | `agents/test-agent.md` | Sonnet | 반복 실행 태스크 |

> v2.56: SCH 명세 테이블당 개별파일 구조 + 뷰어 경로/링크 라우팅 수정. SCH가 INF와 대칭(`{도메인}/SCH/SCH-{CODE}-NNN.md` 개별파일 + 슬림 `DB_{도메인}.md`(도메인 ERD+목록) + `DB_Schema.md` 파일직링크 색인). 앵커(#SCH) 전면 폐기 → INF↔SCH 정확 네비게이션. gen_docsify scan_schs(spec_index.schs[]) + docsify-sl.js goToId SCH해소·SCH탭 + link_inf_sch/merge_index SCH/스캔. 뷰어는 프로젝트 루트 서빙 + 동적 basePath + 자산 자동복사(gen_docsify). 3NF 검증결과/통과여부 산출물에서 제외.
> v2.55: INF 생성 병렬화 개선 — dispatch_inf_gen.py domain_lock 제거(INF-ID 사전배정 신뢰 → 단일 도메인도 병렬 3) + 타임아웃 600→1800초 + stagger 누적버그 수정(간격 방식). ddd-api-agent infIdStart 절대준수(폴더스캔 채번 금지).
> v2.54: 뷰어 사용자 가이드 추가 — docsify-sl.js renderGuide(사이드바 📖 가이드 → 빠른시작 파이프라인·전체 명령어·동작방식·FUNC-ID 체이닝). spec_index 없어도 접근 가능.
> v2.53: 도메인 선택형 RECON + UIS goto 캡처 + **범용성 강화**. scan_source.js에 Next.js/Nuxt 파일경로 라우팅 인식(inferFileBasedRoutes) 추가 — tree-sitter AST 미감지 라우트 보강. build_domain_catalog.py(relPath 디렉토리 기반 범용 도메인 분류, Java+Next.js 검증) + build_uis_goto_plan.py(form URL goto 플랜) 신규. sl-init Step5.5(스캔+카탈로그) / sl-recon STEP1.7(도메인 선택→POC_DOMAINS) / sl-recon-uis STEP6-0-GOTO(form URL 직접 캡처, BFS 폴백). 도메인 분류 기준=relPath(package 전용 금지).
> v2.52: Docsify 웹 뷰어 구현 — gen_docsify.py(스캔→spec_index.json) + docsify-sl.js(대시보드·INF/UIS 탭·Quick Nav·크로스링크·IA 트리) + /sl-ia(IA_MAP.md 자동생성+menu-path 보완). sl-viewer Obsidian→Docsify 교체.
> **v2.39+**: sl-recon STEP 1은 `scan_source.js` (제로-LLM 정적 스캔). v2.41: 컨텍스트 경로 자동 감지(web.xml/Spring Boot/NestJS/FastAPI/.env 6종) + 클래스 레벨 `/*` 와일드카드 strip. v2.44: STEP 1에 tree-sitter 파싱 결과 예시(source_index.json 스키마·필드 설명) 추가. v2.45: resolve_call_chain.py가 source_index.json 재활용 — 파일 재read·os.walk 제거, fast path/fallback 자동 분기. v2.46: dead code 정리 — UA 대시보드·ua_req_bridge.js 참조 제거, link_inf_sch.py(0바이트) 삭제. v2.48: install.ps1 검증 목록 정정(sl-spec→sl-genesis, req_scan.sh→req_scan.py, plugin.json 제거), UA 관련 문서 일괄 정리, installed_plugins.json 자동 등록 추가. v2.49: dispatch_inf_gen.py 도메인별 순차 Lock(INF-ID 레이스 컨디션 방지) + LAUNCH_STAGGER=3(claude CLI 초기화 충돌 방지). v2.50: 5개 산출물 템플릿 SM+AIDD 최적화 — INF(비즈니스룰·트랜잭션순서·사이드이펙트), SCH(코드값·비즈니스주의사항), BAT(비즈니스룰·재처리방법), UIS(apis/related-screens frontmatter), FUNC_MAP(BAT컬럼). v2.51: SDD 파이프라인 전체 구현 — sl-context/plan/check/review/sprint/drift/quick 신규 + sl-analyze/change/dev 강화 + BMAD MIT 차용 템플릿 5종.

모델 분리 전략: 단일 Opus 대비 약 60~70% 비용 절감 (Sonnet 에이전트 10개 중 5개)

## FUNC-ID 체이닝 원칙 (범용 주축)

- **FUNC-ID가 개발 추적의 범용 주축** — GENESIS·RECON 모두 동일
- FUNC-ID 형식: `FUNC-{도메인}-{NNN}` (예: `FUNC-order-001`)
- REQ-ID는 GENESIS에서 계약·납품 문서용으로 생성되지만, 개발 추적은 FUNC 기준
- FUNC_MAP.md가 단일 진실의 원천(Single Source of Truth)
- REQ → FUNC 매핑: 1 REQ = 1~3 FUNC (GENESIS에서 spec-agent가 자동 분해)

### 추적 주석 형식

| 모드 | 주석 | 예시 |
|------|------|------|
| GENESIS | `linked_req: REQ-F-XXX` + `linked_func: FUNC-domain-NNN` | 둘 다 삽입 |
| RECON   | `linked_func: FUNC-domain-NNN` | FUNC만 |

## REQ-ID 원칙 (납품·계약용, GENESIS 한정)

- REQ-ID 형식: `REQ-F-XXX` (기능), `REQ-NF-XXX` (비기능), `REQ-C-XXX` (변경)
- RTM은 REQ → FUNC 매핑 테이블로서 납품 문서에 포함

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
| `biz` (기본) | docs/01_요구사항정의서 ~ docs/08_테스트결과보고서 | PM·고객사·QA 포함 표준 구조 |
| `split` | docs/specs/ + docs/artifacts/ | ITO 운영 최적, 전체 이해관계자 |

## 에러 처리

| 상황 | 대응 |
|------|------|
| project.env 없음 | `/sl-init` 실행 안내 |
| docs/05_설계서/ 없음 | `/sl-genesis` 실행 안내 |
| 06_소스코드/ 없음 | `/sl-dev` 실행 안내 |
| MCP 연결 실패 | 로컬 파일 fallback 안내 |
| UA 미설치 | `npm install -g understand-anything` 안내 |

## 상황별 파이프라인

| 상황 | 파이프라인 |
|------|-----------|
| 새 프로젝트 (AIDD) | sl-init → sl-genesis → **sl-aidd** → sl-test |
| 새 프로젝트 (수동) | sl-init → sl-genesis → sl-dev → sl-test |
| 기존 코드 (RECON + AIDD) | sl-init → sl-recon → **sl-aidd** → 납품 |
| 기존 코드 (RECON 분석만) | sl-init(스캔+카탈로그) → sl-recon(도메인 선택) → sl-recon-uis(goto 캡처) → 납품 |
| 변경·유지보수 (Jira) | sl-analyze → sl-change → **sl-aidd** |
| 변경·유지보수 (로컬) | sl-change --new SR-001 → (요구사항 작성) → sl-change SR-001 → **sl-aidd** |
| **SDD 전체 파이프라인** | sl-recon → **sl-ia** → **sl-context** → sl-sprint → sl-plan → sl-analyze → sl-change → sl-check → **sl-dev** → sl-review → sl-test |
| SDD 소규모 변경 | **sl-quick** "설명" (SR 없이 경량 경로) |
| SDD 드리프트 점검 | **sl-drift** (주기적 스펙-코드 정합성 감지) |

### AIDD 핵심 루프 (sl-aidd 내부)

```
FUNC 선택 → func_context_bundle.py (스펙 자동수집)
         → dev-agent (코드 생성, linked_func 주석)
         → test-agent (TC 생성 + 실행)
         → req_scan.py (커버리지 갱신)
         → FUNC_MAP 상태 업데이트
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
/sl-genesis docs/00_입력자료/interview.md   # 산출물 생성
/sl-dev           # 코드 생성
/sl-test          # TC 작성 및 테스트
```
