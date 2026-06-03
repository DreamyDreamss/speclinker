# SDD Extension 구현 플랜 (BMAD × speclinker)

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.
> **세션 끊김 대비**: TaskList로 현재 상태 확인 후 in_progress 태스크부터 재개.

**Goal:** DESIGN-SL-SDD-001 설계서 기반으로 speclinker에 SDD 파이프라인 전체를 구현한다.  
신규 스킬 7개 + 기존 스킬 강화 3개 + BMAD 차용 템플릿 파일 5개.

**Architecture:** 각 스킬은 `skills/{name}/SKILL.md` 단독 파일. BMAD 차용 파일은 동일 디렉토리에 위치. 기존 에이전트 패턴(STEP 기반 지침) 준수.

**작업 디렉토리:** `D:\gen-harness\plugins\speclinker`

---

## 전체 작업 그룹

| 그룹 | 내용 | 태스크 수 | 우선순위 |
|------|------|---------|---------|
| A | Spec 산출물 템플릿 개선 (INF/SCH/BAT/UIS/FUNC_MAP) | 6 | 선행 |
| B | BMAD 차용 템플릿 파일 생성 | 6 | P1 |
| C | P1 신규 스킬 (sl-context/plan/check/review/sprint) | 5 | P1 |
| D | 기존 스킬 강화 (sl-analyze/change/dev) | 3 | P1 |
| E | P2 신규 스킬 (sl-drift/quick) | 2 | P2 |
| F | 마무리 (CLAUDE.md 라우팅 + plugin.json + 태그) | 3 | 최후 |

---

## GROUP A: Spec 산출물 템플릿 개선

> 상세 내용은 `docs/plans/2026-06-03-spec-template-enhancement.md` 참조.

### A1: ddd-api-agent.md — INF 비즈니스 룰 섹션 추가
- Phase 1 Step 2 끝에 비즈니스 룰 추출 지침 추가
- Phase 2-B 템플릿에 `## 비즈니스 규칙` / `## 트랜잭션 순서` / `## 사이드이펙트` 3개 섹션 삽입 (오류응답 앞)
- Phase 3 Self-Critique에 체크 항목 3개 추가
- 커밋: `feat(template): INF 비즈니스룰·트랜잭션·사이드이펙트 섹션 추가`

### A2: ddd-db-agent.md — SCH 코드값·비즈니스 주의사항 추가
- Phase 3-2 템플릿 `### 인덱스` 뒤에 `### 코드값` 추가 (추출방법 포함)
- Phase 3-2 템플릿 `### 3NF 검증 결과` 앞에 `### 비즈니스 주의사항` 추가
- Phase 4 Self-Critique에 체크 항목 2개 추가
- 커밋: `feat(template): SCH 코드값·비즈니스주의사항 섹션 추가`

### A3: ddd-batch-agent.md — BAT 비즈니스 룰·재처리 방법 추가
- Phase 4 템플릿 `## 오류 처리` 앞에 `## 비즈니스 규칙` 추가
- Phase 4 템플릿 `## 멱등성` → `## 재처리 방법` (4행 표 형식으로 교체)
- Phase 5 Self-Critique에 체크 항목 2개 추가
- 커밋: `feat(template): BAT 비즈니스룰·재처리방법 섹션 추가`

### A4: ddd-ui-agent.md — UIS frontmatter apis/related-screens 추가
- spec.md frontmatter에 `apis:` / `related-screens:` 필드 추가
- §5 인터랙션 → apis 자동 추출, §7 화면전환 → related-screens 자동 추출
- Self-Critique 체크 항목 2개 추가
- 커밋: `feat(template): UIS frontmatter apis/related-screens 추가`

### A5: rtm-agent.md — FUNC_MAP BAT 컬럼 추가
- Phase 0-R R-2 FUNC_MAP 헤더에 `BAT` 컬럼 삽입 (INF 뒤)
- 배치 전용 FUNC 표기 규칙 추가
- 커밋: `feat(template): FUNC_MAP BAT 컬럼 추가`

### A6: 버전 v2.50 커밋
- plugin.json version `2.49.0` → `2.50.0`
- CLAUDE.md 버전 노트 추가
- 커밋 + 푸시

---

## GROUP B: BMAD 차용 템플릿 파일 생성

### B1: THIRD_PARTY_NOTICES.md 생성
**경로:** `THIRD_PARTY_NOTICES.md` (루트)

