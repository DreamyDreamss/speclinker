# GENESIS 제거 구현 계획 (Sub-project A)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans 또는 subagent-driven-development. 스텝은 `- [ ]` 체크박스.
>
> **Git:** 작업 디렉토리 = `D:/gen-harness/plugins/speclinker` (git repo, main). 각 Task는 grep 무결성 게이트 통과 후 커밋. 내 파일만 stage. 커밋 메시지 `feat:`/`refactor:` 한글 + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.
>
> **참조 spec:** `docs/superpowers/specs/2026-06-04-genesis-removal-design.md`

**Goal:** GENESIS 모드와 REQ-ID/RD 체계, MODE 개념을 전면 제거해 플러그인을 SM(운영시스템) 전용(RECON+DELTA+AIDD)으로 단순화한다.

**Architecture:** "순수 GENESIS 산출물/스킬은 삭제 + 공유 에이전트(rd/srs/spec/sad/rtm)는 GENESIS 분기만 제거하고 RECON 경로 보존 + MODE 플래그 폐기(명령어가 행위 결정)". 각 Task 후 `grep` 잔존 게이트로 무결성 보장.

**Tech Stack:** Markdown(skills/agents/templates/docs), Python/JS(scripts/viewer), plugin.json.

**불변식(절대 보존):** RECON 파이프라인 전 STEP, 공유 에이전트의 RECON 동작, DELTA(sl-analyze/change/quick), AIDD/dev/test/sprint/drift/context/ia, POC_MODE.

---

## 파일 변경 맵

| 분류 | 파일 | Task |
|------|------|------|
| 삭제 | `skills/sl-genesis/`, `templates/RD_template.md`, plugin.json skills[] 항목 | 1 |
| MODE 폐기 | `skills/sl-init/SKILL.md`(+create_dirs.sh), `sl-recon`, `sl-recon-uis` | 2,3 |
| linked_req 분기 제거 | `sl-aidd`, `sl-dev`, `sl-test`, `sl-rtm` | 4 |
| 에이전트 크로스링크 | `ddd-api/db/ui-agent.md` | 5 |
| 공유 에이전트 | `rd/srs/spec/sad/rtm-agent.md` | 6 |
| 라우팅/원칙 | `CLAUDE.md` | 7 |
| 템플릿 | `SPEC_CONVENTIONS`, INF/SCH/UIS/RTM/SAD/SRS/TC/TR/API_Design 템플릿 | 8 |
| 스크립트/가이드/문서 | `merge_index.py`, `func_context_bundle.py`, `docsify-sl.js`, `README.md`, `SETUP_GUIDE.md` | 9 |
| 메타/버전/최종게이트 | `plugin.json`, `CLAUDE.md` 버전노트, `RECON_PIPELINE.md` | 10 |

---

## Task 1: sl-genesis 스킬 + RD 템플릿 삭제 + 등록 해제

**Files:** Delete `skills/sl-genesis/`, `templates/RD_template.md`; Modify `.claude-plugin/plugin.json`

- [ ] **Step 1: 삭제**

```bash
cd D:/gen-harness/plugins/speclinker
git rm -r -q skills/sl-genesis
git rm -q templates/RD_template.md
```

- [ ] **Step 2: plugin.json skills[]에서 sl-genesis 등록 해제**

`.claude-plugin/plugin.json`의 `"skills"` 배열에서 `"./skills/sl-genesis",` 줄을 제거한다. (JSON 유효성 유지 — 쉼표 주의)

- [ ] **Step 3: 무결성 게이트**

```bash
python -c "import json; d=json.load(open('.claude-plugin/plugin.json',encoding='utf-8')); assert './skills/sl-genesis' not in d['skills']; print('plugin.json OK, skills:', len(d['skills']))"
test ! -d skills/sl-genesis && test ! -f templates/RD_template.md && echo "삭제 확인 OK"
```
Expected: `plugin.json OK` + `삭제 확인 OK`.

- [ ] **Step 4: 커밋**

