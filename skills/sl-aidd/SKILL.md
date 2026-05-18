---
name: sl-aidd
description: FUNC 단위 AI 개발 파이프라인 — 컨텍스트 번들 자동수집 → 코드 생성 → 테스트 → 커버리지 갱신을 FUNC-ID 단위로 반복 실행. GENESIS·RECON 공통.
triggers:
  - /sl-aidd
---

# /sl-aidd — FUNC 단위 AIDD 파이프라인

FUNC-ID 하나(또는 전체)를 지정하면 스펙 수집 → 코드 생성 → 테스트 → 커버리지 갱신을 자동으로 처리합니다.

## 호출 형식

| 형식 | 용도 |
|------|------|
| `/sl-aidd` | Ready 상태 FUNC 전체 구현 (INF 있고 코드 없음) |
| `/sl-aidd FUNC-order-001` | 특정 FUNC 하나만 구현 |
| `/sl-aidd --list` | FUNC 목록 + 상태 확인 |
| `/sl-aidd --status` | 전체 커버리지 현황 |

---

## STEP 0 — 사전 확인

```python
!python3 -c "
import os, json
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
mode = env.get('MODE', 'GENESIS')
print(f'MODE={mode}')

func_map = 'docs/00_FUNC/FUNC_MAP.md'
if os.path.exists(func_map):
    import re
    content = open(func_map, encoding='utf-8').read()
    func_ids = re.findall(r'## (FUNC-[\w-]+)', content)
    done = content.count('✅')
    print(f'FUNC_MAP: {len(func_ids)}개 FUNC, {done}개 완료')
else:
    print('FUNC_MAP 없음')
    if mode == 'GENESIS':
        print('→ /sl-genesis 먼저 실행하세요')
    else:
        print('→ /sl-recon 먼저 실행하세요')
"
```

FUNC_MAP이 없으면 중단하고 안내한다.

---

## STEP 1 — 대상 FUNC 결정

### `/sl-aidd` (Ready 전체):

```python
!python3 -c "
import os, sys, subprocess, json
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'func_context_bundle.py')
if os.path.exists(script):
    r = subprocess.run([sys.executable, script, '--ready', '.'], capture_output=True, text=True)
    ready = json.loads(r.stdout)
    print(f'구현 예정 FUNC: {len(ready)}개')
    for f in ready:
        print(f'  {f[\"id\"]}: {f[\"description\"]}')
"
```

대상이 10개를 초과하면 사용자에게 우선순위 확인 후 진행.

### `/sl-aidd FUNC-order-001` (단일):

```python
!python3 -c "
import os, sys, subprocess, json
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'func_context_bundle.py')
func_id = 'FUNC-order-001'  # ← 지정된 FUNC-ID
if os.path.exists(script):
    r = subprocess.run([sys.executable, script, func_id, '.'], capture_output=True, text=True)
    bundle = json.loads(r.stdout)
    print(json.dumps(bundle, ensure_ascii=False, indent=2))
"
```

---

## STEP 2 — FUNC별 코드 생성 루프

각 대상 FUNC에 대해 순서대로:

### 2-A. 컨텍스트 번들 수집

```python
!python3 -c "
import os, sys, subprocess, json
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'func_context_bundle.py')
func_id = '{FUNC_ID}'  # ← 현재 처리 중인 FUNC-ID
r = subprocess.run([sys.executable, script, func_id, '.'], capture_output=True, text=True)
bundle = json.loads(r.stdout)
# bundle['spec_content']['inf'], ['sch'], ['uis'] 로 스펙 파일 내용 접근
print(f'번들 수집 완료: {func_id}')
print(f'INF: {list(bundle[\"spec_content\"][\"inf\"].keys())}')
print(f'SCH: {list(bundle[\"spec_content\"][\"sch\"].keys())}')
print(f'UIS: {list(bundle[\"spec_content\"][\"uis\"].keys())}')
"
```

### 2-B. dev-agent에 위임

> dev-agent에게 (AIDD 모드):
> - FUNC-ID: `{FUNC_ID}`
> - 설명: `{bundle.description}`
> - 모드: `{bundle.mode}`
> - 추적 주석: `{bundle.annotation}`
> - 연결 스펙: `bundle.spec_content` (INF/SCH/UIS 파일 내용 첨부)
> - 기존 구현 파일: `{bundle.implemented_files}` (있으면 패턴 참고)
> - 이 FUNC에 해당하는 코드만 생성하라. 다른 FUNC는 건드리지 않는다.

### 2-C. 커버리지 갱신

코드 생성 완료 후:

```python
!python3 -c "
import os, sys, subprocess
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'req_scan.py')
if script and os.path.exists(script):
    r = subprocess.run([sys.executable, script, '.'], capture_output=True, text=True)
    print(r.stdout)
"
```

### 2-D. FUNC_MAP 상태 업데이트

`docs/00_FUNC/FUNC_MAP.md`에서 해당 FUNC 항목의 구현상태를 업데이트:
- 코드 생성됨: `구현상태: 🔄 구현중`
- 테스트 통과: `구현상태: ✅ 완료`

---

## STEP 3 — 테스트 실행

```python
!python3 -c "
import os, sys, subprocess
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'run_tests.py')
if script and os.path.exists(script):
    r = subprocess.run([sys.executable, script, '.'])
    sys.exit(r.returncode)
"
```

테스트 실패 시:
- 실패 내역을 dev-agent에 피드백하여 수정 요청
- 수정 후 STEP 2-C부터 재실행

---

## STEP 4 — 최종 커버리지 리포트

```python
!python3 -c "
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
        print(f'미구현 FUNC ({len(uncovered)}개):')
        for fid in uncovered:
            print(f'  - {fid}')
    else:
        print('모든 FUNC 구현 완료 ✅')
"
```

---

## `/sl-aidd --list` — FUNC 목록

```python
!python3 -c "
import os, sys, subprocess, json
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'func_context_bundle.py')
if os.path.exists(script):
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

구현된 FUNC: {N}개
테스트 통과: {M}개
FUNC 커버리지: {%}%

대시보드: run-dashboard.ps1 → SDD 탭에서 커버리지 확인
다음 단계: /sl-test --perf (성능 테스트) 또는 납품
```
