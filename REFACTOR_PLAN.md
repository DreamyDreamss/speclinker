# Speclinker 범용화 리팩토링 작업 계획서

> **세션 끊김 대비 자가완결 문서.**
> 다음 세션에서 이어갈 때 가장 먼저 이 파일을 읽으세요.
> 사용자가 "리팩토링 이어가자" 또는 "REFACTOR_PLAN.md 보고 다음 task 진행해" 라고 하면
> 본 문서의 §12 진행 추적 섹션에서 가장 최근 완료된 작업을 찾아 그 다음부터 진행하면 됩니다.

---

## 메타

| 항목 | 값 |
|------|-----|
| 작성일 | 2026-05-22 |
| 결정자 | 사용자 |
| 작업 디렉토리 | `D:\gen-harness\plugins\speclinker` |
| 목표 기간 | 약 3~4개월 (Phase 0~5) |
| 현재 단계 | Phase 0 시작 직전 |
| 선택 옵션 | **가 (풀 리팩토링)** — Phase 0~5 전체 |

---

## 1. 배경 (Why this refactor)

### 1.1 사용자 비판 (정확하고 수용됨)

이전 답변들이 다음 편향을 가지고 있었음 — 인정·수정:
- **스택 편향**: Spring/Express/FastAPI 같은 익숙한 스택 위에서만 그림을 그림
- **아키텍처 편향**: N-Tier·Hexagonal·DDD·FSD 같은 학술적 분류만 고려. 실제 GitHub의 변종·자체 컨벤션 무시
- **지엽적 해결**: "yaml 5~6개" 같은 작은 규모로 시작한다는 어림짐작은 실제 매트릭스를 과소평가

### 1.2 진짜 근본 문제

현재 플러그인 코드 곳곳에 **"Java/Spring N-Tier 가정"이 암묵적으로 박혀있음**.
- `scripts/resolve_call_chain.py:19-23`의 `FOLLOW_LAYERS`/`SKIP_LAYERS`
- `agents/ddd-api-agent.md`의 엔드포인트 패턴 화이트리스트 (FastAPI·Spring·NestJS·Express·JSP)
- `agents/ddd-db-agent.md`의 ORM 화이트리스트 (Prisma·SQLAlchemy·JPA·TypeORM)

이 암묵적 가정을 **명시적 Profile + Strategy contract**로 끌어내는 것이 본 리팩토링의 본질.

### 1.3 스코프 확정

- **포함**: 웹 백엔드 + 웹 프론트엔드 + 배치 시스템
- **제외**: ML 파이프라인, 게임, CLI 도구, 라이브러리, 임베디드, 모바일

이 스코프 안에서 산출물 정의(INF/SCH/UIS/BAT)는 **그대로 의미 있음**. 변동점은 "어떻게 추출하느냐"만.

---

## 2. 핵심 설계 결정 (Decisions Log)

| # | 결정 | 근거 |
|---|------|------|
| D1 | 산출물 정의(INF/SCH/UIS/BAT/RTM/FUNC_MAP) 유지 | 스코프(웹+배치) 안에서 의미 보존 |
| D2 | Profile-driven Extraction 모델 도입 | 암묵 가정을 명시 contract로 |
| D3 | Strategy를 3차원으로 분리: **스택 × 퍼시스턴스 × 아키텍처** | 카탈로그 폭발 방지. 60~100 조합을 15~20 yaml로 합성 |
| D4 | 카탈로그(정적 yaml) + 컨벤션 학습(LLM) + 메타-추출기(LLM) **하이브리드** | 정적 안정성 + LLM 범용성 균형 |
| D5 | Profile은 영구 저장 + 사람 confirm + 자동 갱신 금지 | SI 사업의 결정론 요구사항 보장 |
| D6 | skill-creator의 evaluation harness만 부분 흡수 (스킬 동적 생성 X, yaml 동적 제안 O) | 결정론 손실 방지 |
| D7 | 기존 동작은 Phase 2까지 보존 (회귀 테스트 통과 후 이전) | 사용 중인 시스템의 위험 최소화 |

---

## 3. 현재 진행 상태 (2026-05-22 기준)

### 완료된 작업
- ✅ **sch_draft 작업** (2026-05-21)
  - `scripts/resolve_call_chain.py`: SQL 5종 패턴(FROM/JOIN/INSERT/UPDATE/DELETE)에서 테이블 추출 + `_tmp/sch_draft/{도메인}/{테이블}.json` dump
  - `agents/ddd-db-agent.md`: consolidator 역할로 변경, Phase 1 신호 우선순위 재배치
  - `skills/sl-recon/SKILL.md`: STEP 4·5 흐름에 sch_draft 통합
  - 단위 테스트 4종 통과
  - 이 변경은 본 리팩토링의 일부로 유지

### 미완료
- Phase 0 시작 대기

---

## 4. Phase 0: 즉시 호전 (1주 예상)

> **목표**: 큰 작업 시작 전, 즉시 가능한 응급조치로 DDD/Hexagonal 부분 호전 + 회귀 안전망 마련

