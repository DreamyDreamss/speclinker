# B3 — /sl-status 통합 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `sl-rtm` + `sl-sprint`를 신규 `/sl-status` 단일 명령(`--coverage`/`--next`/`--publish`)으로 통합. sl-drift·rtm-agent 보존.

**Architecture:** 두 스킬 모두 FUNC_MAP + sprint-status.yaml 축 → 통합. sl-status가 sprint-status 생성/갱신을 선행 후 플래그별 분기(통합대시보드/커버리지+갭/추천/게시). 죽은 `ua_req_bridge.js` 블록은 제거.

**Tech Stack:** Claude Code 스킬(SKILL.md), plugin.json, Docsify(JS). 신규 스크립트 없음 → 검증=grep 게이트 + JSON 정합.

**상위 설계서:** `docs/superpowers/specs/2026-06-04-b3-status-consolidation-design.md`

**불변식:** RECON·AIDD(B2)·DELTA(B1: sl-change) 무영향. `rtm-agent`(RECON doc)·`sprint-status.yaml` 스키마·RTM 파일 형식 보존. sl-drift 독립.

**제거 대상:** `skills/sl-rtm/`, `skills/sl-sprint/`. **신규:** `skills/sl-status/`.

---

## 파일 구조 (생성/이동/삭제 맵)

| 파일 | 액션 |
|------|------|
| `skills/sl-status/SKILL.md` | **생성** (rtm+sprint 통합) |
| `skills/sl-status/sprint-status-template.yaml` | **이동** (sl-sprint에서 git mv) |
| `skills/sl-rtm/`, `skills/sl-sprint/` | **삭제** |
| `.claude-plugin/plugin.json` | sl-rtm/sl-sprint 제거 + sl-status 추가(13→12), v3.3.0 |
| `CLAUDE.md` | 라우팅 2행 제거+sl-status 추가, 파이프라인, AIDD 완료안내, v3.3.0 노트 |
| `README.md` | 스킬트리 2개 제거+sl-status, 파이프라인 |
| `docs/viewer/docsify-sl.js` | GUIDE_PIPELINES/CATEGORIES sl-rtm/sl-sprint→sl-status, GUIDE_VERSION |
| 다음-포인터 보유 스킬 | `/sl-rtm`·`/sl-sprint` → `/sl-status` |

---

## Task 1: skills/sl-status/SKILL.md 생성 + 템플릿 이동

**Files:** Create `skills/sl-status/SKILL.md`; Move `skills/sl-sprint/sprint-status-template.yaml` → `skills/sl-status/`

- [ ] **Step 1: 템플릿 이동**

```
git mv skills/sl-sprint/sprint-status-template.yaml skills/sl-status/sprint-status-template.yaml
```
(`skills/sl-status/` 디렉토리는 git mv가 생성. 안 되면 먼저 `New-Item -ItemType Directory skills/sl-status`.)

- [ ] **Step 2: sl-status/SKILL.md 작성**

`skills/sl-status/SKILL.md` 생성:

````markdown
---
name: sl-status
description: 추적·현황 단일 명령 — FUNC 커버리지·갭(구 sl-rtm) + 진행상태·추천(구 sl-sprint) 통합. sprint-status.yaml 생성/갱신 내장.
triggers:
  - /sl-status
---

# /sl-status — 추적·진행 현황 통합

FUNC_MAP + sprint-status.yaml을 한 뷰로. 구 `sl-rtm`(커버리지·갭·게시) + `sl-sprint`(진행·추천)를 흡수했다.

## 호출 형식

| 형식 | 용도 |
|------|------|
| `/sl-status` | 통합 대시보드 — 커버리지 + 진행상태 + 갭 요약 |
| `/sl-status --coverage` | FUNC 커버리지 재계산 + 미연결 갭 리포트 (구 sl-rtm --func/--gap) |
| `/sl-status --next` | 다음 구현 FUNC 추천 (구 sl-sprint --next) |
| `/sl-status --publish` | Confluence 게시 (구 sl-rtm --publish, NETWORK=open) |

## STEP 0 — 전제 확인

```python
!python3 -c "
import os
print('FUNC_MAP:', '존재' if os.path.exists('docs/00_FUNC/FUNC_MAP.md') else '없음 → /sl-recon-doc 먼저 실행')
"
```
FUNC_MAP 없으면 중단하고 `/sl-recon-doc` 안내.