```markdown
# Third-Party Notices

## BMAD-METHOD
- **License**: MIT
- **Copyright**: © BMad Code, LLC
- **Source**: https://github.com/bmadcode/BMAD-METHOD (v6.8.0)
- **Used in**: skills/sl-context/, skills/sl-dev/, skills/sl-sprint/,
              skills/sl-quick/, skills/sl-check/
- **Modifications**: RECON 귀납 패턴 섹션, linked_func 주석,
                    FUNC_MAP 연동 필드, INF 링크 필드 추가
```

커밋: `chore: BMAD MIT 라이선스 고지 추가`

### B2: project-context-template.md 생성
**경로:** `skills/sl-context/project-context-template.md`

BMAD `project-context-template.md` 구조 기반. 추가 섹션:
- `## RECON 귀납 패턴` (API 구조/인증/에러/페이징 패턴)
- `## speclinker 연동 정보` (framework_detected, inf_count, last_recon)
수동 수정 금지 섹션 명시.

### B3: dod-checklist.md 생성
**경로:** `skills/sl-dev/dod-checklist.md`

BMAD `checklist.md` (Definition of Done) 구조 기반. 추가 섹션:
```markdown
## speclinker 스펙 연동
- [ ] linked_func 주석 삽입됨 (`// linked_func: FUNC-{domain}-{NNN}`)
- [ ] TO-BE INF의 모든 AC(Acceptance Criteria) 충족됨
- [ ] INF 파일 업데이트됨 (스펙 변경이 있는 경우)
- [ ] sprint-status.yaml: in-progress → review 상태로 업데이트
```

### B4: sprint-status-template.yaml 생성
**경로:** `skills/sl-sprint/sprint-status-template.yaml`

BMAD `sprint-status-template.yaml` 구조 기반. 수정:
```yaml
generated: {date}
project: {project_name}
framework: {감지된 프레임워크}       # speclinker 추가
last_recon: {최종 RECON 날짜}        # speclinker 추가

development_status:
  {domain}:                          # FUNC_MAP 도메인 구조 반영
    {FUNC-ID}: backlog | ready-for-dev | in-progress | review | done
    # linked_sr: SR-{ID}            # 연결된 SR (있는 경우)
```

### B5: spec-template.md 생성
**경로:** `skills/sl-quick/spec-template.md`

BMAD `spec-template.md` (quick-dev) 기반. 추가 섹션:
```markdown
## speclinker 연동
linked_inf: [INF-XXX-000]     # 영향받는 INF 파일
근거_소스: []                  # 수정할 소스 파일 경로
변경_이력: inline             # SR 없이 INF 하단 변경이력 섹션에 기록
```

### B6: readiness-report-template.md 생성
**경로:** `skills/sl-check/readiness-report-template.md`

BMAD `readiness-report-template.md` 기반. 검증 항목을 INF/UIS/SCH 기준으로 교체:
```markdown
# 구현 준비 검증 보고서

## 공통 게이트
- [ ] [TBD] 없음 (INF/UIS/SCH 전체)
- [ ] 승인 토큰 존재 (.speclinker/approved/{SR-ID}.lock)

## INF 검증
- [ ] 요청 파라미터 타입·필수여부 정의됨
- [ ] 응답 구조 정의됨 (빈 {} 금지)
- [ ] 에러 응답 정의됨

## UIS 검증 (해당 시)
- [ ] 화면 흐름 정의됨
- [ ] 연결 INF 링크 존재

## SCH 검증 (변경 시)
- [ ] 컬럼 타입·제약 정의됨

## 결과
PASS / FAIL — {미완성 항목 수}건
```

커밋 (B1~B6 일괄): `feat(bmad): BMAD 차용 템플릿 파일 5종 + 라이선스 고지`

---

## GROUP C: P1 신규 스킬

### C1: skills/sl-context/SKILL.md 생성

**목적:** RECON 결과 + 소스코드 샘플 → `docs/project-context.md` 자동 생성

```
STEP 1 — 사전 확인
  project.env 읽기 (FRAMEWORK 힌트)
  project-context.md 이미 존재하면 --update 플래그 없으면 사용자 확인

STEP 2 — 프레임워크 감지 (설계서 §3 로직)
  1순위: project.env FRAMEWORK=
  2순위: 루트 파일 스캔 (package.json/pom.xml/requirements.txt/go.mod 등)
  3순위: INF 파일 근거소스 확장자