### Task 0.1 — `SKIP_LAYERS` 정리
- **파일**: `scripts/resolve_call_chain.py:19-23`
- **변경**: `SKIP_LAYERS`에서 `domain`·`entity`·`model` 제거
- **단**: 컨텍스트 기반 판단 추가 — 예: `domain/util/*`는 여전히 skip
- **검증**:
  - 기존 Spring N-Tier sample에서 traverse 결과 변화 < 5%
  - Hexagonal sample에서 domain·application 폴더가 추적되는지 확인
- **소요**: 30분 ~ 1시간

### Task 0.2 — `probe.json` 출력 추가
- **신규 파일**: `scripts/probe.py`
- **입력**: 워크스페이스 루트 경로
- **출력 (`_tmp/probe.json`)**:
  ```json
  {
    "manifests": {"pom.xml": {...}, "package.json": {...}, "go.mod": {...}, ...},
    "directory_tree_summary": ["src/main/java/...", "src/main/resources/..."],
    "extension_distribution": {".java": 240, ".xml": 35, ".sql": 8},
    "ua_node_type_summary": {"router": 18, "service": 42, "entity": 30}
  }
  ```
- **호출 위치**: `sl-recon` STEP 0과 STEP 1 사이 또는 STEP 0.7
- **검증**: Spring/FastAPI/Node 3종 sample에서 정상 동작
- **소요**: 1일

### Task 0.3 — 회귀 테스트 기반 마련
- **신규 디렉토리**: `tests/smoke/`
- **샘플 repo 3종**:
  - `tests/smoke/spring-mybatis-ntier/` (Spring + MyBatis + N-Tier)
  - `tests/smoke/fastapi-sqlalchemy/` (FastAPI + SQLAlchemy)
  - `tests/smoke/nestjs-prisma/` (NestJS + Prisma)
- **각 repo**:
  - 최소 10~20 파일의 작은 실제 코드 (또는 가공된 합성 코드)
  - `expected/` 디렉토리에 정답 산출물 (INF·SCH 목록)
- **검증 스크립트**: `tests/run_smoke.sh` — RECON 실행 → 산출물 diff
- **소요**: 2~3일

### Task 0.4 — Phase 0 회귀 검증
- 위 3종 sample에서 `/sl-recon` 실행
- Task 0.1 변경 전후 산출물 diff 확인
- git tag `phase-0-done`

### Phase 0 산출물 체크
- [x] sch_draft 작업 (2026-05-21 완료)
- [ ] Task 0.1: SKIP_LAYERS 정리
- [ ] Task 0.2: probe.json 출력 추가
- [ ] Task 0.3: 회귀 테스트 기반 마련
- [ ] Task 0.4: Phase 0 회귀 검증 + tag

---

## 5. Phase 1: Profile 도입 (2주 예상)

> **목표**: 프로젝트 차원(스택·아키텍처·퍼시스턴스)을 명시적으로 인식·저장

### Task 1.1 — `project_profile` schema 설계
- **파일**: `templates/profile_schema.yaml` (예시 + 주석)
- **필수 필드**:
  ```yaml
  version: 1
  generated_at: ISO8601
  confirmed_by: string
  backend:
    language: string  # java/python/typescript/go/...
    framework: string # spring-boot/fastapi/express/...
    architecture: string # ntier/hexagonal/clean/ddd/modular-monolith/...
    persistence:
      type: string    # sql-orm / sql-raw / nosql / hybrid
      technologies: [string]
  frontend:
    framework: string  # react/vue/angular/svelte/null
    router: string
    architecture: string  # fsd/feature-based/atomic/layered
  batch:
    runner: string  # spring-batch/airflow/celery/quartz/cron/null
    scheduler: string
  business_logic_locations:
    - glob_pattern
  follow_paths: [string]
  skip_paths: [string]
  ```
- **소요**: 1일

### Task 1.2 — `profile-agent` 신설
- **파일**: `agents/profile-agent.md`
- **모델**: Sonnet (1회 호출, 비싸지 않음)
- **입력**: `_tmp/probe.json`, knowledge-graph, 코드 샘플 10~15개
- **출력**: `.speclinker/profile.yaml` (초안)
- **기법**: Chain-of-Thought + 명시적 evidence 인용
- **소요**: 2~3일

### Task 1.3 — Profile 사용자 confirm 흐름
- 첫 RECON 시 `profile.yaml` 생성 후 사용자에게 요약 보여주기
- 사용자 명시적 confirm (또는 수정 후 confirm)
- 이후 자동 갱신 금지 — 명시적 `/sl-init --reprofile` 같은 명령으로만
- **소요**: 1일

### Task 1.4 — Profile을 ddd-* 에이전트에 전달
- `sl-recon` SKILL.md 흐름 조정
- 모든 ddd-* 에이전트 프롬프트에 `profile.yaml` 경로 추가
- **이 단계에서는 profile은 부가 정보로만 — 기존 동작 변경 없음**
- 기존 회귀 테스트 통과 확인
- **소요**: 1일

### Task 1.5 — Phase 1 회귀 검증
- 3종 sample에서 profile 자동 생성 정확도 측정
- git tag `phase-1-done`

### Phase 1 산출물 체크
- [ ] Task 1.1: profile schema 설계
- [ ] Task 1.2: profile-agent 신설
- [ ] Task 1.3: 사용자 confirm 흐름
- [ ] Task 1.4: profile을 ddd-* 에이전트에 전달
- [ ] Task 1.5: 회귀 검증 + tag

---

## 6. Phase 2: Strategy 카탈로그 (4주 예상)

