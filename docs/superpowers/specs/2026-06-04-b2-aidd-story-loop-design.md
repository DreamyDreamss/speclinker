# B2 — AIDD story 루프 (BMAD 차용) 상세 설계서

- 작성일: 2026-06-04
- 상위: `2026-06-04-command-consolidation-design.md` (Sub-project B 비전)
- 범위: `/sl-aidd`를 BMAD story-driven + QA gate 루프로 재구성. `sl-dev`·`sl-check`·`sl-review` 스킬 흡수, `qa-agent` 신규.

## 1. 목표

흩어진 개발 명령(dev/check/review + test 일부)을 **`/sl-aidd` 단일 story 루프**로 통합하고,
BMAD의 두 핵심(**story 파일 = 자기완결 컨텍스트**, **전용 QA 게이트**)을 도입한다.

## 2. 확정 결정
- FUNC = story. RECON 산출물(FUNC_MAP+INF/SCH/UIS) = PRD/아키텍처 대용.
- **사람 승인 루프(BMAD 정석)**: story Draft → **사람 승인** → dev → QA → **사람 확인** → 다음.
- 신규: `agents/qa-agent.md`(독립 컨텍스트 QA 페르소나), `docs/00_FUNC/stories/STORY-{FUNC-ID}.md`(story 파일).
- 스킬 제거: `sl-dev`, `sl-check`, `sl-review`(로직은 루프로 흡수). `sl-test`는 독립 유지(회귀·성능·버그) + TC 실행은 루프 내장.

## 3. story 파일 포맷 — `docs/00_FUNC/stories/STORY-{FUNC-ID}.md`

```markdown
---
story-id: STORY-FUNC-order-001
func-id: FUNC-order-001
status: Draft        # Draft | Approved | InProgress | Review | Done
domain: order
created: YYYY-MM-DD
---

# STORY-FUNC-order-001 — {기능명}

## Story
{화면/기능 한 줄 — 무엇을 구현하는가 (구현 사실 기반)}

## 수용 기준 (Acceptance Criteria)
- [ ] AC1 …
- [ ] AC2 …

## 컨텍스트 (Dev Notes — 자기완결)
> Dev가 다른 문서를 안 읽어도 구현 가능하도록 전 컨텍스트를 담는다.
- **INF**: INF-order-001 (POST /api/order/list) — 요청/응답/비즈니스규칙 요약 + 링크
- **SCH**: SCH-ORD-001 (orders) — 핵심 컬럼/FK 요약 + 링크
- **UIS**: UIS-ORD-001 (주문목록) — 화면 흐름/위젯 요약 + 링크
- **프로젝트 패턴**: project-context.md 발췌 (레이어 구조·네이밍·프레임워크 관례)
- **기존 구현 파일**: (linked-func-cache 기반, 있으면)

## 구현 Task
- [ ] 컨트롤러/핸들러
- [ ] 서비스/비즈니스 로직
- [ ] 데이터 접근 레이어
- [ ] 단위 테스트

## Dev 기록
(dev-agent가 생성 파일·주요 결정 기록)

## QA 결과
(qa-agent가 gate 판정 기록 — 아래 §5)
```

생성기: `scripts/build_story.py` (기존 `func_context_bundle.py` 확장/재사용) — FUNC-ID → story 마크다운.

## 4. story 상태 머신

```
Draft ──(사람 승인)──▶ Approved ──(dev-agent)──▶ InProgress ──(완료)──▶ Review
  ▲                                                                      │
  └──────────────(QA FAIL: 재작업)──────────────────────────────────────┤
                                                  (QA PASS/CONCERNS + 사람 확인) ──▶ Done
```

상태는 story frontmatter + FUNC_MAP + sprint-status.yaml에 동기화.

## 5. `agents/qa-agent.md` — 신규 QA 게이트 (BMAD QA 페르소나)