```bash
git add .claude-plugin/plugin.json
git commit -m "refactor: sl-genesis 스킬·RD 템플릿 삭제 + plugin.json 등록 해제

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: MODE 폐기 — sl-init + project.env + RD 폴더

**Files:** `skills/sl-init/SKILL.md`, `skills/sl-init/create_dirs.sh`

- [ ] **Step 1: sl-init이 project.env에 MODE를 쓰지 않게 변경**

`skills/sl-init/SKILL.md` 라인 121 `MODE=<선택한 값: RECON 또는 GENESIS>` 줄을 **삭제**한다(모드 묻지도/쓰지도 않음). 라인 820의 `- project.env — MODE, NETWORK, …` 설명에서 `MODE, ` 제거.

- [ ] **Step 2: MODE=RECON 게이트 제거**

`skills/sl-init/SKILL.md` 라인 741 `if env.get('MODE','').upper() != 'RECON':` 블록을 제거한다(모드 검증 불필요). 인접 안내문도 함께 정리.

- [ ] **Step 3: 01_요구사항정의서 폴더 생성 제거**

`skills/sl-init/create_dirs.sh`(및 SKILL.md 내 디렉토리 목록)에서 `01_요구사항정의서` 생성 라인을 제거한다. (RD 산출물 폐기)

- [ ] **Step 4: 무결성 게이트**

```bash
grep -n "MODE" skills/sl-init/SKILL.md | grep -v "POC_MODE" || echo "MODE 잔존 없음(OK)"
grep -rn "01_요구사항정의서" skills/sl-init/ || echo "RD 폴더 참조 없음(OK)"
```
Expected: 둘 다 잔존 없음.

- [ ] **Step 5: 커밋**

```bash
git add skills/sl-init/
git commit -m "refactor: sl-init MODE 작성/검증 제거 + 01_요구사항정의서 폴더 폐기

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: MODE 게이트/전달 제거 — sl-recon, sl-recon-uis

**Files:** `skills/sl-recon/SKILL.md`, `skills/sl-recon-uis/SKILL.md`

- [ ] **Step 1: sl-recon MODE 진입 게이트 제거**

`skills/sl-recon/SKILL.md`:
- 라인 11 `RECON 모드 (project.env의 MODE=RECON)에서 실행합니다.` → `현행 소스를 역분석해 스펙(INF/SCH/UIS)을 생성한다.` 로 교체.
- 라인 19 `MODE=RECON이 아니면 실행을 중단하고 /sl-init으로 모드 재설정을 안내한다.` 줄 **삭제**.

- [ ] **Step 2: 에이전트로 넘기던 `MODE: RECON` 줄 제거**

`skills/sl-recon/SKILL.md` 라인 358, 936, 1018의 `MODE: RECON` 프롬프트 줄을 삭제한다(에이전트가 항상 RECON 동작). `skills/sl-recon-uis/SKILL.md` 라인 1283의 `MODE: RECON`도 삭제.

- [ ] **Step 3: 무결성 게이트**

```bash
grep -rn "MODE: RECON\|MODE=RECON\|MODE=GENESIS" skills/sl-recon/SKILL.md skills/sl-recon-uis/SKILL.md | grep -v "POC_MODE" || echo "MODE 분기 없음(OK)"
# POC_MODE 보존 확인
grep -c "POC_MODE" skills/sl-recon/SKILL.md
```
Expected: MODE 분기 없음 + POC_MODE 카운트 > 0(보존).

- [ ] **Step 4: 커밋**