## STEP 1 — sprint-status.yaml 생성/갱신 (선행)

FUNC_MAP을 파싱해 `.speclinker/sprint-status.yaml`을 생성/갱신한다.
- FUNC-ID/도메인/UIS/INF 추출.
- 기존 파일이 있으면 상태 보존(done/review/in-progress는 backlog으로 되돌리지 않음), 신규 FUNC만 `backlog` 추가, 제거된 FUNC는 삭제.
- `skills/sl-status/sprint-status-template.yaml` 기반으로 Write.

```bash
!grep -E "^\| FUNC-" docs/00_FUNC/FUNC_MAP.md 2>/dev/null
!cat .speclinker/sprint-status.yaml 2>/dev/null
!mkdir -p .speclinker
!cat docs/project-context.md 2>/dev/null | grep "프레임워크" | head -1
```

## STEP 2 — 분기

### (무플래그) 통합 대시보드

커버리지 + 상태별 카운트 + 갭 요약을 한 번에 출력.

```python
!python3 -c "
import os, json, re
func_map = 'docs/00_FUNC/FUNC_MAP.md'
content = open(func_map, encoding='utf-8').read()
func_ids = set(re.findall(r'FUNC-[\w]+-\d+', content))
cache_path = '.understand-anything/linked-func-cache.json'
linked = set()
if os.path.exists(cache_path):
    for ids in json.load(open(cache_path, encoding='utf-8')).values():
        linked.update(ids)
covered = func_ids & linked
pct = int(len(covered)/len(func_ids)*100) if func_ids else 0
print(f'FUNC 커버리지: {len(covered)}/{len(func_ids)} ({pct}%)')
print(f'미연결 갭: {len(func_ids - linked)}건')
"
!cat .speclinker/sprint-status.yaml 2>/dev/null
```
`.speclinker/sprint-status.yaml`의 상태별(backlog/ready-for-dev/in-progress/review/done) 건수와 도메인별 진척을 집계해 대시보드로 출력:
```
══════════════════════════════════
개발 진행 현황 — {PROJECT_NAME}
FUNC 커버리지: {covered}/{total} ({%})   미연결 갭: {N}건
──────────────────────────────────
✅ done {n} | 🔍 review {n} | 🔨 in-progress {n} | 📋 ready-for-dev {n} | 📦 backlog {n}
도메인별: {domain}: done {N}/{전체} ({%})
══════════════════════════════════
```

### --coverage (구 sl-rtm --func + --gap)

```python
!python3 -c "
import os, json, re
cache_path = '.understand-anything/linked-func-cache.json'
func_map_path = 'docs/00_FUNC/FUNC_MAP.md'
content = open(func_map_path, encoding='utf-8').read()
func_ids = set(re.findall(r'FUNC-[\w]+-\d+', content))
linked = set()
if os.path.exists(cache_path):
    for ids in json.load(open(cache_path, encoding='utf-8')).values():
        linked.update(ids)
covered   = func_ids & linked
uncovered = sorted(func_ids - linked)
print(f'전체 FUNC-ID: {len(func_ids)}개')
print(f'구현 완료:    {len(covered)}개 ({int(len(covered)/len(func_ids)*100) if func_ids else 0}%)')
print(f'미구현/미연결: {len(uncovered)}개')
for fid in uncovered:
    print(f'  - {fid}')
"
```
또한 linked_func 스캔으로 커버리지를 재계산하려면 `req_scan.py`(PLUGIN_PATH/scripts)를 실행한다.

### --next (구 sl-sprint --next)

`.speclinker/sprint-status.yaml`의 `ready-for-dev` 중 추천:
1. 가장 많은 INF 연결(핵심 우선) 2. in-progress→backlog 재개건 3. 없으면 backlog 상단.
```
다음 구현 추천: {FUNC-ID} — {기능명}
  연결 INF: {INF-ID 목록} / 연결 UIS: {UIS-ID} / 이유: {추천 이유}
시작하려면: /sl-aidd {FUNC-ID}
```

### --publish (구 sl-rtm --publish)

```python
!python3 -c "
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
print('NETWORK=' + env.get('NETWORK','closed'))
"
```
`NETWORK=open`이면 Confluence MCP로 RTM/FUNC_MAP 게시. `closed`면 파일 경로 + 수동 업로드 안내.
````

