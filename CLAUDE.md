# Speclinker — 플러그인 두뇌 (CLAUDE.md)

## 개요

이 파일은 SI/ITO 개발 전주기 자동화 플러그인 Speclinker의 라우팅 규칙을 정의합니다.
사용자 입력을 분석하여 적절한 스킬(Skill)로 라우팅하고, 서브에이전트를 조율합니다.

## 커맨드 라우팅 규칙

| 사용자 입력 | 라우팅 스킬 | 전제 조건 | 모드 |
|-----------|-----------|---------|------|
| `/sl-init` | `skills/sl-init/SKILL.md` | 없음 | GENESIS, RECON |
| `/sl-genesis [파일]` | `skills/sl-genesis/SKILL.md` | project.env, docs/00_입력자료/ | GENESIS |
| `/sl-recon` | `skills/sl-recon/SKILL.md` | project.env, 소스코드 존재 | RECON |
| `/sl-aidd [FUNC-ID]` | `skills/sl-aidd/SKILL.md` | docs/00_FUNC/FUNC_MAP.md 존재 | GENESIS, RECON |
| `/sl-analyze` | `skills/sl-analyze/SKILL.md` | project.env, docs/05_설계서/ | DELTA |
| `/sl-change <SR-ID>` | `skills/sl-change/SKILL.md` | project.env, docs/05_설계서/, docs/00_FUNC/FUNC_MAP.md | DELTA |
| `/sl-rtm` | `skills/sl-rtm/SKILL.md` | docs/02_추적표/ 또는 docs/00_FUNC/ | 전체 |
| `/sl-dev` | `skills/sl-dev/SKILL.md` | docs/05_설계서/ 존재 | 전체 |
| `/sl-test` | `skills/sl-test/SKILL.md` | 06_소스코드/ 존재 | 전체 |

## 전제 조건 체크

모든 커맨드 실행 전 다음을 확인한다:

```bash
!cat project.env 2>/dev/null || echo "project.env 없음 — /sl-init 먼저 실행 필요"
```

## 서브에이전트 조율

### 산출물 생성 파이프라인 (spec-agent 오케스트레이터 → 전문 서브에이전트)

| 에이전트 | 역할 | 모델 | 기법 |
|--------|------|------|------|
| `agents/spec-agent.md` | 파이프라인 오케스트레이터 | Opus | 순차/병렬 조율 |
| `agents/rd-agent.md` | REQ-ID 추출 + RD 생성 | Opus | ReAct + Tree-of-Thoughts |
| `agents/srs-agent.md` | SRS 상세화 | Opus | Chain-of-Thought + Reflexion |
| `agents/sad-agent.md` | 아키텍처 설계서 | Opus | 패턴 매칭 + Self-Critique |
| `agents/ddd-api-agent.md` | API 명세 (INF-XXX) | Sonnet | DSPy-style 구조화 출력 |
| `agents/ddd-db-agent.md` | DB 스키마 (SCH-XXX) | Sonnet | 3NF 검증 + ERD 생성 |
| `agents/ddd-ui-agent.md` | 화면 설계 (UIS-F-XXX) | Sonnet | 소스 증거 원칙 + ASCII 와이어 |
| `agents/ddd-batch-agent.md` | 배치 명세 (BAT-XXX) | Sonnet | 배치 확정 판별 + MCP DB 스케줄 조회 |
| `agents/rtm-agent.md` | RTM 체인 + 품질 게이트 | Opus | Constitutional AI |

### 코드·테스트 에이전트

| 태스크 | 서브에이전트 | 모델 | 이유 |
|--------|-----------|------|------|
| 코드 생성 | `agents/dev-agent.md` | Sonnet | 반복 실행 태스크 |
| 테스트 | `agents/test-agent.md` | Sonnet | 반복 실행 태스크 |

### UA 인프라 에이전트 (sl-recon STEP 1 내부 호출)

| 에이전트 | 역할 | 모델 |
|--------|------|------|
| `ua/agents/project-scanner.md` | 파일 구조·언어·프레임워크 스캔 | inherit |
| `ua/agents/file-analyzer.md` | 노드·엣지 추출 (knowledge-graph 생성) | inherit |
| `ua/agents/architecture-analyzer.md` | 레이어 분류 | inherit |
| `ua/agents/domain-analyzer.md` | 도메인 플로우 분석 (domain-graph 생성) | inherit |

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
| 기존 코드 (RECON 분석만) | sl-init → sl-recon → 납품 |
| 변경·유지보수 | sl-analyze → sl-change → **sl-aidd** |

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