```bash
git add skills/sl-recon/SKILL.md skills/sl-recon-uis/SKILL.md
git commit -m "refactor: sl-recon/uis MODE 게이트·에이전트 MODE 전달 제거 (POC_MODE 유지)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: linked_req 분기 제거 — 항상 linked_func

**Files:** `skills/sl-aidd/SKILL.md`, `skills/sl-dev/SKILL.md`, `skills/sl-test/SKILL.md`, `skills/sl-rtm/SKILL.md`

- [ ] **Step 1: 각 스킬에서 MODE 읽기 + GENESIS 분기 제거**

- `sl-aidd/SKILL.md`(29-30), `sl-dev/SKILL.md`(52-53,70), `sl-test/SKILL.md`(25-26,43,85), `sl-rtm/SKILL.md`(53,129): `mode = env.get('MODE', 'GENESIS')` 및 그 출력/분기를 제거한다.
- 코드 주석 삽입 규칙을 **항상 `linked_func: FUNC-{도메인}-NNN`** 으로 단일화한다(GENESIS의 `linked_req: REQ-F-XXX` 삽입 분기 삭제).
- "project.env의 MODE를 확인하라"(sl-dev:70, sl-test:43) 류 지시문 제거.

- [ ] **Step 2: 무결성 게이트**

```bash
grep -rn "env.get('MODE'\|linked_req\|REQ-F\|MODE=" skills/sl-aidd/SKILL.md skills/sl-dev/SKILL.md skills/sl-test/SKILL.md skills/sl-rtm/SKILL.md | grep -v "POC_MODE" || echo "MODE/REQ 분기 없음(OK)"
grep -c "linked_func" skills/sl-dev/SKILL.md
```
Expected: 분기 없음 + linked_func 보존.

- [ ] **Step 3: 커밋**

```bash
git add skills/sl-aidd/SKILL.md skills/sl-dev/SKILL.md skills/sl-test/SKILL.md skills/sl-rtm/SKILL.md
git commit -m "refactor: aidd/dev/test/rtm — MODE 분기 제거, 항상 linked_func

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: ddd-api/db/ui-agent — 크로스링크 RECON만 + MODE 입력 제거

**Files:** `agents/ddd-api-agent.md`, `agents/ddd-db-agent.md`, `agents/ddd-ui-agent.md`

- [ ] **Step 1: 크로스링크 블록 GENESIS 줄 제거**

각 에이전트의 크로스링크 예시에서 `> GENESIS: **REQ-F:** … | **SRS-F:** … | **API:** …` 줄을 **삭제**하고, `> RECON: **FUNC-ID:** … | **API:** …` 줄만 남긴다. (예: ddd-db-agent의 3-2 본문 구조 크로스링크 블록 — 현재 GENESIS/RECON 2줄 → RECON 1줄)

- [ ] **Step 2: MODE 입력 제거**

`agents/ddd-api-agent.md` 라인 43 `MODE: {RECON | GENESIS}` 입력 항목을 삭제(항상 RECON). ddd-db/ui에 `MODE` 입력 언급 있으면 동일 제거.

- [ ] **Step 3: 무결성 게이트**

```bash
grep -rn "GENESIS\|REQ-F\|MODE:" agents/ddd-api-agent.md agents/ddd-db-agent.md agents/ddd-ui-agent.md || echo "GENESIS/REQ/MODE 없음(OK)"
grep -rn "FUNC-ID\|linked_func\|RECON:" agents/ddd-db-agent.md | head -2   # RECON 경로 보존 확인
```
Expected: GENESIS/REQ/MODE 없음 + RECON 크로스링크 보존.

- [ ] **Step 4: 커밋**

