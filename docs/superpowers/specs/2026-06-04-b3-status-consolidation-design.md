# B3 — /sl-status 통합 (추적) 상세 설계서

- 작성일: 2026-06-04
- 상위: `2026-06-04-command-consolidation-design.md` (Sub-project B 비전 §6)
- 범위: `sl-rtm` + `sl-sprint`를 신규 `/sl-status` 단일 명령으로 통합. `sl-drift`는 독립 유지.

## 1. 목표

추적/현황 명령(커버리지·갭=rtm, 진행상태·추천=sprint)이 둘 다 FUNC_MAP + sprint-status.yaml를 축으로 동작해
중복된다. 이를 **`/sl-status` 단일 명령 + 플래그**로 통합해 "한 뷰에서 커버리지+진행+갭"을 본다.

## 2. 확정 결정 (비전 §6)
- **`/sl-status`** = `sl-rtm`(커버리지·갭·게시) + `sl-sprint`(진행상태·추천·sprint-status 생성/갱신) 통합.
- 플래그: `--coverage`(RTM 커버리지+갭) · `--next`(다음 작업 추천) · `--publish`(Confluence 게시). 무플래그=통합 대시보드.
- **`sl-drift` 독립 유지**(스펙-코드 신선도는 별개 관심사).
- **에이전트 보존**: `rtm-agent`(RECON doc 파이프라인 소속, sl-rtm 스킬과 무관)는 삭제하지 않는다.
- 스킬 제거: `skills/sl-rtm/`, `skills/sl-sprint/`.
- 산출물 보존: `sprint-status.yaml`, `sl-sprint/sprint-status-template.yaml`(→ sl-status가 사용). RTM 파일(docs/02_추적표/RTM_v*.md) 형식 무변경.

## 3. 명령 구조

| 형식 | 용도 | 흡수 출처 |
|------|------|----------|
| `/sl-status` | 통합 대시보드 — 커버리지 + 진행상태 + 갭 요약 | rtm 기본 + sprint --status |
| `/sl-status --coverage` | RTM 커버리지 재계산 + 갭 리포트 | 구 sl-rtm `--func`+`--gap` |
| `/sl-status --next` | 다음 작업 추천 | 구 sl-sprint `--next` |
| `/sl-status --publish` | Confluence 게시 | 구 sl-rtm `--publish` |

`sprint-status.yaml` 생성/갱신(구 sl-sprint 생성모드 STEP 1~3)은 `/sl-status` 실행 시 내부적으로 선행 수행(없으면 생성, 있으면 갱신·기존 상태 보존).

## 4. /sl-status 내부 구성

```
STEP 0  전제 확인 (docs/00_FUNC/FUNC_MAP.md 존재)
STEP 1  sprint-status.yaml 생성/갱신 (구 sprint STEP 1~3: FUNC_MAP 파싱 → 기존 상태 보존 → 저장)
STEP 2  분기:
        (무플래그)   → 통합 대시보드: 커버리지 % + 상태별 카운트 + 갭 요약
        --coverage  → RTM 커버리지 재계산(구 rtm --func) + 갭 리포트(구 rtm --gap)
        --next      → 다음 작업 추천(구 sprint --next)
        --publish   → Confluence 게시(구 rtm --publish, NETWORK=open 필요)
```

## 5. 제거/유지
- **제거 스킬**: `sl-rtm`, `sl-sprint`.
- **유지**: `sl-drift`(독립), `rtm-agent`(RECON doc), `sprint-status-template.yaml`, RTM 파일 형식.
- rtm/sprint의 커버리지·갭·대시보드·추천·게시 로직은 sl-status 내부 단계로 **흡수**(삭제 아님).

## 6. doc-sync (MUST)
- `CLAUDE.md`: 라우팅표에서 sl-rtm/sl-sprint 2행 제거 + sl-status 1행 추가, 상황별 파이프라인표(sl-sprint 등장)·AIDD 완료안내의 대시보드 안내 교정, 버전노트 v3.3.0.
- `README.md`: 스킬 트리에서 2개 제거 + sl-status 추가, 파이프라인 교정.
- `docs/viewer/docsify-sl.js`: GUIDE_PIPELINES(sl-sprint 등장 체인) + GUIDE_CATEGORIES(sl-sprint·sl-rtm 줄 → sl-status), GUIDE_VERSION bump.
- `.claude-plugin/plugin.json`: skills 2개 제거(13→12) + sl-status 1개 추가 = **12**, version 3.3.0.
- 다음-포인터: 다른 스킬에서 `/sl-rtm`·`/sl-sprint`를 "다음/시작/대시보드" 안내하는 문구 → `/sl-status`로 교정 (sl-aidd 완료안내, sl-change 등).
- `scripts/README.md`: rtm/sprint 전용 스크립트의 "사용 STEP"이 있으면 sl-status로 재배선.

## 7. 불변식 (절대 보존)
- RECON 파이프라인·AIDD(B2)·DELTA(B1: sl-change) 무영향.
- `rtm-agent` 동작 보존(삭제 금지). `sprint-status.yaml` 스키마·RTM 파일 형식 무변경.
- 추적 축 = FUNC-ID(RECON) + SR(DELTA). 표시 도구만 통합.

## 8. 검증
- 구 sl-rtm/sl-sprint 슬래시 진입점 제거 + plugin.json skills 정합(12개, sl-status 등록).
- `/sl-status`의 4경로(무플래그/--coverage/--next/--publish) SKILL 내 단계 존재.
- 잔존 grep: `/sl-rtm`·`/sl-sprint` 진입점/다음-포인터 0(허용: 역사적 버전노트, rtm-agent·sprint-status 파일명).
- RECON·AIDD·DELTA 무영향 grep 게이트.

## 9. 비범위
- 신규 스크립트 — 없음(기존 rtm/sprint 스크립트·로직 재배선만).
- RTM/sprint-status 산출물 형식 변경 — 없음.
- sl-drift 통합 — 안 함(독립 유지).