STEP 3 — INF 패턴 수집
  !ls docs/05_설계서/*/INF/INF-*.md | head -20
  대표 INF 5~10개 Read
  공통 패턴 추출:
    - 요청 파라미터 구조 (페이징 방식 등)
    - 응답 JSON 구조
    - 에러 처리 방식
    - 인증/권한 패턴

STEP 4 — 소스 샘플링
  각 INF의 '근거 소스' 경로에서 대표 파일 5개 Read
  프레임워크별 관용 패턴 식별

STEP 5 — project-context.md 생성
  project-context-template.md 기반
  감지된 정보로 채움
  저장: docs/project-context.md
```

CLAUDE.md 라우팅: `/sl-context` → `skills/sl-context/SKILL.md`

### C2: skills/sl-plan/SKILL.md 생성

**목적:** 기획서/변경요청 → 영향 INF/UIS/SCH 자동 식별 + 변경 규모 분류

```
STEP 1 — 입력 파싱
  파일 경로면 Read, 텍스트면 그대로
  키워드 추출: 화면명, 기능 설명(동사+목적어), 데이터 항목명

STEP 2 — RECON 스펙 자동 매핑
  INF: !grep -rl "{키워드}" docs/05_설계서/*/INF/
  UIS: !grep -rl "{키워드}" docs/05_설계서/*/UI/ --include="spec.md"
  SCH: !grep -rl "{키워드}" docs/05_설계서/ --include="DB_*.md"
  매핑 결과 수집

STEP 3 — 변경 규모 분류
  Minor:    INF 1-2개, SCH 변경 없음
  Moderate: INF 3개+ OR SCH 컬럼 추가
  Major:    신규 도메인 OR SCH 테이블 추가 OR 아키텍처 변경

STEP 4 — 영향 리포트 생성
  docs/변경관리/{SR-ID}/00_영향분석_초안.md 저장
  설계서 §4-2 출력 형식으로 보고
  다음 단계: /sl-analyze 안내
```

CLAUDE.md 라우팅: `/sl-plan {파일|텍스트}` → `skills/sl-plan/SKILL.md`

### C3: skills/sl-check/SKILL.md 생성

**목적:** /sl-dev 진입 전 TO-BE 스펙 완전성 + 승인 토큰 범용 검증

```
STEP 1 — 입력 파악
  SR-ID 또는 FUNC-ID 또는 --all 플래그

STEP 2 — 승인 토큰 확인
  !ls .speclinker/approved/{SR-ID}.lock 2>/dev/null
  없으면 FAIL + "/sl-change 먼저 실행" 안내

STEP 3 — INF 파일 검증
  해당 SR/FUNC 연결 INF 파일 목록 확인
  각 INF:
    [TBD] 항목 없는지 grep
    요청 파라미터 표 존재 여부
    응답 구조 빈 {} 아닌지
    에러 응답 표 존재 여부

STEP 4 — UIS/SCH 검증 (해당 시)
  UIS: 화면 흐름, INF 링크 존재 여부
  SCH: 컬럼 타입·제약 정의 여부

STEP 5 — 결과 출력
  readiness-report-template.md 형식으로 출력
  PASS → "/sl-dev 진행 가능"
  FAIL → 미완성 항목 목록 + 수정 안내
```

### C4: skills/sl-review/SKILL.md 생성

**목적:** 생성 코드 ↔ TO-BE INF 스펙 3-Layer 범용 검증

```
STEP 1 — 입력 파악
  SR-ID 또는 FUNC-ID
  TO-BE INF 파일 경로 결정
    docs/변경관리/{SR-ID}/after/INF-*.md 있으면 사용
    없으면 현행 docs/05_설계서/ INF 사용

STEP 2 — Layer 1: 스펙 감사
  TO-BE INF 요청 파라미터 ↔ 실제 코드 파라미터 비교
  응답 JSON 구조 ↔ 실제 반환 구조 비교
  URL/경로 일치 여부
  에러 응답 처리 일치 여부
  결함: [CRITICAL] / [HIGH] / [MEDIUM] / [LOW] 분류

STEP 3 — Layer 2: 보안 감사
  docs/project-context.md 로드 (없으면 경고 후 기본 패턴으로)
  인증/권한 체크 누락 여부
  입력값 검증 누락 여부
  민감 데이터 노출 여부

STEP 4 — Layer 3: 회귀 감시
  변경되지 않은 INF 파일 중 관련 테이블 공유하는 것 확인
  공통 모듈 변경 파급 효과 검토
  SCH 변경 → 기존 쿼리 영향 여부

STEP 5 — 리뷰 보고서 저장
  docs/변경관리/{SR-ID}/review_{날짜}.md
  CRITICAL 없음 → sprint-status: review → done 안내
  CRITICAL 있음 → /sl-dev 복귀 안내
```

### C5: skills/sl-sprint/SKILL.md 생성

**목적:** FUNC_MAP → sprint-status.yaml 상태 추적 + 대시보드

```
STEP 1 — 모드 확인
  인자 없음: sprint-status.yaml 생성/갱신
  --status: 현재 진행 대시보드
  --next: 다음 구현 FUNC 추천

[생성/갱신 모드]
STEP 2 — FUNC_MAP 읽기
  docs/00_FUNC/FUNC_MAP.md grep FUNC- 행 파싱
  도메인별 FUNC-ID 목록 수집

STEP 3 — 기존 상태 보존
  .speclinker/sprint-status.yaml 존재하면 기존 상태 로드
  새 FUNC는 backlog으로 추가, 기존 상태는 유지

STEP 4 — sprint-status.yaml 저장
  sprint-status-template.yaml 형식으로
  .speclinker/sprint-status.yaml 저장

[대시보드 모드]
STEP 5 — 통계 출력
  상태별 건수 + 진행률
  설계서 §4-9 출력 형식
```

---

## GROUP D: 기존 스킬 강화

### D1: sl-analyze/SKILL.md 강화

현재 SKILL.md에서 변경 사항:
- SR-ID 디렉토리 생성: `docs/변경관리/{SR-ID}/`
- **Before 스냅샷**: 영향 INF/UIS 파일을 `before/` 디렉토리에 복사
- **After 초안**: AI가 변경 내용 반영한 초안을 `after/` 디렉토리에 생성
- **Diff 뷰**: `01_스펙변경_diff.md` (+ 추가 / - 제거 / ~ 변경 형식)
- 영향 체인: INF→UIS, INF→SCH, RTM 연결 REQ/SRS 추적

### D2: sl-change/SKILL.md 강화

현재 SKILL.md에서 변경 사항:
- `/sl-analyze` 결과 로드 (`docs/변경관리/{SR-ID}/after/` 확인)
- `after/` 초안이 있으면 사용자에게 TO-BE 스펙 검토 요청
- 승인 시에만: `after/` → 실제 스펙 경로 반영
- **승인 토큰 생성**: `.speclinker/approved/{SR-ID}.lock` 파일 생성
- **sprint-status.yaml 업데이트**: 해당 FUNC → `ready-for-dev`
- Spec-First 강제 규칙 문서화

### D3: sl-dev/SKILL.md 강화

현재 SKILL.md에서 변경 사항:
- **STEP 0 사전 확인 추가**:
  - `docs/project-context.md` 없으면 `/sl-context 먼저 실행` 권고
  - `.speclinker/approved/{SR-ID}.lock` 없으면 `/sl-change 먼저 실행` 권고
  - (단, `/sl-quick` 경유 시 예외)
- **STEP 1 컨텍스트 로드**:
  - `docs/project-context.md` Read
  - TO-BE INF (`after/` 또는 현행)
- **TDD 루프 추가 (STEP 2~4)**:
  - RED: 프레임워크별 실패 테스트 작성 (JUnit/pytest/Jest)
  - GREEN: 최소 구현
  - REFACTOR: project-context.md 패턴 준수
- **DoD 체크리스트**: `skills/sl-dev/dod-checklist.md` 참조
- **sprint-status 업데이트**: `in-progress → review`

---

## GROUP E: P2 신규 스킬

### E1: skills/sl-drift/SKILL.md 생성

**목적:** INF 근거소스 기반 스펙-코드 드리프트 자동 감지

```
STEP 1 — 변경 파일 탐색
  git log --since={기간} --name-only --format=""
  (기간: 기본 30일, --since 인자로 변경 가능)
  변경된 소스 파일 목록 수집

STEP 2 — INF 근거소스 매핑
  !grep -r "근거 소스" docs/05_설계서/*/INF/*.md
  각 INF의 근거소스 파일 경로 추출
  변경 파일 ↔ INF 근거소스 매핑

STEP 3 — 드리프트 판정
  매핑된 INF가 있고 INF 수정일 < 소스 수정일이면 DRIFT
  변경 파일에 새 라우트 추가됐는데 대응 INF 없으면 NEW
  나머지: OK

STEP 4 — 보고서 출력
  설계서 §4-8 출력 형식으로 보고
  DRIFT → "/sl-change로 스펙 업데이트 필요"
  NEW → "/sl-recon --single 실행 권장"
```

### E2: skills/sl-quick/SKILL.md 생성

**목적:** 소규모 변경 전용 경량 경로 (SR 없이 빠르게)

```
STEP 1 — 스코프 확인
  단일 목표, INF 1-2개, SCH 변경 없음 검증
  초과 시 "/sl-plan 사용 권장" 안내

STEP 2 — 영향 INF 탐색
  변경 설명에서 키워드 추출
  !grep -rl "{키워드}" docs/05_설계서/*/INF/