```bash
git add agents/ddd-api-agent.md agents/ddd-db-agent.md agents/ddd-ui-agent.md
git commit -m "refactor: ddd-* 에이전트 크로스링크 RECON(FUNC-ID)만 + MODE 입력 제거

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: 공유 에이전트 GENESIS 경로 제거 (RECON 보존) — rd/srs/spec/sad/rtm

**Files:** `agents/rd-agent.md`, `agents/srs-agent.md`, `agents/spec-agent.md`, `agents/sad-agent.md`, `agents/rtm-agent.md`

> ⚠️ **이 Task의 핵심 불변식:** 각 에이전트의 **RECON 동작 블록은 절대 삭제하지 않는다.** GENESIS 전용 섹션/분기만 들어낸다.

- [ ] **Step 1: rd-agent — GENESIS RD/REQ 생성 경로 삭제, RECON FUNC 생성 보존**

`agents/rd-agent.md`에서 GENESIS의 RD(요구사항정의서)·REQ-F 역추출/생성 섹션을 제거하고, **RECON 모드의 FUNC/FUNC_MAP 생성(인덱스 포맷팅) 경로만** 남긴다. frontmatter description도 RECON 전용으로.

- [ ] **Step 2: srs-agent — GENESIS 상세화 경로 삭제, RECON 집약 보존**

GENESIS(CoT+Reflexion 상세화) 분기 제거, **RECON(use-case 사실 집약) 경로 유지**.

- [ ] **Step 3: spec-agent — GENESIS Phase REQ 역합성 삭제, RECON Phase-A/C 보존**

Phase-A(SAD+도메인 확정)·Phase-C(색인) RECON 경로 유지. GENESIS 전용 REQ 역합성/RD 관련 지시 제거.

- [ ] **Step 4: sad-agent — REQ-NF 참조 제거**

아키텍처 설계 본문은 유지하되 `REQ-NF`/요구사항 링크 참조를 SRS/FUNC 기반으로 정리.

- [ ] **Step 5: rtm-agent — REQ→FUNC 매핑 제거, FUNC 기반 RTM/FUNC_MAP 유지**

REQ 컬럼·REQ→FUNC 매핑 로직 제거. `FUNC-ID → SRS → UIS/INF/SCH → 코드 → TC` 체인만.

- [ ] **Step 6: 무결성 게이트 (RECON 보존 동시 확인)**

```bash
echo "[GENESIS/REQ 잔존?]"; grep -rn "GENESIS\|REQ-F\|REQ-NF\|요구사항정의서\|RD_v1.0" agents/rd-agent.md agents/srs-agent.md agents/spec-agent.md agents/sad-agent.md agents/rtm-agent.md || echo "  없음(OK)"
echo "[RECON 경로 보존?]"; grep -l "RECON\|FUNC" agents/rd-agent.md agents/srs-agent.md agents/spec-agent.md agents/rtm-agent.md
```
Expected: GENESIS/REQ 없음 + 4개 파일 모두 RECON/FUNC 보존.

- [ ] **Step 7: 커밋**

```bash
git add agents/rd-agent.md agents/srs-agent.md agents/spec-agent.md agents/sad-agent.md agents/rtm-agent.md
git commit -m "refactor: 공유 에이전트 GENESIS 경로 제거 (rd/srs/spec/sad/rtm) — RECON 동작 보존

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: CLAUDE.md 정리

**Files:** `CLAUDE.md`

- [ ] **Step 1: 라우팅표**

- `/sl-genesis` 행 삭제. 표의 `모드` 열에서 GENESIS 값 제거(전부 RECON/DELTA/SDD로 정리하거나 모드 열 자체를 단순화).

- [ ] **Step 2: 모드 분기 / REQ 원칙 / 파이프라인 / 서브에이전트 표**

- "환경 분기"·"산출물 타입"에서 GENESIS 전제 제거.
- **"REQ-ID 원칙(납품·계약용, GENESIS 한정)" 섹션 전체 삭제.**
- "FUNC-ID 체이닝 원칙"은 유지하되 REQ→FUNC 매핑 문구 제거. 추적 주석 표에서 GENESIS 행 삭제(RECON `linked_func`만).
- "상황별 파이프라인" 표에서 GENESIS 행(새 프로젝트 GENESIS 등) 삭제.
- "서브에이전트 조율" 표에서 `모델 (GENESIS)` 열 삭제(단일 모델 열로).

- [ ] **Step 3: 무결성 게이트**

```bash
grep -n "GENESIS\|REQ-F\|REQ-NF\|REQ-ID 원칙\|sl-genesis" CLAUDE.md | grep -v "^.*v2\.\|^.*v3\." || echo "GENESIS/REQ 본문 없음(OK, 이력노트 제외)"
```
Expected: 버전 이력 노트 외 0건.

