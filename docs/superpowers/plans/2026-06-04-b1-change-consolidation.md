# B1 — /sl-change 통합 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/sl-change`를 DELTA 단일 명령(`--quick`/`--full`)으로 통합하고, sl-plan/sl-analyze/sl-quick을 흡수·삭제, REQ-C/RD_v를 폐기(SR 단일축)한다.

**Architecture:** sl-change는 이미 전주기(SR수집→영향분석→TO-BE→산출물→스펙현행화→RTM)를 수행 중 → analyze는 중복이라 제거. quick의 경량 로직을 `--quick` 분기로 흡수. REQ-C/RD_v 블록 제거 후 RTM이 SR 단일 추적축.

**Tech Stack:** Claude Code 스킬(SKILL.md), plugin.json, Docsify 뷰어(JS). 신규 스크립트 없음 → 검증=grep 게이트 + JSON 정합.

**상위 설계서:** `docs/superpowers/specs/2026-06-04-b1-change-consolidation-design.md`

**불변식:** RECON 파이프라인·AIDD(B2: sl-aidd/qa-agent/build_story)·공유 에이전트 무영향. 추적 축 = FUNC-ID(RECON) + SR(DELTA 단일).

**제거 대상:** `skills/sl-plan/`, `skills/sl-analyze/`, `skills/sl-quick/`.

---

## 파일 구조 (수정/삭제 맵)

| 파일 | 액션 |
|------|------|
| `skills/sl-change/SKILL.md` | REQ-C/RD 블록 제거 + `--quick` 분기 추가 + 호출형식/description 갱신 |
| `skills/sl-plan/`,`skills/sl-analyze/`,`skills/sl-quick/` | **삭제** |
| `.claude-plugin/plugin.json` | skills 3개 제거(16→13), v3.2.0 |
| `CLAUDE.md` | 라우팅 3행 제거·sl-change 갱신·파이프라인·REQ-C 정리·v3.2.0 노트 |
| `README.md` | 스킬트리 3개 제거·sl-change 갱신·파이프라인 |
| `docs/viewer/docsify-sl.js` | GUIDE_PIPELINES/CATEGORIES 3개 제거·sl-change 갱신·GUIDE_VERSION |
| 다음-포인터 보유 스킬 | `/sl-plan\|/sl-analyze\|/sl-quick` → `/sl-change` 교정 |

---

## Task 1: sl-change에서 REQ-C / RD 블록 제거 (SR 단일축)

**Files:** Modify `skills/sl-change/SKILL.md`

- [ ] **Step 1: Step 8-1 "REQ-C 매핑" 제거**

다음 블록을 삭제:
```
## REQ-C 매핑
- 신규 변경 요구사항: REQ-C-{번호}
```
→ 대체:
```
## 변경 요구사항 (SR 단일축)
- SR-{번호} 하위 요구사항을 불릿으로 기술 (별도 REQ-C ID 없음)
```

- [ ] **Step 2: Step 9-1 "RD 현행화" 제거**

`### 9-1. RD 현행화`부터 다음 코드블록 2개까지(원문: 최신 `RD_v{X.Y}.md`를 복사 … `| 1.1 | {날짜} | SR-1234 반영 …`)를 통째로 삭제하고, `### 9-2. 도메인 설계 파일 현행화`를 `### 9-1. 도메인 설계 파일 현행화`로 승격. (RD 파일은 SR 단일축에서 미사용 — RTM이 변경 기록을 담당)

실행: 해당 구간을 Read로 정확히 확인 후 `### 9-1. RD 현행화 … ### 9-2.` 헤더 직전까지를 제거하고 9-2를 9-1로 변경.

- [ ] **Step 3: Step 10-2 RTM 행에서 REQ-C 열 제거**

`### 10-2. 변경 요구사항 추적 섹션`의 예시 행:
```
| SR-1234 | REQ-C-001 | SCREEN_MODIFY | 주문 목록 날짜 범위 검색 추가 | order | INF-067 | | UIS-F-012 | {날짜} | 🔁 |
```
→
```
| SR-1234 | SCREEN_MODIFY | 주문 목록 날짜 범위 검색 추가 | order | INF-067 | | UIS-F-012 | {날짜} | 🔁 |
```
그리고 같은 섹션의 설명 문구에 REQ-C 언급이 있으면 제거.

- [ ] **Step 4: sl-change 본문의 잔여 REQ-C/RD_v 언급 정리**

