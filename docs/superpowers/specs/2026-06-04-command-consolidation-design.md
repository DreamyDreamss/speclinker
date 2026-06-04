# 명령어 통합 + BMAD-AIDD 재설계 — 설계서 (Sub-project B)

- 작성일: 2026-06-04
- 대상: speclinker 플러그인 (v3.0.0 SM 전용 기반 위)
- 선행: Sub-project A(GENESIS 제거) 완료

## 1. 배경 / 목표

RECON 외 명령어(14개)가 기능 중복으로 뒤죽박죽이고, AIDD가 BMAD 수준의 story-driven + QA gate
구조에 못 미친다. **RECON 계열은 유지**하고, 나머지를 **한 방향으로 통합** + **BMAD 핵심 차용**한다.

## 2. 확정 결정 (브레인스토밍 Q1~Q4 + 에이전트 구조)

- **Q1 — BMAD 깊이:** 핵심 차용. **story-driven + QA gate.** FUNC=story, RECON=PRD/아키텍처 대용. 명령어는 간결.
- **Q2 — 변경 통합:** **`/sl-change` 단일 + `--quick`/`--full`.** plan·analyze·quick 흡수. CIA는 change의 산출 단계.
- **Q3 — 개발 루프:** **`/sl-aidd` 단일 story 루프**(check→dev→QA→test→상태) + **전용 qa-agent** + **FUNC별 story 파일** 둘 다.
- **Q4 — 추적 통합:** **`/sl-status`** = rtm+sprint(커버리지+진행+갭). **drift 별도**(스펙 신선도).
- **구조 원칙:** 없애는 건 **스킬(슬래시 진입점)**. **에이전트는 유지·재사용**하며 통합 오케스트레이터가 서브에이전트로 호출. (지금도 sl-aidd가 dev-agent/test-agent를 서브로 부름 — 그 패턴의 정리)

## 3. 목표 명령어 맵 (19 → ~12)

| 분류 | 통합 후 (유지/신규) | 흡수·제거되는 스킬 |
|------|--------------------|--------------------|
| 현행화(RECON) | `sl-init` `sl-recon` `sl-recon-uis` `sl-recon-doc` `sl-context` `sl-ia` `sl-viewer` | — (유지) |
| 변경(DELTA) | **`sl-change`** (`--quick`/`--full`) | `sl-plan` `sl-analyze` `sl-quick` |
| 개발(AIDD) | **`sl-aidd`** (story 루프) | `sl-dev` `sl-check` `sl-review` |
| 추적 | **`sl-status`** · `sl-drift` | `sl-rtm` `sl-sprint` |
| 테스트 | `sl-test` (회귀·성능·버그등록 독립 실행만) | (TC 실행은 aidd 루프에 내장) |

**제거 스킬 8개**: plan, analyze, quick, dev, check, review, rtm, sprint.
**신규 에이전트 1개**: `qa-agent`. **신규 스킬 1개**: `sl-status`(rtm+sprint 통합).

## 4. B2 — `/sl-aidd` BMAD story 루프 (핵심)

선택된 FUNC(=story) 각각에 대해:

```
1. SM 단계   : story 파일 작성 → docs/00_FUNC/stories/STORY-{FUNC-ID}.md
               (func_context_bundle 확장: 수용기준 + INF/SCH/UIS 컨텍스트 + 구현노트 + task 체크리스트)
2. 스펙게이트 : story 완전성 + 승인토큰 확인        (구 sl-check 로직 → 루프 단계)
3. Dev       : dev-agent 가 story 구현 (TDD)        (기존 dev-agent, 서브)
4. QA 게이트 : ★qa-agent★ 독립 컨텍스트 3-Layer 검증 (구 sl-review → 신규 서브에이전트)
               판정 PASS / CONCERNS / FAIL → story 하단 gate 기록
5. 테스트    : test-agent TC 실행                    (기존 test-agent, 서브)
6. 상태갱신  : FUNC_MAP + sprint-status + story 상태(Draft→Approved→InProgress→Review→Done)
```

**신규 산출물:**
- `agents/qa-agent.md` — dev와 컨텍스트 분리된 QA 페르소나. 입력=story 파일+구현 diff, 출력=gate 판정.
- `docs/00_FUNC/stories/STORY-{FUNC-ID}.md` — BMAD story 파일. 자기완결 컨텍스트(Dev가 다른 문서 안 읽어도 구현 가능).
- story 상태 머신: Draft → Approved → InProgress → Review → Done(+gate).

**story 파일 생성기:** `func_context_bundle.py`를 확장하거나 신규 `build_story.py`로 story 마크다운 산출.

## 5. B1 — `/sl-change` 통합 (변경)

내부 단계: SR 수집·분류 → 영향분석/CIA(구 analyze) → TO-BE 설계 → 스펙 동기화 → FUNC_MAP/RTM 갱신.
- `--quick`: 소규모(구 sl-quick) — SR 없이 인라인 스펙 + 경량 게이트.
- `--full`: 전주기(구 change + analyze CIA 산출물).
- `sl-plan`의 경량 영향-리포트는 `--quick`의 1단계(영향 미리보기)로 흡수.

## 6. B3 — `/sl-status` 통합 (추적)

`sl-rtm`(커버리지·갭) + `sl-sprint`(진행상태·대시보드)를 단일 명령으로. 플래그: `--coverage`/`--next`/`--publish`.
FUNC_MAP + sprint-status.yaml + story gate 상태를 한 뷰로. `sl-drift`는 독립 유지.

## 7. 불변식 (절대 보존)
- **RECON 파이프라인 전체** (sl-init/recon/recon-uis/recon-doc) 무영향.
- 공유 에이전트(spec/rd/srs/sad/ddd-*/rtm/dev/test) 동작 보존 — 재사용만.
- 추적 축 = FUNC-ID + SR (A에서 확정). story/gate는 FUNC-ID에 종속.
- DELTA의 `REQ-C` 운명은 B1에서 결정(SR 단일화 vs 2단 유지) — A에서 이월된 기획검토 항목.

## 8. 구현 분해 (각각 독립 동작·테스트 가능)
- **B1. 변경 통합** — sl-change가 plan/analyze/quick 흡수 (+REQ-C 결정). 중간 규모.
- **B2. AIDD story 루프** — qa-agent + story 파일 + dev/check/review/test 통합. 최대·핵심.
- **B3. 추적 통합** — sl-status가 rtm/sprint 흡수. 소규모.

각 서브프로젝트는 자체 spec → plan → 실행. doc-sync(MUST) 규칙 준수(CLAUDE.md 라우팅·README·RECON_PIPELINE 등 동반 갱신 + 버전 노트).

## 9. 비범위 (YAGNI)
- BMAD 전체 페르소나 6종(Analyst/PM/Architect/PO) 도입 — 안 함(RECON이 그 역할 대용). QA만 신규.
- 기존 산출물 마이그레이션 스크립트 — 안 함.