- **모델**: sonnet (반복 검증). **컨텍스트 분리**: dev-agent와 별개 서브에이전트로 호출(객관성).
- **입력**: story 파일 + 구현 diff/파일 목록 + TO-BE INF 스펙.
- **검증 (구 sl-review 3-Layer 계승):**
  - Layer 1 — 스펙 일치: 구현이 INF 요청/응답/비즈니스규칙과 일치하는가
  - Layer 2 — 보안: 인증/인가/입력검증/주입 취약
  - Layer 3 — 회귀: 기존 동작 깨짐 위험
- **출력 — gate 판정** (story `## QA 결과`에 기록):
  - `PASS` — 통과
  - `CONCERNS` — 경미 이슈(진행 가능, 권고사항 기록)
  - `FAIL` — 차단(필수 수정 목록 → InProgress로 회귀)
- gate 로그: `docs/00_FUNC/stories/STORY-{FUNC-ID}.md` 하단 + 요약은 sprint-status에.

## 6. `/sl-aidd` 통합 루프 (오케스트레이터 스킬)

```
STEP 0  대상 FUNC 결정 (--list / FUNC-ID / 전체 / 미구현만)
선택된 각 FUNC(story)에 대해 순차:
  1. SM      : build_story.py → STORY-{FUNC-ID}.md (status=Draft)
  2. ✋승인   : 사람에게 story 요약 제시 → 승인 받으면 status=Approved (FAIL시 중단)
  3. Dev     : dev-agent(서브) story 구현 (TDD), status=InProgress→Review, Dev기록 갱신
  4. QA      : qa-agent(서브) gate 판정 → QA결과 기록
              FAIL → 수정 목록 제시, ✋사람 확인 후 재작업 또는 중단
              PASS/CONCERNS → 다음
  5. Test    : test-agent(서브) TC 실행 → 결과 기록
  6. ✋확인   : QA/테스트 결과 사람 확인 → status=Done
  7. 상태갱신: FUNC_MAP + sprint-status + linked-func-cache(req_scan)
  → 다음 FUNC
```

흡수 매핑: 구 `sl-check`→STEP 2 스펙게이트, 구 `sl-dev`→STEP 3, 구 `sl-review`→STEP 4(qa-agent).

## 7. 제거/유지
- **제거 스킬**: `skills/sl-dev/`, `skills/sl-check/`, `skills/sl-review/` (+ plugin.json 등록 해제).
- **유지**: `dev-agent`, `test-agent`(재사용), `sl-test`(독립 — 회귀/성능/버그등록), `func_context_bundle.py`(build_story가 재사용 또는 대체).
- 구 sl-dev의 `--pr`(PR 생성)·`--ua-update`(si-graph 갱신)은 `/sl-aidd` 플래그 또는 완료 후 단계로 보존.

## 8. 불변식 (안 깨지게)
- RECON 파이프라인·공유 에이전트(spec/rd/srs/ddd-*/rtm) 무영향.
- `sl-aidd`가 이미 dev-agent/test-agent를 서브로 호출하던 패턴의 확장 — 신규 패러다임 아님.
- 추적 축 = FUNC-ID. story-id는 FUNC-id에 1:1 종속.

## 9. doc-sync (MUST)
CLAUDE.md(라우팅표에서 sl-dev/check/review 제거, sl-aidd 설명 갱신, 서브에이전트표에 qa-agent 추가, 버전노트) + README + SpecLens 가이드(GUIDE_CATEGORIES) + RECON_PIPELINE(해당 없음) + plugin.json(skills 3개 제거 + qa-agent는 agents라 skills 무관) 동반 갱신.

## 10. 검증
- 구 sl-dev/check/review 슬래시 진입점 제거 확인 + plugin.json skills 정합.
- 픽스처 FUNC 1개로 story 생성→(승인)→dev→qa-agent gate→test→Done 전 루프 동작.
- qa-agent gate 3종 판정(PASS/CONCERNS/FAIL) 출력 검증.
- RECON 파이프라인 무영향 grep 게이트.

## 11. 비범위
- BMAD Analyst/PM/Architect/PO 페르소나 — 도입 안 함(RECON 대용).
- 기존 산출물 마이그레이션 — 안 함.
- B1(변경)·B3(추적) — 별도 서브프로젝트.
