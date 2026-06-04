# GENESIS 모드 제거 — 설계서 (Sub-project A)

- 작성일: 2026-06-04
- 대상: speclinker 플러그인
- 방향: SM(운영 중 시스템) 전용 — RECON(현행소스→스펙) + DELTA(변경관리) + AIDD. SI(신규구축)용은 별도 플러그인으로 분리.

## 1. 배경 / 결정

기존엔 SI/ITO 양쪽을 노린 GENESIS(기획서→신규 설계서 순방향) + RECON(역방향) 이중 모드였다.
SI용은 별도 플러그인으로 분리하기로 함에 따라 **GENESIS를 전면 제거**한다.

**추적 축 결정(확정):** REQ-F/REQ-NF/RD(요구사항정의서)를 **완전 제거**. 추적 주축은
**FUNC-ID(RECON)** + **SR(DELTA 변경요청)**. RTM은 FUNC 기반(`sl-rtm --func`)만 유지.

```
SM 추적 체인:
  FUNC-ID → SRS → INF/SCH/UIS → 코드(linked_func) → TC
  변경:   SR-ID → 영향분석(CIA) → TO-BE 스펙 → 코드
```

> **본 작업(A)의 범위는 "GENESIS/REQ 순수 제거"에 한정**한다. RECON 외 명령어 중복 정리·BMAD 기반
> AIDD 재설계는 **별도 Sub-project B**에서 진행한다. A는 B가 올라설 깨끗한 베이스를 만든다.

## 2. 불변식 (절대 깨지면 안 되는 것)

1. **RECON 파이프라인 무결성**: `/sl-recon`(STEP 0~6) → `/sl-recon-uis` → `/sl-recon-doc` 전 STEP 동작 보존.
2. **공유 에이전트의 RECON 경로 보존**: `rd-agent`(RECON 9-2 FUNC 생성), `srs-agent`(9-3 SRS), `spec-agent`(2-1 SAD/도메인)는 **삭제하지 않고 GENESIS 분기만 제거**한다.
3. **DELTA 동작 보존**: `sl-analyze`/`sl-change`/`sl-quick`(SR 기반) 유지.
4. **AIDD/dev/test/sprint/drift/context/ia 동작 보존** (내용 정리는 B에서).
5. 산출물 ID 형식 불변: `FUNC-{도메인}-NNN`, `INF/SCH/UIS-{CODE}-NNN`, `SR-ID`.

## 3. 변경 분류

### 3-1. ❌ 완전 삭제
| 대상 | 비고 |
|------|------|
| `skills/sl-genesis/` (디렉토리 전체) | GENESIS 순방향 생성 스킬 |
| `templates/RD_template.md` | 요구사항정의서 템플릿 (REQ-F 산출) |
| `plugin.json` `skills[]`의 `./skills/sl-genesis` | 등록 해제 |
| `docs/01_요구사항정의서/` 생성·참조 | sl-init `create_dirs.sh` 등에서 제거 (RD 폴더) |

