# B1 — /sl-change 통합 (변경관리) 상세 설계서

- 작성일: 2026-06-04
- 상위: `2026-06-04-command-consolidation-design.md` (Sub-project B 비전 §5)
- 범위: `/sl-change`를 DELTA 단일 명령으로 통합. `sl-plan`·`sl-analyze`·`sl-quick` 흡수·삭제. REQ-C/RD_v 폐기(SR 단일축).

## 1. 목표

흩어진 변경관리 명령(plan/analyze/quick + change)을 **`/sl-change` 단일 + `--quick`/`--full`**로 통합하고,
DELTA 추적 축을 **SR 단일화**(REQ-C·RD_v 제거)하여 A에서 확정한 "추적 축 = FUNC-ID(RECON) + SR(DELTA)"와 일관성을 맞춘다.

## 2. 확정 결정
- **SR 단일화** (기획 검토 확정): REQ-C 폐기. SR-ID가 유일한 변경 추적 축. RTM은 SR→INF/SCH/UIS 직접 매핑.
  대부분 SM 변경은 SR=요구사항 1:1이라 2단(SR→REQ-C)은 과함. RD_v 복사 관리도 제거.
- **명령 통합**: `/sl-change` 단일 진입점 + 모드 플래그. analyze의 CIA는 `--full`의 산출 단계로 흡수, quick은 `--quick` 경로, plan의 경량 영향-리포트는 `--quick`의 1단계로 흡수.
- **스킬 제거**: `skills/sl-plan/`, `skills/sl-analyze/`, `skills/sl-quick/` (3개, plugin.json 등록 해제).

## 3. 명령 구조

| 형식 | 용도 | 흡수 출처 |
|------|------|----------|
| `/sl-change <SR-ID>` | `--full` 기본 — SR 전주기(CIA→TO-BE→동기화→RTM) | 구 change + analyze |
| `/sl-change --full <SR-ID>` | 명시적 전주기 | 동일 |
| `/sl-change --quick "설명"` | SR 없이 소규모 경량 변경 | 구 quick + plan(경량 리포트) |
| `/sl-change --new <SR-ID>` | 로컬 SR 요구사항 작성(현행 유지) | 구 change --new |

## 4. `--full` 내부 단계 (analyze CIA 흡수)

```
STEP 0  전제 확인 (project.env, docs/05_설계서/, SR 입력)
STEP 1  SR 수집 (Jira NETWORK=open / 로컬 파일)
STEP 2  영향분석/CIA (구 analyze) — AS-IS 분석 + 영향 INF/SCH/UIS 식별
                                  + Before 스냅샷 + After 초안 자동 생성
STEP 3  TO-BE 스펙 설계 (변경명세 + before/after diff)
STEP 4  스펙 동기화 (docs/05_설계서/ 현행화)
STEP 5  FUNC_MAP/RTM 갱신 — SR→INF/SCH/UIS 직접 매핑 (REQ-C 없음)
STEP 6  승인 토큰 (.speclinker/approved/{SR-ID}.lock)
        → 다음: /sl-aidd {SR-ID}
```

CIA 산출물 경로/형식은 구 analyze의 변경영향분석서를 유지하되 **"STEP 6 REQ-C 생성" 단계 삭제**.

## 5. `--quick` 내부 단계 (구 quick + plan 경량)

```
STEP 1  스코프 확인 (INF ≤ 2 권장, 초과 시 --full 안내)
STEP 2  영향 미리보기 (구 plan: 키워드→스펙 매핑·변경 규모 분류)
STEP 3  인라인 스펙 기록 (영향 INF에 변경점 직접 반영)
STEP 4  project-context.md 로드
STEP 5  TDD 구현 (linked_func 주석)
STEP 6  경량 게이트 (Layer 1 스펙 일치만)
STEP 7  완료 보고
```

## 6. REQ-C / RD_v 제거 (SR 단일축)

- **sl-change**: "REQ-C 매핑" 블록 삭제, `RD_v{X.Y}.md` 복사/갱신 단계 삭제.
- **RTM 행**: `| SR-1234 | REQ-C-001 | TYPE | ... |` → `| SR-1234 | TYPE | ... |` (REQ-C 열 제거).
- **analyze CIA**: "REQ-C 생성" 섹션 삭제. 변경 요구사항은 SR-ID 하위 항목(불릿)으로만 기술.
- rtm-agent/rtm 스킬에 REQ-C 열 참조가 있으면 동반 제거(확인 후).

## 7. 제거/유지
- **제거 스킬**: `sl-plan`, `sl-analyze`, `sl-quick`.
- **유지**: `sl-change`(통합), `sl-drift`(독립), `sl-test`(독립), `sl-aidd`(B2), RECON 계열.
- analyze의 CIA 산출 로직·plan의 매핑 로직·quick의 인라인 로직은 sl-change 내부 단계로 **흡수**(삭제 아님).

## 8. doc-sync (MUST)
- `CLAUDE.md`: 라우팅표에서 sl-plan/sl-analyze/sl-quick 3행 제거, sl-change 행 갱신(--quick/--full), 상황별 파이프라인표(SDD/DELTA 행)에서 plan/analyze/quick→sl-change 교정, REQ-C 언급 정리, 버전노트 v3.2.0.
- `README.md`: 스킬 트리에서 3개 제거, sl-change 설명 갱신, 파이프라인 교정.
- `docs/viewer/docsify-sl.js`: GUIDE_PIPELINES(DELTA/SDD 체인) + GUIDE_CATEGORIES(SDD 파이프라인 카테고리의 sl-plan, 변경관리 카테고리)에서 3개 제거·sl-change 갱신, GUIDE_VERSION bump.
- `.claude-plugin/plugin.json`: skills 3개 제거(16→13), version 3.2.0.
- 다음-포인터: 다른 스킬에서 `/sl-plan`·`/sl-analyze`·`/sl-quick`를 "다음/시작" 안내하는 문구 → `/sl-change`로 교정.
- `scripts/README.md`: plan/analyze/quick 전용 스크립트가 있으면 사용 STEP 재배선.

## 9. 불변식 (절대 보존)
- RECON 파이프라인(sl-init/recon/recon-uis/recon-doc) 무영향.
- AIDD(B2: sl-aidd/qa-agent/build_story) 무영향.
- 공유 에이전트(spec/rd/srs/sad/ddd-*/rtm/dev/test/qa) 동작 보존 — REQ-C 열 제거만.
- 추적 축 = FUNC-ID(RECON) + SR(DELTA, 단일). B2에서 확정한 FUNC 축 불변.

## 10. 검증
- 구 sl-plan/analyze/quick 슬래시 진입점 제거 + plugin.json skills 정합(13개).
- `/sl-change --quick`·`--full` 두 경로 SKILL 내 단계 존재 확인.
- REQ-C/RD_v 잔존 grep 0(허용: 역사적 버전노트).
- RECON·AIDD 무영향 grep 게이트.

## 11. 비범위
- B3(sl-status = rtm+sprint 통합) — 별도 서브프로젝트.
- 기존 변경관리 산출물 마이그레이션 — 안 함.
- Jira/MCP 연동 로직 변경 — 없음(수집 경로 그대로).