```
Select-String -Path skills\sl-change\SKILL.md -Pattern 'REQ-C','RD_v','RD 현행화'
```
남은 매칭(예: Step 11 완료출력 `RTM: REQ-C-{번호} 추가`)을 `RTM: SR-{ID} 행 추가/갱신`으로 교정.

- [ ] **Step 5: analyze/rtm 에이전트의 REQ-C 잔재 확인**

```
Select-String -Path skills\sl-analyze\SKILL.md,agents\rtm-agent.md,skills\sl-rtm\SKILL.md -Pattern 'REQ-C' -SimpleMatch
```
sl-analyze는 Task 3에서 삭제되므로 무시. rtm-agent/sl-rtm에 REQ-C 열/행 정의가 있으면 SR 단일축으로 교정(있을 때만).

- [ ] **Step 6: 커밋**
```
git add skills/sl-change/SKILL.md agents/rtm-agent.md skills/sl-rtm/SKILL.md
git commit -m "refactor: drop REQ-C/RD_v from DELTA — SR single tracking axis"
```

---

## Task 2: sl-change에 --quick 분기 추가 + 모드 명시 (sl-quick/plan 흡수)

**Files:** Modify `skills/sl-change/SKILL.md`

- [ ] **Step 1: description / 호출 형식 갱신**

frontmatter description과 `## 호출 형식` 섹션을 Read로 확인 후, 호출 형식 표에 모드를 명시:
```
| 형식 | 용도 |
|------|------|
| `/sl-change <SR-ID>` | 전주기(--full 기본): CIA→TO-BE→스펙동기화→RTM |
| `/sl-change --full <SR-ID>` | 명시적 전주기 |
| `/sl-change --quick "설명"` | SR 없이 소규모 경량 변경(구 sl-quick) |
| `/sl-change --new <SR-ID>` | 로컬 SR 요구사항 파일 템플릿 생성 |
```
description도 "DELTA 단일 명령 — --quick/--full" 취지로 갱신.

- [ ] **Step 2: `--quick` 경량 경로 섹션 삽입**

`## 호출 형식` 섹션 직후(첫 `## Step 1 — SR 수집` 직전)에 아래 섹션을 삽입:

````markdown
## `/sl-change --quick "설명"` — 경량 경로 (SR 없이)

단순 버그픽스·소규모 수정 전용. 전체 SR 파이프라인(Step 1~10) 없이 빠르게 변경하되 스펙 동기화는 유지한다.
아래 분기로 처리하고, 완료 후 종료한다(Step 1+ 전주기로 내려가지 않음).

**스코프 기준 (초과 시 `--full` 권장):** 단일 목표 · INF 1~2개 · SCH 변경 없음.

| 조건 | 동작 |
|------|------|
| INF 3개 이상 영향 | 경고 + "--full 사용 권장. 계속?" |
| SCH 변경 예상 | 경고 + "--full 사용 권장. 계속?" |
| `docs/05_설계서/` 없음 | 중단 → "/sl-recon 먼저 실행" |

### Q1. 스코프 + 영향 미리보기 (구 sl-plan 경량)

수정 의도에서 키워드 추출 → 영향 INF 매핑 + 규모 분류:
```bash
!grep -rl "{키워드}" docs/05_설계서/*/INF/ --include="*.md" 2>/dev/null | wc -l
```
INF 3개 이상이면 경고 후 사용자 확인.

### Q2. 인라인 스펙 기록

영향 INF 파일 1~2개를 특정하고, 각 파일 하단 `## 변경 이력`에 행 추가(별도 SR 문서 미생성):
```markdown
## 변경 이력

| 날짜 | 변경 내용 | 변경자 |
|------|---------|-------|
| {YYYY-MM-DD} | {변경 한 줄 요약} | /sl-change --quick (auto) |
```

### Q3. project-context.md 로드
```bash
!cat docs/project-context.md 2>/dev/null | head -80
```
없으면 경고 후 계속.

### Q4. TDD 구현 (dev-agent 위임)

> dev-agent에게:
> - 수정 목표: {설명} / 영향 INF: {INF-ID 목록}
> - project-context.md 패턴 준수, TDD(RED→GREEN→REFACTOR), linked_func 주석 삽입.

### Q5. 경량 게이트 (Layer 1만)