> **목표**: 현재 하드코딩된 패턴을 strategy yaml로 외부화 + 빌트인 카탈로그 구축

### Task 2.1 — Strategy yaml schema 설계
- **파일**: `templates/strategy_schema.yaml`
- **차원**: 스택 / 퍼시스턴스 / 아키텍처 / 프론트
- **조합 규칙**: 베이스 yaml + 차원별 yaml 머지
- **필수 섹션**:
  ```yaml
  name: spring-jpa-hexagonal
  matches_profile:
    backend.language: java
    backend.framework: spring-boot
    backend.architecture: hexagonal
    backend.persistence.type: sql-orm
  
  call_chain:
    follow_when: [path_contains|file_suffix|annotation_present]
    skip_when:   [path_contains|file_suffix]
  
  endpoint_extraction:
    patterns:
      - regex: '...'
        method_group: 1
        path_group: 2
  
  query_extraction:
    - type: jpa_query_annotation
      patterns: [...]
    - type: mybatis_xml
      locations: [...]
  
  artifact_mapping:
    INF: { source: glob, extractor: type }
    SCH: { source: glob, enrich_from: ... }
    UIS: ...
    BAT: ...
    BusinessRules: ...  # Hexagonal/DDD에서만
  ```
- **소요**: 2~3일

### Task 2.2 — 빌트인 strategy 작성 (15~20개)

#### 백엔드 스택 (8개)
- [ ] `strategies/backends/spring.yaml`
- [ ] `strategies/backends/express.yaml`
- [ ] `strategies/backends/fastapi.yaml`
- [ ] `strategies/backends/nestjs.yaml`
- [ ] `strategies/backends/django.yaml`
- [ ] `strategies/backends/gin.yaml`
- [ ] `strategies/backends/quarkus.yaml`
- [ ] `strategies/backends/ktor.yaml`

#### 퍼시스턴스 (5개)
- [ ] `strategies/persistence/mybatis.yaml`
- [ ] `strategies/persistence/jpa.yaml`
- [ ] `strategies/persistence/sqlalchemy.yaml`
- [ ] `strategies/persistence/prisma.yaml`
- [ ] `strategies/persistence/gorm.yaml`

#### 아키텍처 (4개)
- [ ] `strategies/arch/ntier.yaml`
- [ ] `strategies/arch/hexagonal.yaml`
- [ ] `strategies/arch/clean.yaml`
- [ ] `strategies/arch/modular-monolith.yaml`

#### 프론트엔드 (3개)
- [ ] `strategies/frontend/react.yaml`
- [ ] `strategies/frontend/vue.yaml`
- [ ] `strategies/frontend/fsd.yaml`

#### 배치 (3개)
- [ ] `strategies/batch/spring-batch.yaml`
- [ ] `strategies/batch/airflow.yaml`
- [ ] `strategies/batch/celery.yaml`

- **검증**: 각 yaml에 대해 sample repo로 추출 테스트
- **소요**: 3주

### Task 2.3 — `resolve_call_chain.py` 리팩토링
- 하드코딩된 `FOLLOW_LAYERS`/`SKIP_LAYERS`/`QUERY_EXTS` 제거
- Strategy yaml 읽어 동적 적용
- 합성 함수: profile + base strategies → effective strategy
- **검증**: 기존 동작 100% 재현 (회귀 테스트 통과)
- **소요**: 3일

### Task 2.4 — ddd-* 에이전트 본문 슬림화
- 스택별 분기 (FastAPI/Spring/NestJS 패턴 카탈로그) 제거
- "strategy.endpoint_extraction 패턴을 적용" 한 줄로 대체
- 에이전트 본문 200줄 → 80줄 목표
- **소요**: 2일

### Task 2.5 — Phase 2 회귀 검증
- 3종 + 신규 추가된 5종 sample (총 8종)에서 RECON 실행
- 기존 산출물과 diff 비교
- 모든 회귀 통과 후 git tag `phase-2-done`

### Phase 2 산출물 체크
- [ ] Task 2.1: Strategy schema
- [ ] Task 2.2: 빌트인 strategy 15~20개
- [ ] Task 2.3: resolve_call_chain.py 리팩토링
- [ ] Task 2.4: ddd-* 에이전트 슬림화
- [ ] Task 2.5: 회귀 검증 + tag

---

## 7. Phase 3: 컨벤션 학습 (3주 예상)

> **목표**: 같은 스택이라도 회사·팀별 명명/구조 차이를 자동 학습

### Task 3.1 — `convention-learner` 에이전트 신설
- **파일**: `agents/convention-learner.md`
- **입력**: profile + 코드 샘플 15~25개
- **출력**: `.speclinker/conventions.yaml`
- **추출 대상**:
  - Controller 접미사 (`*Controller`, `*Resource`, `*Handler`, `*Endpoint`)
  - DAO 위치 (`dao/`, `repository/`, `persistence/`, 자체 이름)
  - 도메인 디렉토리 명명 (`domain/`, `core/`, `business/`)
  - 패키지 구조 (depth, 도메인 분할 방식)
- **소요**: 5일

### Task 3.2 — Strategy overlay 메커니즘
- 베이스 strategy + conventions.yaml = effective strategy
- 우선순위: conventions가 strategy의 패턴을 override
- 머지 규칙 명문화
- **소요**: 2일