- [ ] **Step 3: 검증 — 4경로 존재**
```
Select-String -Path skills\sl-status\SKILL.md -Pattern '--coverage','--next','--publish','통합 대시보드'
```
Expected: 4개 패턴 매칭.

- [ ] **Step 4: 커밋**
```
git add skills/sl-status/SKILL.md skills/sl-status/sprint-status-template.yaml
git rm -q skills/sl-sprint/sprint-status-template.yaml 2>$null
git commit -m "feat: add /sl-status (merges sl-rtm coverage/gap/publish + sl-sprint status/next)"
```
(git mv를 썼으면 삭제는 자동 스테이징됨 — 그 경우 두 번째 git rm 생략.)

---

## Task 2: sl-rtm/sl-sprint 삭제 + plugin.json

**Files:** Delete 2 dirs; Modify `.claude-plugin/plugin.json`

- [ ] **Step 1: 삭제**
```
git rm -rf skills/sl-rtm skills/sl-sprint
```
(sprint-status-template.yaml은 Task 1에서 이미 이동됨.)

- [ ] **Step 2: plugin.json — sl-rtm/sl-sprint 제거 + sl-status 추가 + 버전**

`"./skills/sl-rtm"`, `"./skills/sl-sprint"` 삭제. `"./skills/sl-status"` 추가(sl-drift 근처 권장). `"version": "3.2.0"` → `"3.3.0"`.

- [ ] **Step 3: 검증**
```
$j = Get-Content .claude-plugin\plugin.json -Raw | ConvertFrom-Json
"version=$($j.version) skills=$($j.skills.Count)"
"removed: $("$($j.skills -join ',')" -match 'sl-rtm|sl-sprint') | status: $('./skills/sl-status' -in $j.skills)"
```
Expected: `version=3.3.0 skills=12`; removed `False`; status `True`.

- [ ] **Step 4: 커밋**
```
git add -A skills .claude-plugin/plugin.json
git commit -m "feat: remove sl-rtm/sl-sprint skills, register sl-status, bump v3.3.0"
```

---

## Task 3: CLAUDE.md doc-sync

**Files:** Modify `CLAUDE.md`

- [ ] **Step 1: 라우팅표 — sl-rtm/sl-sprint 제거 + sl-status 추가**

`/sl-rtm`, `/sl-sprint [--status\|--next]` 행 삭제. 대체 1행 추가:
```
| `/sl-status [--coverage\|--next\|--publish]` | `skills/sl-status/SKILL.md` | docs/00_FUNC/FUNC_MAP.md | 추적 |
```

- [ ] **Step 2: 상황별 파이프라인표 + 잔여 sl-sprint/sl-rtm**

`Select-String -Path CLAUDE.md -Pattern 'sl-rtm|sl-sprint'`로 위치 확인. SDD 파이프라인표 등에서 `sl-sprint`→`sl-status`로 교정.

- [ ] **Step 3: 버전노트**
```
> **v3.3.0** (B3): `/sl-status` 추적 통합 — sl-rtm(커버리지·갭·게시) + sl-sprint(진행·추천·sprint-status 생성) 흡수·삭제. 플래그 --coverage/--next/--publish, 무플래그=통합 대시보드. sl-drift·rtm-agent 보존. skills 12. 명령어 통합(B) 완료: 19→12.
```

- [ ] **Step 4: 검증**
```
Select-String -Path CLAUDE.md -Pattern 'skills/sl-rtm/SKILL','skills/sl-sprint/SKILL','sl-status','v3.3.0'
```
Expected: SKILL 경로 2종 매칭 없음; sl-status/v3.3.0 매칭 있음.

- [ ] **Step 5: 커밋**
```
git add CLAUDE.md
git commit -m "docs: sync CLAUDE.md for B3 (sl-status routing/pipeline/v3.3.0)"
```

---

## Task 4: README / docsify-sl.js / scripts + 다음-포인터

**Files:** `README.md`, `docs/viewer/docsify-sl.js`, `scripts/README.md`, 다음-포인터 보유 스킬

- [ ] **Step 1: README 스킬트리·파이프라인**

