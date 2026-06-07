---
name: sl-aidd
description: FUNC = story 단위 BMAD AIDD 루프 — story 생성→사람 승인→dev-agent 구현→qa-agent 게이트→test-agent→사람 확인→상태갱신을 FUNC-ID 단위로 반복.
triggers:
  - /sl-aidd
---

# /sl-aidd — BMAD story 루프

FUNC를 story로 다루어, 각 FUNC에 대해 [story 생성 → ✋승인 → 구현 → QA 게이트 → 테스트 → ✋확인 → 상태갱신]을
순차 실행한다. 구 `sl-dev`(구현)·`sl-check`(착수 게이트)·`sl-review`(리뷰) 로직을 이 루프가 흡수했다.

## 호출 형식

| 형식 | 용도 |
|------|------|
| `/sl-aidd` | Ready 상태 FUNC 전체(INF 있고 코드 없음) |
| `/sl-aidd FUNC-order-001` | 특정 FUNC 하나 |
| `/sl-aidd --list` | FUNC 목록 + 상태 |
| `/sl-aidd --status` | 전체 커버리지 현황 |

## 사람 승인 지점 (BMAD 정석 — 자동 폭주 금지)

1. **story 승인** (STEP 2): story 요약을 사람에게 제시 → 승인해야 구현 착수.
2. **QA FAIL 처리** (STEP 4): 게이트 FAIL시 필수 수정 목록 제시 → 사람이 재작업/중단 결정.
3. **최종 확인** (STEP 6): QA/테스트 결과 사람 확인 → Done 전이.

---

## STEP 0 — 사전 확인

```python
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import os, re
func_map = 'docs/00_FUNC/FUNC_MAP.md'
if os.path.exists(func_map):
    content = open(func_map, encoding='utf-8').read()
    func_ids = re.findall(r'## (FUNC-[\w-]+)', content)
    done = content.count('✅')
    print(f'FUNC_MAP: {len(func_ids)}개 FUNC, {done}개 완료')
else:
    print('FUNC_MAP 없음 → /sl-recon 먼저 실행하세요')
"
```

FUNC_MAP이 없으면 중단하고 `/sl-recon` 안내.

---

## STEP 1 — 대상 FUNC 결정

`/sl-aidd` (Ready 전체):

```python
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import os, sys, subprocess, json
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'func_context_bundle.py')
r = subprocess.run([sys.executable, script, '--ready', '.'], capture_output=True, text=True)
ready = json.loads(r.stdout)
print(f'구현 예정 FUNC: {len(ready)}개')
for f in ready:
    print(f'  {f[\"id\"]}: {f[\"description\"]}')
"
```

대상이 10개를 초과하면 사용자에게 우선순위/배치를 확인 후 진행.
`/sl-aidd --list`는 STEP 1 대신 목록만 출력(맨 아래 참조).

---

## STEP 2~6 — FUNC(=story)별 순차 루프

선택된 각 FUNC에 대해 **순서대로** 아래를 반복한다.

### STEP 2 — SM: story 생성 + ✋승인

```python
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import os, sys, subprocess, json
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'build_story.py')
func_id = '{FUNC_ID}'  # ← 현재 FUNC-ID
r = subprocess.run([sys.executable, script, func_id, '.'], capture_output=True, text=True)
print(r.stdout or r.stderr)
"
```

생성된 `docs/00_FUNC/stories/STORY-{FUNC_ID}.md`를 읽어 **Story·수용 기준·컨텍스트 요약**을 사용자에게 제시하고 승인을 받는다.

> 🟢 사용자 승인 게이트
> - 위 story로 구현을 진행할까요? (승인 / 수정요청 / 건너뛰기)
> - 승인 → story frontmatter `status: Draft` → `Approved` 로 갱신 후 STEP 3.
> - 수정요청 → 컨텍스트/수용기준 보완 후 재제시.
> - 건너뛰기/중단 → 이 FUNC 스킵.

### STEP 3 — Dev: dev-agent(서브) 구현

story를 컨텍스트로 dev-agent에 위임 (TDD). story status `Approved` → `InProgress` → (구현 완료) `Review`.