### 3-2. 🔧 GENESIS 분기만 제거 (RECON/DELTA 동작 보존)
| 파일 | 제거할 것 | 보존할 것 |
|------|----------|----------|
| `skills/sl-init/SKILL.md` (+ `create_dirs.sh`) | MODE 선택의 GENESIS 옵션, 01_요구사항정의서 폴더 | RECON/DELTA 초기화 |
| `agents/rd-agent.md` | GENESIS RD/REQ 생성 경로 | RECON FUNC 생성 경로 |
| `agents/srs-agent.md` | GENESIS 상세화 경로 | RECON SRS 집약 경로 |
| `agents/spec-agent.md` | GENESIS Phase-A/C의 REQ 역합성 | RECON Phase-A(SAD/도메인)·Phase-C(색인) |
| `agents/sad-agent.md` | REQ-NF 참조 | 아키텍처 설계 본문 |
| `agents/ddd-api-agent.md`, `ddd-db-agent.md`, `ddd-ui-agent.md` | 크로스링크 `> GENESIS: **REQ-F:** …` 줄 | `> RECON: **FUNC-ID:** …` 줄 |
| `agents/rtm-agent.md` | REQ→FUNC 매핑, REQ 컬럼 | FUNC 기반 RTM/FUNC_MAP |
| `agents/dev-agent.md`, `test-agent.md` | `linked_req: REQ-F` 주석 삽입 (GENESIS) | `linked_func` 주석 (RECON) |
| `CLAUDE.md` | 라우팅표 sl-genesis행·MODE열 GENESIS, 모드분기, REQ-ID 원칙 섹션, 상황별 파이프라인 GENESIS행, 서브에이전트 GENESIS 모델열 | RECON/DELTA 라우팅·원칙 |
| `skills/sl-recon-doc/SKILL.md` | "spec-agent Phase-C는 GENESIS 전용" 등 GENESIS 언급 | RECON 색인/FUNC/SRS/RTM |
| `skills/sl-recon-uis/SKILL.md`, `sl-rtm`, `sl-test`, `sl-dev`, `sl-change`, `sl-aidd` | `REQ-F`/`linked_req`/GENESIS 분기 표기 | 각 RECON/DELTA/AIDD 동작 |
| `scripts/merge_index.py`, `func_context_bundle.py` | REQ 참조·REQ 섹션 | INF/SCH/UIS/FUNC 처리 |
| `templates/SPEC_CONVENTIONS.md`, `INF/SCH/UIS/RTM/SAD/SRS/TC/TR/API_Design` 템플릿 | `GENESIS:` 분기 줄·`REQ-F` 링크 | `RECON:`/FUNC 링크 |
| `docs/viewer/docsify-sl.js` (SpecLens 가이드) | `GUIDE_PIPELINES`의 GENESIS 파이프라인, `GUIDE_MODES`의 GENESIS 행, REQ 언급 | RECON/DELTA/AIDD 가이드 |
| `README.md`, `docs/SETUP_GUIDE.md` | GENESIS 스킬·파이프라인·REQ 설명 | RECON/DELTA/AIDD |

### 3-3. ✅ 그대로 유지 (B에서 통합 검토)
RECON 전체 · DELTA(sl-analyze/change/quick) · sl-aidd/dev/test/rtm/sprint/drift/context/ia/viewer.

## 4. MODE 개념 정리

- `project.env`의 `MODE`: `GENESIS | RECON | DELTA` → **`RECON | DELTA`** (기본 RECON).
- GENESIS만 분기하던 로직은 RECON 경로로 단일화. RECON vs DELTA 구분은 유지.

## 5. plugin.json description

현행: `"SI/ITO SDD 전주기 자동화 …"` →
**`"SM(운영 시스템) 스펙 역생성 + AIDD 자동화 — 현행 소스에서 INF/SCH/UIS/FUNC 역추출, FUNC-ID 체이닝, 변경관리(SR)."`** (SI/GENESIS 표현 제거)

## 6. 검증 (무결성 게이트)

1. **잔존 0 게이트**: `grep -rn "GENESIS\|REQ-F\|REQ-NF\|요구사항정의서\|RD_v1.0\|RD_template\|linked_req" skills agents scripts templates docs README.md CLAUDE.md` → 이력 노트/변경설명 외 0건.
2. **RECON 보존 게이트**: `rd-agent`/`srs-agent`/`spec-agent`에 RECON 동작 블록이 남아있는지 확인. `RECON_PIPELINE.md` STEP 표의 에이전트/산출물 불변 확인.
3. **plugin.json 정합**: `skills[]`에 sl-genesis 없음 + 나머지 스킬 경로 유효.
4. **스킬 로드 확인**: 삭제 후 남은 스킬 디렉토리 = sl-init/recon/recon-uis/recon-doc/aidd/dev/test/rtm/sprint/drift/context/plan/check/review/quick/analyze/change/ia/viewer.
5. **doc-sync(MUST)**: 본 변경에 CLAUDE.md 버전노트(vX) + plugin.json bump + RECON_PIPELINE/README/SETUP 정합 포함.

## 7. 비범위 (YAGNI / B로 이월)
- 명령어 중복 정리(plan/analyze/change/quick, dev/aidd, check/review 등) → **B**.
- BMAD 기반 AIDD 프로세스 재설계 → **B**.
- 기존 산출물(이미 생성된 RD/REQ 포함 프로젝트)의 마이그레이션 스크립트 → 안 만듦(다음 recon 재생성).