`Select-String -Path README.md -Pattern 'sl-rtm|sl-sprint'`로 위치 확인 후: 스킬트리에서 sl-rtm/sl-sprint 행 제거 + sl-status 추가, 파이프라인 예시 교정.

- [ ] **Step 2: docsify-sl.js**

- GUIDE_PIPELINES: sl-sprint 등장 체인을 sl-status로 교정(또는 제거).
- GUIDE_CATEGORIES: `개발 · 테스트 · 추적` 카테고리의 `/sl-rtm` 줄, `SDD 파이프라인` 카테고리의 `/sl-sprint` 줄을 `/sl-status [--coverage\|--next\|--publish]` 한 줄로 통합.
- `GUIDE_VERSION` → `'3.3.0'`.
- 검증: `node -e "require('fs').readFileSync('docs/viewer/docsify-sl.js','utf8')"` + `Select-String ... -Pattern 'sl-rtm','sl-sprint' -SimpleMatch`(sl-quick-nav 같은 UI id 무관) → 진입점 0.

- [ ] **Step 3: scripts/README + 다음-포인터**

```
Select-String -Path scripts\README.md,skills\*\*.md -Pattern '/sl-rtm|/sl-sprint'
```
각 매칭(예: sl-aidd 완료안내 "대시보드: SpecLens"·"/sl-sprint", sl-change 등)에서 `/sl-rtm`·`/sl-sprint` 안내를 `/sl-status`로 교정.

- [ ] **Step 4: 커밋**
```
git add README.md docs/viewer/docsify-sl.js scripts/README.md skills
git commit -m "docs: sync README/SpecLens guide + retarget pointers to sl-status (B3)"
```

---

## Task 5: 최종 무결성 게이트

**Files:** 검증 전용

- [ ] **Step 1: 제거 스킬 잔존 grep**
```
Select-String -Path skills\*\*.md,agents\*.md,scripts\*.md,docs\viewer\*.js,README.md,CLAUDE.md,templates\*.md -Pattern '/sl-rtm|/sl-sprint'
```
Expected: 매칭은 **허용 예외만** — CLAUDE.md v3.3.0/과거 버전노트의 역사적 서술. 그 외(라우팅·진입점·`skills/sl-rtm|sprint/SKILL` 경로·다음-포인터·plugin.json) 0. (`docs/superpowers/**` 제외. `sprint-status` 파일명·`rtm-agent`는 매칭 대상 아님.)

- [ ] **Step 2: 삭제/신규 확인**
```
"sl-rtm: $(Test-Path skills\sl-rtm)"; "sl-sprint: $(Test-Path skills\sl-sprint)"; "sl-status: $(Test-Path skills\sl-status\SKILL.md)"
"template moved: $(Test-Path skills\sl-status\sprint-status-template.yaml)"
"rtm-agent kept: $(Test-Path agents\rtm-agent.md)"
```
Expected: sl-rtm/sl-sprint `False`; sl-status/template/rtm-agent `True`.

- [ ] **Step 3: plugin.json + RECON/AIDD/DELTA 무영향**
```
$j = Get-Content .claude-plugin\plugin.json -Raw | ConvertFrom-Json
"version=$($j.version) skills=$($j.skills.Count)"
Select-String -Path skills\sl-recon\SKILL.md,skills\sl-aidd\SKILL.md,skills\sl-change\SKILL.md -Pattern '/sl-rtm|/sl-sprint'
```
Expected: `version=3.3.0 skills=12`; recon/aidd/change 매칭 0.

- [ ] **Step 4: 잔존 정리분 커밋**
```
git add -A
git commit -m "chore: B3 integrity gate — verify rtm/sprint removal and sl-status"
```

---

## 완료 정의 (DoD)
- [ ] sl-rtm/sl-sprint 삭제 + sl-status 신규, plugin.json skills 12 / v3.3.0.
- [ ] /sl-status 4경로(무플래그/--coverage/--next/--publish) + sprint-status 생성/갱신 내장.
- [ ] sprint-status-template.yaml이 sl-status로 이동, rtm-agent·sl-drift 보존.
- [ ] CLAUDE.md·README·docsify-sl.js·scripts·다음-포인터 동기화.
- [ ] 무결성 grep: 허용 예외 외 잔존 0. RECON·AIDD·DELTA 무영향.
- [ ] 명령어 통합(B) 전체 완료: 19→12.