- [ ] **Step 4: 커밋**

```bash
git add CLAUDE.md
git commit -m "refactor: CLAUDE.md GENESIS/REQ 라우팅·원칙·파이프라인·모델표 정리

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: 템플릿 정리

**Files:** `templates/SPEC_CONVENTIONS.md`, `templates/{INF는 없음→API_Design, SCH=DB_Schema, UI_Spec_v1.0, RTM, SAD, SRS, TC, TR}_template.md`

- [ ] **Step 1: GENESIS/REQ 분기 제거**

각 템플릿의 `> GENESIS: **REQ-F:** …` 류 크로스링크 줄과 `REQ-F`/`REQ-NF` 링크를 제거하고 RECON(FUNC) 형태만 남긴다. `SPEC_CONVENTIONS.md`의 GENESIS 모드 설명/REQ 규약 제거.

- [ ] **Step 2: 무결성 게이트**

```bash
grep -rn "GENESIS\|REQ-F\|REQ-NF\|요구사항정의서" templates/ | grep -v "RD_template" || echo "템플릿 GENESIS/REQ 없음(OK)"
```
Expected: 0건.

- [ ] **Step 3: 커밋**

```bash
git add templates/
git commit -m "refactor: 템플릿 GENESIS/REQ 분기 제거 (FUNC 기반만)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: 스크립트 + SpecLens 가이드 + 사용자 문서

**Files:** `scripts/merge_index.py`, `scripts/func_context_bundle.py`, `docs/viewer/docsify-sl.js`, `README.md`, `docs/SETUP_GUIDE.md`

- [ ] **Step 1: 스크립트 REQ 참조 제거**

`scripts/merge_index.py`, `scripts/func_context_bundle.py`에서 REQ-F/REQ 섹션 수집·출력 로직을 제거한다(INF/SCH/UIS/FUNC만). 함수 시그니처가 바뀌면 호출부도 정리.

- [ ] **Step 2: SpecLens 가이드에서 GENESIS 제거**

`docs/viewer/docsify-sl.js`:
- `GUIDE_PIPELINES`에서 GENESIS 파이프라인(🆕 새 프로젝트 GENESIS 등) 항목 삭제.
- `GUIDE_MODES`에서 `['GENESIS', …]` 행 삭제(RECON/DELTA만).
- 가이드 본문 중 REQ/GENESIS 언급 정리. `GUIDE_CATEGORIES`의 GENESIS 명령어(/sl-genesis) 제거.

- [ ] **Step 3: README/SETUP_GUIDE 정리**

`README.md`·`docs/SETUP_GUIDE.md`에서 sl-genesis 스킬 트리 항목·GENESIS 파이프라인·REQ 설명 제거.

- [ ] **Step 4: 무결성 게이트**

```bash
node --check docs/viewer/docsify-sl.js && echo "JS 문법 OK"
python -c "import ast; ast.parse(open('scripts/merge_index.py',encoding='utf-8').read()); ast.parse(open('scripts/func_context_bundle.py',encoding='utf-8').read()); print('PY 문법 OK')"
grep -rn "GENESIS\|REQ-F\|sl-genesis" scripts/merge_index.py scripts/func_context_bundle.py docs/viewer/docsify-sl.js README.md docs/SETUP_GUIDE.md || echo "GENESIS/REQ 없음(OK)"
```
Expected: 문법 OK + GENESIS 없음.

- [ ] **Step 5: 커밋**