인라인으로 Layer 1(스펙 일치)만 점검. 보안·회귀(Layer 2/3)는 생략.
(본격 검증 필요 시 `/sl-aidd` story 루프의 qa-agent 게이트 사용.) CRITICAL 결함 없으면 완료.

### Q6. 완료 보고
```
/sl-change --quick 완료
수정 내용: {설명} / 영향 INF: {INF-ID 목록}
변경 이력: 각 INF 파일 하단 기록 / Layer 1: PASS
수정 파일: {소스 목록} + {INF 변경이력}
```
````

- [ ] **Step 3: 커밋**
```
git add skills/sl-change/SKILL.md
git commit -m "feat: add --quick branch to /sl-change (absorbs sl-quick + sl-plan preview)"
```

---

## Task 3: sl-plan/sl-analyze/sl-quick 삭제 + plugin.json

**Files:** Delete 3 skill dirs; Modify `.claude-plugin/plugin.json`

- [ ] **Step 1: 세 스킬 삭제**
```
git rm -rf skills/sl-plan skills/sl-analyze skills/sl-quick
```

- [ ] **Step 2: plugin.json — skills 3개 제거 + 버전**

`"./skills/sl-analyze"`, `"./skills/sl-plan"`, `"./skills/sl-quick"` 세 줄 삭제. `"version": "3.1.0"` → `"3.2.0"`.

- [ ] **Step 3: 검증**
```
$j = Get-Content .claude-plugin\plugin.json -Raw | ConvertFrom-Json
"version=$($j.version) skills=$($j.skills.Count)"
"$($j.skills -join ',')" -match 'sl-plan|sl-analyze|sl-quick'
```
Expected: `version=3.2.0 skills=13`; -match `False`.

- [ ] **Step 4: 커밋**
```
git add -A skills .claude-plugin/plugin.json
git commit -m "feat: remove sl-plan/sl-analyze/sl-quick skills, bump v3.2.0"
```

---

## Task 4: CLAUDE.md doc-sync

**Files:** Modify `CLAUDE.md`

- [ ] **Step 1: 라우팅표 — 3행 제거 + sl-change 갱신**

`/sl-analyze`, `/sl-plan [파일\|텍스트]`, `/sl-quick "설명"` 3개 행 삭제. `/sl-change <SR-ID>` 행을 다음으로 교체:
```
| `/sl-change <SR-ID> [--quick\|--full]` | `skills/sl-change/SKILL.md` | project.env, docs/05_설계서/ (로컬 파일 또는 NETWORK=open) | DELTA (변경 전주기·경량 통합) |
```

- [ ] **Step 2: 상황별 파이프라인표 갱신**

- `변경·유지보수 (Jira)` 행: `sl-analyze → sl-change → **sl-aidd**` → `sl-change <SR> → **sl-aidd**`.
- `SDD 전체 파이프라인` 행: `sl-plan → sl-analyze → sl-change` 부분 → `sl-change`.
- `SDD 소규모 변경` 행: `**sl-quick** "설명"` → `**sl-change --quick** "설명"`.

- [ ] **Step 3: REQ-C 잔재 + 버전노트**

CLAUDE.md 내 `REQ-C` 매칭이 있으면 정리. 버전노트 최상단에 추가:
```
> **v3.2.0** (B1): `/sl-change` DELTA 단일 통합 — sl-plan/sl-analyze/sl-quick 흡수·삭제(analyze는 sl-change 전주기와 중복, quick은 `--quick` 분기, plan 경량리포트는 --quick 1단계). **REQ-C/RD_v 폐기 → SR 단일 추적축**(RTM이 SR→INF/SCH/UIS 직접). skills 13. RECON·AIDD 무영향.
```

- [ ] **Step 4: 검증**
```
Select-String -Path CLAUDE.md -Pattern 'skills/sl-plan/SKILL','skills/sl-analyze/SKILL','skills/sl-quick/SKILL','v3.2.0'
```
Expected: SKILL 경로 3종 매칭 없음; `v3.2.0` 매칭 있음.

- [ ] **Step 5: 커밋**
```
git add CLAUDE.md
git commit -m "docs: sync CLAUDE.md for B1 (routing/pipeline/REQ-C removal/v3.2.0)"
```

---

## Task 5: README / docsify-sl.js / scripts-README + 다음-포인터

**Files:** `README.md`, `docs/viewer/docsify-sl.js`, `scripts/README.md`, 다음-포인터 보유 스킬