STEP 3 — 인라인 스펙 변경 기록
  spec-template.md 형식으로 인라인 기록 (별도 SR 문서 없음)
  영향 INF 파일 하단에 `## 변경 이력` 섹션 추가

STEP 4 — project-context.md 로드
  docs/project-context.md Read

STEP 5 — TDD 구현
  RED: 실패 테스트 작성
  GREEN: 최소 구현
  REFACTOR

STEP 6 — /sl-review --quick
  Layer 1만 실행 (스펙 감사)

STEP 7 — INF 업데이트
  변경 내용을 INF에 반영
```

---

## GROUP F: 마무리

### F1: CLAUDE.md 라우팅 업데이트

커맨드 라우팅 표에 신규 스킬 추가:
```
| `/sl-context` | `skills/sl-context/SKILL.md` | project.env, docs/05_설계서/ INF 존재 | RECON 후 |
| `/sl-plan` | `skills/sl-plan/SKILL.md` | project.env, docs/05_설계서/ | SDD |
| `/sl-check` | `skills/sl-check/SKILL.md` | .speclinker/approved/ or FUNC_MAP | SDD |
| `/sl-review` | `skills/sl-review/SKILL.md` | TO-BE INF, 소스코드 | SDD |
| `/sl-sprint` | `skills/sl-sprint/SKILL.md` | docs/00_FUNC/FUNC_MAP.md | SDD |
| `/sl-drift` | `skills/sl-drift/SKILL.md` | git 저장소, INF 근거소스 | SDD 유지 |
| `/sl-quick` | `skills/sl-quick/SKILL.md` | docs/05_설계서/ INF, project-context.md | SDD 경량 |
```

### F2: plugin.json 업데이트

- version: `2.50.0` → `2.51.0`
- skills 배열에 신규 스킬 7개 추가:
  `./skills/sl-context`, `./skills/sl-plan`, `./skills/sl-check`,
  `./skills/sl-review`, `./skills/sl-sprint`, `./skills/sl-drift`,
  `./skills/sl-quick`

### F3: 최종 커밋 + 태그

```bash
git add -A
git commit -m "feat(sdd): SDD 파이프라인 전체 구현 — sl-context/plan/check/review/sprint/drift/quick (v2.51.0)"
git tag v2.51.0
git push origin main --tags
```

---

## 진행 현황 (세션별 업데이트)

| 태스크 | 상태 | 완료일 |
|--------|------|--------|
| A1 INF 비즈니스 룰 | ⬜ | |
| A2 SCH 코드값 | ⬜ | |
| A3 BAT 비즈니스 룰 | ⬜ | |
| A4 UIS frontmatter | ⬜ | |
| A5 FUNC_MAP BAT 컬럼 | ⬜ | |
| A6 v2.50 버전 업 | ⬜ | |
| B1 THIRD_PARTY_NOTICES | ⬜ | |
| B2 project-context-template | ⬜ | |
| B3 dod-checklist | ⬜ | |
| B4 sprint-status-template | ⬜ | |
| B5 spec-template | ⬜ | |
| B6 readiness-report-template | ⬜ | |
| C1 sl-context SKILL | ⬜ | |
| C2 sl-plan SKILL | ⬜ | |
| C3 sl-check SKILL | ⬜ | |
| C4 sl-review SKILL | ⬜ | |
| C5 sl-sprint SKILL | ⬜ | |
| D1 sl-analyze 강화 | ⬜ | |
| D2 sl-change 강화 | ⬜ | |
| D3 sl-dev 강화 | ⬜ | |
| E1 sl-drift SKILL | ⬜ | |
| E2 sl-quick SKILL | ⬜ | |
| F1 CLAUDE.md 라우팅 | ⬜ | |
| F2 plugin.json 업데이트 | ⬜ | |
| F3 최종 커밋 + 태그 | ⬜ | |