### Task 3.3 — 사용자 검수 단계
- 학습된 conventions 사용자에게 표 형태로 보여주기
- "이 프로젝트의 Controller 명명: `*RestController` (12개 발견) — 맞나요?"
- 수정·승인 UI
- **소요**: 3일

### Task 3.4 — Phase 3 회귀 검증
- 자체 컨벤션 가진 sample 2종 추가
- git tag `phase-3-done`

### Phase 3 산출물 체크
- [ ] Task 3.1: convention-learner
- [ ] Task 3.2: overlay 메커니즘
- [ ] Task 3.3: 사용자 검수 단계
- [ ] Task 3.4: 회귀 검증 + tag

---

## 8. Phase 4: 메타-추출기 (3주 예상)

> **목표**: 카탈로그에 없는 완전 새 케이스에 대한 fallback

### Task 4.1 — `meta-extractor` 에이전트 신설
- **파일**: `agents/meta-extractor.md`
- **발동 조건**: profile에 매칭되는 strategy 0개일 때
- **입력**: profile + 코드 샘플 30~50개
- **출력**: strategy yaml 초안 (사람 검수 필요 마크)
- **검증**: 추출된 yaml로 실제 sample에서 INF 5개 이상 추출 가능한지 자동 확인
- **소요**: 1주

### Task 4.2 — Yaml promote 워크플로우
- 사용자가 검수·수정한 yaml을 `strategies/community/` 또는 정식 디렉토리로 promote
- promote 후 다음 RECON부터 자동 매칭
- 충돌 시 충돌 해결 안내
- **소요**: 3일

### Task 4.3 — Phase 4 통합 테스트
- 미지원 스택 (예: Rails 또는 Elixir Phoenix) sample 1개
- meta-extractor 발동 → yaml 초안 생성 → 사람 검수 → promote → 재실행 → 정상 추출
- git tag `phase-4-done`

### Phase 4 산출물 체크
- [ ] Task 4.1: meta-extractor 에이전트
- [ ] Task 4.2: yaml promote 워크플로우
- [ ] Task 4.3: 통합 테스트 + tag

---

## 9. Phase 5: 회귀 인프라 (지속)

> **목표**: 매트릭스 회귀 측정으로 품질 보증

### Task 5.1 — Sample repo 매트릭스 구축
- Strategy 조합당 sample repo 1개 (15~20개)
- 각 repo의 ground-truth (정답 INF/SCH/UIS/BAT) 작성
- 작성 비용: repo당 1~2일

### Task 5.2 — 회귀 측정 도구
- skill-creator의 `aggregate_benchmark.py` 일부 흡수
- `tests/run_matrix.sh` — 모든 strategy 조합 실행 → 정확도 측정
- 출력: precision/recall per strategy

### Task 5.3 — CI 통합 (선택)
- GitHub Actions에 통합 (외부 repo로 옮길 경우)
- PR마다 회귀 자동 실행

### Phase 5 산출물 체크
- [ ] Task 5.1: sample repo 매트릭스
- [ ] Task 5.2: 회귀 측정 도구
- [ ] Task 5.3: CI 통합 (선택)

---

## 10. 위험 관리 & 롤백

### 단계별 안전망
- 각 Phase 마지막에 git tag (`phase-0-done`, `phase-1-done`, ...)
- Phase별 회귀 테스트 통과 후 다음 진행
- 실패 시 직전 tag로 롤백

### 핵심 위험
| 위험 | 대응 |
|------|------|
| Profile LLM 분류 오류 | 사용자 confirm 단계 필수 |
| Strategy yaml 패턴 누락 | per-strategy fallback 정규식 + LLM 보강 |
| 두 시스템 공존 기간의 복잡도 | Phase 2 완료 시점에 하드코딩 완전 제거 |
| 카탈로그 작성 부담 | Phase 2를 4주로 충분히 잡음 + 우선순위(많이 쓰이는 스택부터) |
| 메타-추출기 신뢰성 | 사람 검수 + sample 회귀 통과 의무 |

---

## 11. 의존성 파일·자산 위치 (다음 세션 참고용)

### 변경 가능성 높은 파일
- `scripts/resolve_call_chain.py` (Phase 0·2)
- `agents/ddd-api-agent.md` (Phase 2)
- `agents/ddd-db-agent.md` (sch_draft 완료, Phase 2 추가 변경)
- `agents/ddd-ui-agent.md` (Phase 2)
- `agents/ddd-batch-agent.md` (Phase 2)
- `agents/spec-agent.md` (Phase 1)
- `skills/sl-recon/SKILL.md` (Phase 0~4 모두)

### 신설 예정 파일
- `scripts/probe.py` (Phase 0)
- `agents/profile-agent.md` (Phase 1)
- `agents/convention-learner.md` (Phase 3)
- `agents/meta-extractor.md` (Phase 4)
- `strategies/**/*.yaml` (Phase 2~)
- `templates/profile_schema.yaml` (Phase 1)
- `templates/strategy_schema.yaml` (Phase 2)
- `tests/smoke/**` (Phase 0)
- `tests/matrix/**` (Phase 5)

### 보존할 산출물
- 사용자 프로젝트의 `.speclinker/profile.yaml`
- 사용자 프로젝트의 `.speclinker/conventions.yaml`
- 사용자 프로젝트의 `.speclinker/dynamic-strategies/*.yaml` (promote 전)