> dev-agent에게:
> - FUNC-ID: `{FUNC_ID}`
> - story 파일: `docs/00_FUNC/stories/STORY-{FUNC_ID}.md` (수용 기준 + 자기완결 컨텍스트 — INF/SCH/UIS 요약·링크 포함)
> - linked_func 주석(`linked_func: {FUNC_ID}`)을 모든 생성 파일에 삽입.
> - 이 FUNC에 해당하는 코드만 생성한다. 다른 FUNC는 건드리지 않는다.
> - 완료 후 story `## Dev 기록`에 생성/수정 파일과 주요 결정을 기록.

### STEP 4 — QA: qa-agent(서브) 게이트

dev와 **분리된 컨텍스트**로 qa-agent를 호출한다.

> qa-agent에게:
> - story 파일 + dev-agent 산출 파일 목록/내용 + 연결 INF 스펙 본문.
> - 3-Layer(스펙·보안·회귀) 검증 후 PASS/CONCERNS/FAIL 판정을 story `## QA 결과`에 append.

판정 처리:
- **PASS / CONCERNS** → STEP 5로.
- **FAIL** → 필수 수정 목록을 사용자에게 제시.
  > 🟠 QA FAIL 게이트 — 재작업할까요? (재작업 / 중단)
  > - 재작업 → story status `Review` → `InProgress`, 수정 목록을 dev-agent에 피드백하여 STEP 3 재실행.
  > - 중단 → 이 FUNC 보류(status 유지), 다음 FUNC로.

### STEP 5 — Test: test-agent(서브) TC 실행

> test-agent에게: 이 FUNC의 단위/통합 TC 작성·실행. 결과(통과/실패 수, 커버리지)를 story에 기록.

테스트 실패 시 STEP 4 FAIL과 동일하게 사용자 확인 후 재작업 또는 보류.

### STEP 6 — ✋최종 확인 + 상태갱신

> 🟢 최종 확인 게이트 — QA={판정}, 테스트={통과/실패}. 이 FUNC를 완료 처리할까요? (완료 / 보류)

완료 시:

```python
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import os, sys, subprocess
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'req_scan.py')
if os.path.exists(script):
    r = subprocess.run([sys.executable, script, '.'], capture_output=True, text=True)
    print(r.stdout)
"
```

그리고:
- story frontmatter `status` → `Done`
- `docs/00_FUNC/FUNC_MAP.md` 해당 FUNC `구현상태: ✅ 완료`
- `→ 다음 FUNC로 반복`

---

## STEP 7 — 최종 커버리지 리포트

```python
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import os, json, re
func_map = 'docs/00_FUNC/FUNC_MAP.md'
cache_path = '.understand-anything/linked-func-cache.json'
if not os.path.exists(func_map):
    print('FUNC_MAP 없음')
else:
    content = open(func_map, encoding='utf-8').read()
    func_ids = set(re.findall(r'## (FUNC-[\w-]+)', content))
    linked = set()
    if os.path.exists(cache_path):
        cache = json.load(open(cache_path, encoding='utf-8'))
        for ids in cache.values():
            linked.update(ids)
    covered = func_ids & linked
    pct = int(len(covered)/len(func_ids)*100) if func_ids else 0
    print(f'FUNC 커버리지: {len(covered)}/{len(func_ids)} ({pct}%)')
    uncovered = sorted(func_ids - linked)
    if uncovered:
        print(f'미구현 FUNC ({len(uncovered)}개): ' + ', '.join(uncovered))
    else:
        print('모든 FUNC 구현 완료 ✅')
"
```

---

## `/sl-aidd --list` — FUNC 목록

```python
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import os, sys, subprocess, json
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'func_context_bundle.py')
r = subprocess.run([sys.executable, script, '--list', '.'], capture_output=True, text=True)
funcs = json.loads(r.stdout)
print(f'총 {len(funcs)}개 FUNC:')
for f in funcs:
    flag = '✅' if '완료' in f['status'] else '🔄' if '구현중' in f['status'] else '⬜'
    inf_mark = '📋' if f['has_inf'] else '  '
    print(f'  {flag} {inf_mark} {f[\"id\"]}: {f[\"description\"]}')
"
```

---

## 완료 안내

```
/sl-aidd 완료

구현된 FUNC: {N}개 (story Done)
QA 게이트: PASS {p} / CONCERNS {c} / FAIL {f}
테스트 통과: {M}개
FUNC 커버리지: {%}%

story: docs/00_FUNC/stories/
대시보드: SpecLens(/sl-viewer)에서 커버리지 확인
다음 단계: /sl-test --perf (성능) 또는 납품
```