- [ ] **Step 1: README 스킬트리·파이프라인**

`Select-String -Path README.md -Pattern 'sl-plan|sl-analyze|sl-quick'`로 위치 확인 후: 스킬트리에서 sl-analyze/sl-plan/sl-quick 행 제거, sl-change 설명을 `SR 전주기 + --quick 경량 (변경관리 단일)`로 갱신, 파이프라인 예시 교정.

- [ ] **Step 2: docsify-sl.js**

- GUIDE_PIPELINES: DELTA 체인 `['sl-analyze', 'sl-change', 'sl-aidd']` → `['sl-change', 'sl-aidd']`. SDD 체인에 sl-plan 있으면 제거.
- GUIDE_CATEGORIES: `변경 관리 — DELTA` 카테고리에서 sl-analyze 줄 제거·sl-change 줄 갱신(`--quick/--full`), `SDD 파이프라인` 카테고리에서 sl-plan 줄 제거, sl-quick 줄 제거.
- `GUIDE_VERSION` → `'3.2.0'`.
- 검증: `node -e "require('fs').readFileSync('docs/viewer/docsify-sl.js','utf8')"` + `Select-String ... -Pattern 'sl-plan','sl-analyze','sl-quick' -SimpleMatch` → 0.

- [ ] **Step 3: scripts/README.md + 다음-포인터**

```
Select-String -Path scripts\README.md,skills\*\*.md -Pattern 'sl-plan|sl-analyze|sl-quick' | Where-Object { $_ -notmatch 'sl-change' }
```
각 매칭에서 `/sl-plan`·`/sl-analyze`·`/sl-quick` 진입점/다음-커맨드 안내를 `/sl-change`(또는 `--quick`)로 교정.

- [ ] **Step 4: 커밋**
```
git add README.md docs/viewer/docsify-sl.js scripts/README.md skills
git commit -m "docs: sync README/SpecLens guide + retarget pointers to sl-change (B1)"
```

---

## Task 6: 최종 무결성 게이트

**Files:** 검증 전용

- [ ] **Step 1: 제거 스킬·REQ-C/RD 잔존 grep**
```
Select-String -Path skills\*\*.md,agents\*.md,scripts\*.md,docs\viewer\*.js,README.md,CLAUDE.md,templates\*.md -Pattern '/sl-plan|/sl-analyze|/sl-quick|REQ-C|RD_v'
```
Expected: 매칭은 **허용 예외만** — CLAUDE.md v3.2.0/과거 버전노트의 역사적 서술. 그 외(라우팅·진입점·`skills/sl-*/SKILL` 경로·다음-포인터·plugin.json·RTM REQ-C 열) 0. 잔존 시 해당 Task 복귀.
(`docs/superpowers/**` 제외.)

- [ ] **Step 2: 삭제 디렉토리 확인**
```
"sl-plan: $(Test-Path skills\sl-plan)"; "sl-analyze: $(Test-Path skills\sl-analyze)"; "sl-quick: $(Test-Path skills\sl-quick)"
```
Expected: 모두 `False`.

- [ ] **Step 3: plugin.json 정합 + RECON/AIDD 무영향**
```
$j = Get-Content .claude-plugin\plugin.json -Raw | ConvertFrom-Json
"version=$($j.version) skills=$($j.skills.Count)"
Select-String -Path skills\sl-recon\SKILL.md,skills\sl-aidd\SKILL.md -Pattern 'sl-plan|sl-analyze|sl-quick|REQ-C'
```
Expected: `version=3.2.0 skills=13`; recon/aidd 매칭 0.

- [ ] **Step 4: 잔존 정리분 커밋**
```
git add -A
git commit -m "chore: B1 integrity gate — verify removals and SR single-axis"
```

---

## 완료 정의 (DoD)
- [ ] sl-plan/sl-analyze/sl-quick 삭제 + plugin.json skills 13개 / v3.2.0.
- [ ] /sl-change에 `--quick`(경량) + `--full`(전주기) 분기 존재.
- [ ] REQ-C/RD_v 폐기 — RTM이 SR 단일 추적축(SR→INF/SCH/UIS 직접).
- [ ] CLAUDE.md(라우팅·파이프라인·v3.2.0)·README·docsify-sl.js·scripts-README·다음-포인터 동기화.
- [ ] 무결성 grep: 허용 예외 외 잔존 0.
- [ ] RECON·AIDD 무영향(grep 게이트 확인).