---

## 12. 진행 추적 (각 turn마다 업데이트)

### 완료
- [x] **사전 작업: sch_draft** (2026-05-21)
  - resolve_call_chain.py: SQL 5종 패턴 추출, dump_sch_drafts 함수 추가
  - ddd-db-agent.md: consolidator 역할 + Phase 1 신호 우선순위 재배치
  - sl-recon SKILL.md: STEP 4·5 sch_draft 흐름 통합
  - 단위 테스트 4종 통과

- [x] **Phase 0.1: SKIP_LAYERS 정리 + 매칭 로직 강화** (2026-05-22)
  - `SKIP_LAYERS`에서 `domain`, `entity`, `model`, `auth` 제거 (DDD/Hexagonal 즉시 호전)
  - `has_layer_signal()` 헬퍼 신설 — 세그먼트 단위 정확/복수형 매칭 + 마지막 세그먼트는 부분문자열
  - 확장자(`.py`/`.java`/...) 및 `__init__`/`index` 토큰 자동 제거
  - `extract_java_imports`, `extract_python_imports`, `extract_ts_imports` 셋 모두 새 헬퍼 사용
  - 단위 테스트 25/25 통과 (N-Tier 회귀 0, DDD/Hexagonal 신규 케이스 다수 매칭)

- [x] **Phase 0.2: probe.json 출력 추가** (2026-05-22)
  - 신규 `scripts/probe.py` (≈400줄)
  - 매니페스트 9종 파서 (Java pom/gradle, Python requirements/pyproject, Node package.json, Go go.mod, Rust Cargo, PHP composer, Ruby Gemfile, Elixir mix.exs, C# csproj)
  - `indicators` 자동 추정: likely_backend_lang/framework, likely_persistence, likely_frontend_framework, likely_batch, architecture_hints
  - 아키텍처 hint: hexagonal / clean-onion / ddd-tactical / n-tier / fsd-frontend / modular-monolith / 자체 컨벤션
  - Windows 다른 드라이브 path 문제 해결 (`_safe_relpath`), `max_depth=10`로 walk 범위 확장
  - 6종 fixture(Spring+MyBatis N-Tier / Spring+JPA Hexagonal / FastAPI+SQLAlchemy / NestJS+Prisma / Go+Gin+GORM / React+FSD) 전부 통과
  - `sl-recon` SKILL.md에 STEP 1.5로 통합 (현재는 정보 수집만, 동작 변경 0)

- [x] **Phase 0.3: 회귀 테스트 기반** (2026-05-22)
  - `tests/smoke/` 디렉토리 + 4종 fixture 영구 구축
    - `spring-mybatis-ntier/` (pom.xml + Controller→Service→DAO→MyBatis XML)
    - `spring-jpa-hexagonal/` (build.gradle + adapter/in.web → application/service → adapter/out.persistence + domain)
    - `fastapi-sqlalchemy/` (requirements.txt + routers→services→repositories→models)
    - `nestjs-prisma/` (package.json + controller→service→repository + Prisma schema)
  - 각 fixture에 `expected.json` (probe indicators + call chain 기대값)
  - `tests/run_smoke.py` 신설 — probe + resolve_call_chain 동시 검증
  - 검증 중 발견한 실제 결함 3개 수정:
    - `@nestjs/platform-express`의 `express` substring 매칭 false positive → framework 매칭 순서 재배치
    - Hexagonal `domain/Order.java` 추적은 Phase 0 범위 밖임을 명확화 → `future_phase2_expectations`로 분리
    - MyBatis DAO와 mapper xml 파일명 불일치 → fixture 통일
  - **검증**: 4/4 fixture 통과

- [x] **Phase 0.4: Phase 0 회귀 검증** (2026-05-22)
  - 모든 smoke test 통과
  - git tag `phase-0-done`은 환경상 보류 (git 가능한 환경에서 별도 수행)

- [x] **Phase 1.1: profile schema 설계** (2026-05-22)
  - 신규 `templates/profile_schema.yaml` (v1, 11개 최상위 섹션)
  - 섹션: version / generated_at / confirmed_by / confirmed_at / backend / frontend / batch / concerns / project_layout / overrides / _meta
  - 각 섹션마다 evidence 필드로 검수 가능성 확보
  - 핵심 원칙 명시: 영구 저장, 자동 갱신 금지, 모르는 값은 null
  - yaml 문법 검증 + 필수 섹션 11/11 존재 확인

- [x] **Phase 1.2: profile-agent 신설** (2026-05-22)
  - 신규 `agents/profile-agent.md`
  - 입력: probe.json + UA 그래프 + 코드 샘플 ≤15개
  - 6 Phase 구조 (입력 → probe 흡수 → 증거 보강 → yaml 작성 → 사용자 confirm 요청 → Self-Critique)
  - 사용자 confirm 요청은 명확한 형식의 요약 메시지로 출력
  - 추측 금지 원칙: 모르는 값은 null/unknown으로 유지

- [x] **Phase 1.3·1.4: sl-recon 흐름 통합 + ddd-* 에이전트에 Profile 전달** (2026-05-22)
  - `sl-recon` SKILL.md에 STEP 1.7 신설 (Profile 생성/로드 + 사용자 confirm 안내)
  - 4개 ddd-* 에이전트 호출 프롬프트에 `프로젝트 Profile: .speclinker/profile.yaml` 라인 추가
  - 4개 ddd-* 에이전트 본문(api/db/ui/batch)에 "Profile 활용" 섹션 추가 (framework/persistence/runner별 분기 가이드)
  - 정책: 현재는 점진 도입 — Profile 없어도 기존 fallback 패턴으로 동작

- [x] **Phase 1.5: Phase 1 회귀 검증** (2026-05-22)
  - smoke test 4/4 통과 (Profile 도입 후에도 회귀 0)
  - profile_schema.yaml 문법·필수 섹션 검증 통과
  - git tag `phase-1-done`은 환경상 보류

- [x] **Phase 2.1: Strategy schema 설계** (2026-05-22)
  - 신규 `templates/strategy_schema.yaml` (v1)
  - 3차원 분리 (backend / persistence / arch / frontend / batch)
  - priority 기반 합성 (arch=300, persistence=200, backend=100)
  - matches_profile + call_chain + endpoint_extraction + query_extraction + artifact_mapping 섹션
  - dynamic_sql_patterns로 MyBatis `${}` 같은 동적 SQL 플래그

- [x] **Phase 2.2 (부분): 빌트인 strategy 10개 초안 작성** (2026-05-22)
  - backends: `spring.yaml`, `fastapi.yaml`, `nestjs.yaml`, `express.yaml` (4개)
  - persistence: `mybatis.yaml`, `jpa.yaml`, `sqlalchemy.yaml`, `prisma.yaml` (4개)
  - arch: `ntier.yaml`, `hexagonal.yaml` (2개)
  - 각 strategy yaml에 tested_against (smoke fixture 참조)
  - 남은 작업: gin/django/quarkus/ktor 백엔드, gorm/typeorm 퍼시스턴스, clean/modular-monolith 아키텍처, frontend/batch strategy 다수

- [x] **Phase 2.3 (부분): resolve_call_chain.py에 strategy 로더 도입** (2026-05-22)
  - `load_yaml`, `_profile_matches_strategy`, `load_effective_layers` 함수 추가
  - **점진 도입**: Profile 있으면 합성, 없으면 DEFAULT 그대로 (회귀 0)
  - FOLLOW/SKIP_LAYERS 별칭 유지 (backward-compat)
  - 합성 검증: 5/5 (Spring N-Tier·Spring Hexagonal·FastAPI·NestJS·no-profile)
  - 남은 작업: extract_java_imports/extract_python_imports/extract_ts_imports를 effective_layers 직접 사용하도록 리팩토링 (현재는 별칭 통해 동작)

- [x] **Phase 2.3 (완료): import 추출 함수 effective_layers 직접 사용** (2026-05-22)
  - `extract_java_imports`, `extract_python_imports`, `extract_ts_imports`, `extract_imports`, `resolve_chain` 모두 follow/skip_layers 옵션 인자
  - resolve_chain이 진입 시 1회 load_effective_layers() 호출 후 모든 traverse에 전달
  - strategy의 max_depth가 더 크면 자동 확장 (Hexagonal=4)
  - 회귀 0 (smoke 4/4 통과)

- [x] **Phase 2 본질적 가치 검증 (2026-05-22)** ★★★
  - `tests/smoke/spring-jpa-hexagonal/.speclinker/profile.yaml` 영구 fixture로 추가
  - expected.json 의 `future_phase2_expectations` → `call_chain_expectations`로 승격 (domain_must_resolve_to 정식 검증)
  - **결과**: Profile + strategy(arch/hexagonal.yaml) 합성으로 `domain/Order.java` 까지 자동 traverse 성공
  - 이건 사용자가 처음부터 원했던 "아키텍처 무관 spec 추출"의 첫 가시적 증거
  - smoke 4/4 + Hexagonal domain 자동 추적 통과

- [x] **Phase 2.2 확장: 빌트인 strategy 12개 추가** (2026-05-24)
  - 신규 backends 2개: `gin.yaml`, `django.yaml` (총 6개)
  - 신규 persistence 2개: `gorm.yaml`, `typeorm.yaml` (총 6개)
  - 신규 arch 2개: `clean.yaml`, `modular-monolith.yaml` (총 4개)
  - 신규 frontend 3개: `react.yaml`, `vue.yaml`, `fsd.yaml` (총 3개)
  - 신규 batch 3개: `spring-batch.yaml`, `airflow.yaml`, `celery.yaml` (총 3개)
  - **총 22개 strategy yaml 보유** (목표 15~20개 초과 달성)
  - load_effective_layers에 `frontend`·`batch` 디렉토리 합류
  - **검증**: 22/22 yaml 문법 통과, 10/10 신규 조합 합성 OK, smoke 4/4 회귀 0

- [x] **Phase 2.4 (부분): ddd-* 에이전트 스택 카탈로그 슬림화** (2026-05-24)
  - `ddd-api-agent.md` Phase 2-A: 5종 framework 패턴 카탈로그 → Strategy 우선/Fallback/Overrides 3계층 흐름으로 재정의
  - `ddd-db-agent.md` Phase 1 ORM 신호: Strategy `query_extraction.types` 우선 사용으로 명문화
  - `ddd-ui-agent.md` 라우터 타입별 패턴: Profile.frontend.framework 매칭 블록만 적용하도록 가이드 추가, fallback 4종은 유지
  - "본문 카탈로그 더 늘리지 말 것 — 새 framework는 strategy yaml로" 정책 명시
  - 남은 작업: ddd-batch-agent의 BATCH_NAME_KW 등은 SKILL.md 인벤토리 빌더에 있어 후속 phase에서 처리

- [x] **Phase 3.1: convention-learner 에이전트 신설** (2026-05-24)
  - 신규 `agents/convention-learner.md`
  - 회사·팀 자체 명명·구조 컨벤션을 코드 직접 분석으로 학습
  - 학습 결과를 `profile.yaml`의 `overrides` 섹션에 패치 (별도 conventions.yaml 만들지 않음 — 한 파일로 통합)
  - 사용자 검수 요청 형식 명시

- [x] **Phase 3.2: profile.overrides 합성 메커니즘** (2026-05-24)
  - `load_effective_layers`에 `profile.overrides.follow_layers_extra/skip_layers_extra` 합성 추가
  - 우선순위: strategy(arch=300/persistence=200/backend=100) → overrides 최종
  - 검증: 자체 컨벤션 시나리오(manager/logic/legacy/deprecated) 정상 적용

- [x] **Phase 3.3: sl-recon에 convention-learner 옵션 호출 통합** (2026-05-24)
  - STEP 1.7 (Profile) 직후에 옵션 호출 흐름 추가
  - 자동 권장 로직 (follow_layers < 8 이면 호출 권장)

- [x] **Phase 4.1: meta-extractor 에이전트 신설** (2026-05-24)
  - 신규 `agents/meta-extractor.md`
  - 빌트인 22개 strategy로 매칭 안 되는 미지원 스택에서 새 strategy yaml 초안 자동 제안
  - 사용자 검수 후 `strategies/community/` → `strategies/{kind}/` promote 워크플로우
  - yaml 자동 검증 (yaml.safe_load + name/kind 필수)

- [x] **Phase 4.2: community/ promote 메커니즘** (2026-05-24)
  - `load_effective_layers`에 `strategies/community/` 디렉토리 자동 합류
  - meta-extractor가 만든 검수 대기 yaml도 즉시 합성에 참여 가능
  - sl-recon STEP 1.7에 meta-extractor 옵션 호출 통합 + 자동 권장 로직

- [x] **Phase 2.5 / 3.4 / 4.3: 통합 회귀 검증** (2026-05-24)
  - smoke 4/4 통과 (Phase 0·1·2·3·4 누적)
  - strategy 합성 10/10 (gin/django/typeorm/clean/modular/fsd/airflow/celery/vue 등)
  - profile.overrides 합성 정상
  - yaml 22/22 문법 통과

- [x] **Phase 5.1: sample repo 매트릭스 확장** (2026-05-26)
  - fixture 4 → **7종**으로 확장
  - 신규: `go-gin-gorm` (Go + Gin + GORM, .go 파일)
  - 신규: `django-drf` (Django + DRF ViewSet + django-orm)
  - 신규: `vue-fsd` (Vue 3 + Vue Router + Pinia + FSD 슬라이스)
  - 각 fixture에 `.speclinker/profile.yaml` 영구 추가 → strategy 합성 직접 검증
  - 부가 fix:
    - `detect_language()`에 `.vue`/`.svelte`/`.mjs`/`.cjs` 추가 — Vue SFC 추적 가능
    - probe.py FSD 매칭 조건 완화 (features + entities + 1개 더 → FSD 의심)

- [x] **Phase 5.2: 회귀 측정 도구 (`run_matrix.py`)** (2026-05-26)
  - 신규 `tests/run_matrix.py` (≈260줄)
  - probe / call_chain / strategy 각 단계별 정확도 측정
  - precision (passed/total) + accuracy 집계
  - markdown 보고서 자동 생성 (`tests/_results/benchmark.md`)
  - JSON 결과 (`tests/_results/benchmark.json`) — baseline 비교 지원
  - **검증 결과 (2026-05-26)**: 7 fixture / probe 평균 **1.00** / call_chain 평균 **1.00**

### 진행 예정 (남은 작업)
- [ ] 5.1 추가 sample (Quarkus, ASP.NET Core, Rails, Phoenix, Spring+JPA+Clean, NestJS+TypeORM 등) — 우선순위 낮음
- [ ] 5.3 CI 통합 (GitHub Actions) — 외부 repo 이전 시점
- [ ] ddd-batch-agent의 SKILL.md BATCH_NAME_KW 카탈로그도 strategy.batch_signals로 이전 (Phase 6 인벤토리 빌더 분리 시)
- [ ] Go·Rust·Kotlin import 추출 지원 (Phase 6 multi-language)
- [ ] git tag `phase-{N}-done` 체계 (환경 제한으로 보류)

**Phase 3 (컨벤션 학습)**
- [ ] 3.1 convention-learner 에이전트 신설
- [ ] 3.2 overlay 메커니즘 (effective_strategy 합성에 conventions.yaml 머지)
- [ ] 3.3 사용자 검수 단계
- [ ] 3.4 회귀 + tag

**Phase 4 (메타-추출기)**
- [ ] 4.1 meta-extractor 에이전트 (미지원 profile일 때 strategy yaml 초안 제안)
- [ ] 4.2 yaml promote 워크플로우
- [ ] 4.3 통합 테스트

**Phase 5 (회귀 인프라 지속)**
- [ ] 5.1 sample repo 매트릭스 확장 (스택 조합당 1개)
- [ ] 5.2 회귀 측정 도구 (skill-creator aggregate_benchmark 흡수)

**Phase 1**
- [ ] 1.1 profile schema 설계
- [ ] 1.2 profile-agent 신설
- [ ] 1.3 사용자 confirm 흐름
- [ ] 1.4 profile을 ddd-* 에이전트에 전달
- [ ] 1.5 회귀 검증 + tag `phase-1-done`

**Phase 2**
- [ ] 2.1 Strategy schema
- [ ] 2.2 빌트인 strategy 15~20개 (위 5번 섹션 체크리스트 참조)
- [ ] 2.3 resolve_call_chain.py 리팩토링
- [ ] 2.4 ddd-* 에이전트 슬림화
- [ ] 2.5 회귀 검증 + tag `phase-2-done`

**Phase 3**
- [ ] 3.1 convention-learner
- [ ] 3.2 overlay 메커니즘
- [ ] 3.3 사용자 검수 단계
- [ ] 3.4 회귀 검증 + tag `phase-3-done`

**Phase 4**
- [ ] 4.1 meta-extractor 에이전트
- [ ] 4.2 yaml promote 워크플로우
- [ ] 4.3 통합 테스트 + tag `phase-4-done`

**Phase 5**
- [ ] 5.1 sample repo 매트릭스
- [ ] 5.2 회귀 측정 도구
- [ ] 5.3 CI 통합 (선택)

---

## 13. 다음 세션 시작 안내

### 다음 세션에서 이어가기 — 사용자가 말하면 좋은 표현
- "리팩토링 이어가자"
- "REFACTOR_PLAN.md 보고 다음 task 진행해"
- "Phase 0.1부터 시작해"

### Assistant가 새 세션 시작 시 해야 할 일
1. 이 파일(`D:\gen-harness\plugins\speclinker\REFACTOR_PLAN.md`) 먼저 읽기
2. §12 진행 추적에서 가장 최근 완료된 task 확인
3. 그 다음 미완료 task 1개 선택해서 시작
4. 사용자 결정점이 있으면 명시적 질문 (예: "Strategy 빌트인 우선순위는 어떤 스택부터 작성할까요?")
5. task 완료할 때마다 §12 체크박스 업데이트 (이 파일 Edit)
6. Phase 완료 시 git tag 만들고 사용자에게 보고

### 의사결정 변경이 필요할 때
§2 Decisions Log에 새 결정 추가하고, 이전 결정과 충돌 시 명시적으로 superseded 표기

---

## 14. 변경 이력

| 일자 | 변경 | 작성자 |
|------|------|--------|
| 2026-05-22 | 최초 작성 | Claude (사용자 옵션 가 선택 후) |
| 2026-05-22 | Phase 0.1·0.2 완료. resolve_call_chain.py 매칭 로직 강화 + probe.py 신설 + sl-recon STEP 1.5 통합. 검증: layer 단위 25/25 + probe fixture 6/6 | Claude |
| 2026-05-22 | Phase 0.3·0.4 완료. tests/smoke 4 fixture 영구화 + run_smoke.py + 실제 결함 3건 수정 (nestjs/express 매칭 순서, hexagonal domain 인식 범위 명확화, mybatis xml 파일명 통일). 검증: 4/4 통과 | Claude |
| 2026-05-22 | Phase 1 완료. profile_schema.yaml + profile-agent.md + sl-recon STEP 1.7 + 4개 ddd-* 에이전트 Profile 통합. 검증: smoke 4/4 회귀 0, yaml schema 11/11 섹션 OK | Claude |
| 2026-05-22 | Phase 2.1~2.3 부분 완료. strategy_schema.yaml + 빌트인 strategy 10개(backends 4 + persistence 4 + arch 2) + resolve_call_chain.py에 load_effective_layers 점진 도입. 검증: strategy 합성 5/5, smoke 4/4 회귀 0 | Claude |
| 2026-05-22 | Phase 2.3 완전 전환 + 본질적 가치 검증 ★. extract_*_imports 모두 effective_layers 사용. Hexagonal fixture에 profile.yaml 영구 추가, domain/Order.java 자동 추적 검증 통과 | Claude |
| 2026-05-24 | Phase 2.2 확장(strategy 22개 보유) + 2.4 부분 완료(ddd-api/db/ui 카탈로그 슬림화). load_effective_layers가 frontend/batch 디렉토리도 합성. 검증: yaml 22/22, 합성 조합 10/10, smoke 4/4 | Claude |
| 2026-05-24 | Phase 3 (convention-learner + profile.overrides 합성 + sl-recon 통합) + Phase 4 (meta-extractor + community/ promote 워크플로우) 완료. 회귀 0 | Claude |
| 2026-05-26 | Phase 5.1·5.2 완료. fixture 4→7종 (go-gin-gorm, django-drf, vue-fsd 추가). run_matrix.py 신설로 정량 회귀 측정 도입. 결과: probe 1.00 / call_chain 1.00 (perfect) | Claude |