```bash
git add scripts/merge_index.py scripts/func_context_bundle.py docs/viewer/docsify-sl.js README.md docs/SETUP_GUIDE.md
git commit -m "refactor: 스크립트 REQ 참조·SpecLens 가이드 GENESIS·문서 정리

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: plugin.json description + 버전 + 최종 무결성 게이트

**Files:** `.claude-plugin/plugin.json`, `CLAUDE.md`, (확인) `docs/RECON_PIPELINE.md`

- [ ] **Step 1: plugin.json description SM 중심으로**

`.claude-plugin/plugin.json`의 `description`을
`"SM(운영 시스템) 스펙 역생성 + AIDD 자동화 — 현행 소스에서 INF/SCH/UIS/FUNC 역추출, FUNC-ID 체이닝, 변경관리(SR)."`
로 교체. `version`을 `3.0.0`으로(메이저 — 플러그인 방향 전환).

- [ ] **Step 2: CLAUDE.md 버전 노트**

```
> v3.0.0: SM 전용 전환 — GENESIS 모드·REQ-ID/RD·MODE 개념 전면 제거. 추적 축=FUNC-ID(RECON)+SR(DELTA). sl-genesis/RD_template 삭제, 공유 에이전트(rd/srs/spec/sad/rtm) RECON 경로만 보존, 항상 linked_func. SI(신규구축)용은 별도 플러그인.
```

- [ ] **Step 3: RECON_PIPELINE.md GENESIS 잔존 확인**

```bash
grep -n "GENESIS\|REQ-F" docs/RECON_PIPELINE.md || echo "RECON_PIPELINE GENESIS 없음(OK)"
```
있으면 RECON 기준으로 정리.

- [ ] **Step 4: 최종 무결성 게이트 (전체)**

```bash
cd D:/gen-harness/plugins/speclinker
echo "[1] GENESIS/REQ/MODE 잔존 (이력노트·POC_MODE 제외, 0이어야 함)"
grep -rn "GENESIS\|REQ-F\|REQ-NF\|요구사항정의서\|RD_v1.0\|RD_template\|linked_req\|MODE=GENESIS\|env.get('MODE'" skills agents scripts templates docs README.md CLAUDE.md 2>/dev/null | grep -v "docs/superpowers/" | grep -v "POC_MODE" | grep -vE "v[23]\.[0-9]" || echo "  잔존 없음 ✅"
echo "[2] 남은 스킬 목록 (sl-genesis 없어야)"; ls skills/ | tr '\n' ' '; echo
echo "[3] plugin.json 유효 + skills 정합"
python -c "import json; d=json.load(open('.claude-plugin/plugin.json',encoding='utf-8')); import os; miss=[s for s in d['skills'] if not os.path.isdir(s.lstrip('./'))]; print('version', d['version'],'| 누락 스킬', miss)"
echo "[4] RECON 보존 — 공유 에이전트 RECON/FUNC 존재"
grep -l "FUNC" agents/rd-agent.md agents/srs-agent.md agents/spec-agent.md agents/rtm-agent.md | wc -l
```
Expected: [1] 잔존 없음 / [2] sl-genesis 없음 / [3] version 3.0.0 + 누락 스킬 [] / [4] = 4.

- [ ] **Step 5: 커밋 + 푸시**

```bash
git add .claude-plugin/plugin.json CLAUDE.md docs/RECON_PIPELINE.md
git commit -m "feat: SM 전용 전환 완료 v3.0.0 — GENESIS/REQ/MODE 제거 + description 갱신

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Self-Review (작성자 체크)

- **Spec 커버리지:** §3-1 삭제→T1, §3-2 분기제거→T2~T9, §4 MODE 폐기→T2/T3/T4/T5, §5 description→T10, §6 검증게이트→각 Task grep + T10 최종게이트. 갭 없음.
- **불변식:** RECON 보존을 T3/T5/T6/T10에서 grep으로 확인. POC_MODE 보존을 T2/T3에서 명시 확인. 공유 에이전트 미삭제(T6 경고).
- **Placeholder:** 각 Task에 구체 파일·라인·grep·커밋. "적절히" 류 없음.
- **순서 안전:** 독립 스킬 삭제(T1) → MODE(T2-4) → 에이전트(T5-6) → 메타문서(T7-9) → 최종 게이트/버전(T10). 중간 단계마다 grep 게이트로 깨짐 조기 발견.
