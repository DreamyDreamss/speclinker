---
name: sl-recon-uis
description: RECON Phase-2 — BFS 메뉴 탐색 + 화면 캡처 + UIS 설계서 생성 (STEP 6). /sl-recon 완료 후 실행.
triggers:
  - /sl-recon-uis
---

# /sl-recon-uis — 화면 설계서 생성

## 실행 전 확인

```bash
!python3 -c "
import json, os, sys

errors = []
domain_plan = 'docs/05_설계서/_domain_plan.json'
checkpoint  = '_tmp/recon_checkpoint.json'

if not os.path.exists(checkpoint):
    errors.append('[FAIL] recon_checkpoint.json 없음 — /sl-recon 먼저 실행')
if not os.path.exists(domain_plan):
    errors.append('[FAIL] _domain_plan.json 없음 — /sl-recon STEP 3 확인')

if errors:
    for e in errors: print(e)
    sys.exit(1)

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
domains = json.load(open(domain_plan, encoding='utf-8')).get('domains', [])
base_url = env.get('PREVIEW_BASE_URL', '')
cdp_port = env.get('PREVIEW_CDP_PORT', '9222')

print(f'[OK] 도메인 {len(domains)}개')
print(f'     PREVIEW_BASE_URL : {base_url or \"미설정\"}')
print(f'     CDP 포트          : {cdp_port}')
if not base_url:
    print()
    print('[주의] PREVIEW_BASE_URL 미설정 → BFS 탐색만 가능, 캡처 스킵')
    print('       project.env에 PREVIEW_BASE_URL=https://... 추가하면 캡처 활성화됩니다.')
else:
    print('[OK] PREVIEW_BASE_URL 설정됨 → STEP 6-0에서 Chrome 자동 실행·이동 처리')
"
```

---

### STEP 6-0: Chrome CDP 포트 확인 + 자동 실행 → BFS 메뉴 계층 탐색

Chrome이 아직 안 켜져 있으면 **자동으로 실행**하고 `PREVIEW_BASE_URL`로 이동한다.  
로그인이 필요하면 **Chrome 창에서 직접 로그인**하면 감지 후 자동 재개된다.  
이미 Chrome이 CDP 포트로 열려있으면 그대로 attach해서 진행한다.

```bash
!python3 -c "
import os, subprocess, sys, socket, time, platform

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
plugin   = env.get('PLUGIN_PATH', '')
cdp_port = env.get('PREVIEW_CDP_PORT', '9222')
base_url = env.get('PREVIEW_BASE_URL', '')
ws       = os.getcwd()

def cdp_alive(port):
    try:
        s = socket.create_connection(('localhost', int(port)), timeout=1)
        s.close()
        return True
    except:
        return False

# ── Chrome 자동 실행 ──────────────────────────────────────────────────────────
if not cdp_alive(cdp_port):
    print(f'[bfs] Chrome CDP 포트 {cdp_port} 닫혀있음 → Chrome 자동 실행')

    plat = platform.system()
    if plat == 'Windows':
        subprocess.Popen(
            ['powershell', '-Command',
             f'Start-Process chrome -ArgumentList \"--remote-debugging-port={cdp_port}\"'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
    elif plat == 'Darwin':
        subprocess.Popen(
            ['open', '-a', 'Google Chrome', '--args', f'--remote-debugging-port={cdp_port}'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
    else:
        subprocess.Popen(
            ['google-chrome', f'--remote-debugging-port={cdp_port}'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )

    print('Chrome 시작 대기 중', end='', flush=True)
    for _ in range(30):
        time.sleep(1)
        print('.', end='', flush=True)
        if cdp_alive(cdp_port):
            print(' 준비 완료!')
            break
    else:
        print()
        print('[ERROR] Chrome 30초 내 시작 안 됨.')
        print('  Chrome이 설치되어 있는지 확인하거나, 직접 실행 후 재시도하세요.')
        sys.exit(1)
else:
    print(f'[bfs] Chrome CDP 포트 {cdp_port} 이미 열려있음 — 기존 세션 재사용')

# ── BFS 트리 추출 ─────────────────────────────────────────────────────────────
script = os.path.join(plugin, 'scripts', 'bfs_navigator.js') if plugin else ''
if not (script and os.path.exists(script)):
    print('[ERROR] bfs_navigator.js 없음 — PLUGIN_PATH 확인')
    sys.exit(1)

os.makedirs('_tmp', exist_ok=True)
print(f'\\n[bfs] --tree-only 탐색 시작 (base_url={base_url or \"project.env로부터 자동 이동\"})')

r = subprocess.run(
    ['node', script,
     f'--port={cdp_port}',
     '--tree-only',
     '--max-depth=6',
     f'--out=_tmp',
     f'--workspace={ws}'],
    capture_output=True, text=True, encoding='utf-8', errors='ignore'
)
print(r.stderr[-3000:] if len(r.stderr) > 3000 else r.stderr)
if r.returncode != 0:
    print('[ERROR] BFS 트리 추출 실패.')
    print('  → 로그인이 필요한 경우: Chrome 창에서 직접 로그인 후 이 단계를 다시 실행하세요.')
    sys.exit(1)

import json
hier = json.load(open('_tmp/screen_hierarchy.json', encoding='utf-8'))
print(f'\\n[결과] L1 메뉴 {hier[\"stats\"][\"l1Count\"]}개 / 전체 노드 {hier[\"stats\"][\"totalNodes\"]}개')
"
```

> **로그인 흐름:**
> 1. STEP 6-0 실행 → Chrome 자동 실행 → `PREVIEW_BASE_URL` 자동 이동 (bfs_navigator 내부 처리)
> 2. 로그인 페이지로 리디렉션된 경우 → Chrome 창에서 직접 로그인
> 3. 로그인 완료 감지(URL 변경) → BFS 탐색 자동 재개
> 4. 이후 Chrome을 닫지 않는 한 STEP 6-1~6-2 캡처도 같은 세션 재사용

---

### ✋ STEP 6-0.5: 계층 검토 + 탐색 범위 선택 (필수 체크포인트)

추출된 메뉴 계층을 사용자에게 출력하고, **어떤 범위를 탐색·캡처할지 확인**한다.

```bash
!python3 -c "
import json, os

hier = json.load(open('_tmp/screen_hierarchy.json', encoding='utf-8'))
tree = hier.get('tree', [])

def print_tree(nodes, indent=0):
    for n in nodes:
        children = n.get('children', [])
        marker = '▷' if children else '•'
        prefix = '  ' * indent
        href = f'  ({n.get(\"href\",\"\")})' if n.get('href') and n['href'] not in ('#','javascript:void(0)','') else ''
        print(f'{prefix}{marker} {n[\"text\"]}{href}')
        if children:
            print_tree(children, indent + 1)

print('=' * 60)
print('메뉴 계층 구조')
print('=' * 60)
print_tree(tree)
print()
print('L1 메뉴 목록:')
for i, n in enumerate(tree, 1):
    cnt = len(n.get('children', []))
    print(f'  {i:2}. {n[\"text\"]}  (하위 {cnt}개)')
print()
print('[선택 방법]')
print('  전체 탐색  : \"all\" 또는 번호 없이 \"계속\"')
print('  특정 L1    : L1 메뉴명 또는 번호 (예: \"상품관리\" 또는 \"1,2,3\")')
print('  L2까지만  : \"상품관리/상품등록\"  (/ 구분)')
print()
print('[현재 탐색 범위 변경 불필요 시]')
print('  기존 _tmp/bfs_scope_selection.json 있으면 재사용 여부도 확인하세요.')
"
```

사용자 응답을 받아 탐색 범위를 결정한다:
- **"all" / "계속"** → L1 전체 탐색
- **번호 (예: "1,3,5")** → 해당 L1 번호만 선택
- **이름 (예: "상품관리,주문관리")** → 해당 L1 이름만 선택
- **"상품관리/상품등록"** → L2 단위 스코프

선택 결과를 `_tmp/bfs_scope_selection.json`에 저장한다:

```bash
!python3 -c "
import json, os

hier = json.load(open('_tmp/screen_hierarchy.json', encoding='utf-8'))
tree = hier.get('tree', [])

# ← 사용자 응답에 따라 아래 scopes 리스트를 채운다
# 예: scopes = [] → 전체, scopes = ['상품관리'] → 해당 L1만
# 예: scopes = ['상품관리/상품목록'] → L2 단위 스코프
scopes = []   # 전체 탐색 시 빈 리스트

if not scopes:
    selected_labels = [n['text'] for n in tree]
    scope_paths = ['']   # 전체 = 빈 scope
else:
    selected_labels = scopes
    scope_paths = scopes

os.makedirs('_tmp', exist_ok=True)
json.dump({
    'scopes': scope_paths,
    'selected_labels': selected_labels,
    'source_l1_count': len(tree),
}, open('_tmp/bfs_scope_selection.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(f'탐색 범위 확정: {len(scope_paths)}개 스코프')
for s in scope_paths:
    print(f'  - {s or \"(전체)\"}')
"
```

> **확인 전 STEP 6-1 절대 진행 금지.**

---

### STEP 6-1: 선택 범위별 BFS 탐색 (화면 목록 수집 — 캡처 없음)

`bfs_scope_selection.json`의 각 스코프에 대해 순차로 실행한다.  
이 단계는 **화면 목록 수집만** 한다. 캡처는 STEP 6-2에서 사용자 확인 후 진행한다.

```bash
!python3 -c "
import json, os, subprocess, sys, datetime

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
plugin   = env.get('PLUGIN_PATH', '')
cdp_port = env.get('PREVIEW_CDP_PORT', '9222')
ws       = os.getcwd()

script = os.path.join(plugin, 'scripts', 'bfs_navigator.js') if plugin else ''
if not (script and os.path.exists(script)):
    print('[ERROR] bfs_navigator.js 없음'); sys.exit(1)

sel = json.load(open('_tmp/bfs_scope_selection.json', encoding='utf-8'))
scopes = sel.get('scopes', [''])

all_flat = []

for i, scope in enumerate(scopes):
    out_dir = f'_tmp/bfs_{i}' if len(scopes) > 1 else '_tmp'
    os.makedirs(out_dir, exist_ok=True)

    cmd = ['node', script,
           f'--port={cdp_port}',
           f'--out={out_dir}',
           '--max-depth=6',
           f'--workspace={ws}']
    if scope:
        cmd.append(f'--scope={scope}')
    # --capture 없음: 탐색만

    scope_label = scope or '(전체)'
    print(f'\\n[스코프 {i+1}/{len(scopes)}] {scope_label} 탐색 시작 ...')
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='ignore')
    print(r.stderr[-1500:] if len(r.stderr) > 1500 else r.stderr)

    out_json = os.path.join(out_dir, 'screen_hierarchy.json')
    if os.path.exists(out_json):
        data = json.load(open(out_json, encoding='utf-8'))
        batch = [s for s in data.get('flat', []) if s.get('type') == 'screen']
        print(f'  → 화면 {len(batch)}개 발견')
        all_flat.extend(batch)
    else:
        print(f'  [WARN] screen_hierarchy.json 없음 (스코프: {scope_label})')

merged = {
    'version': 2,
    'generatedAt': datetime.datetime.now().isoformat(),
    'rootUrl': '',
    'scopes': scopes,
    'captureMode': False,
    'stats': {'screens': len(all_flat), 'captured': 0},
    'flat': all_flat,
}
json.dump(merged, open('_tmp/screen_hierarchy.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(f'\\n[탐색 완료] 총 화면 {len(all_flat)}개 → _tmp/screen_hierarchy.json')
"
```

---

### ✋ STEP 6-1.5: 발견 화면 목록 검토 + 피드백 (필수 체크포인트)

발견된 화면 목록을 사용자에게 보여주고 **제외·수정·추가·버튼진입 피드백**을 받는다.  
피드백 반영 후 `_tmp/screen_confirmed.json`을 생성하여 STEP 6-2의 캡처 입력으로 사용한다.

```bash
!python3 -c "
import json, os

hier = json.load(open('_tmp/screen_hierarchy.json', encoding='utf-8'))
flat = [s for s in hier.get('flat', []) if s.get('type') == 'screen']

print('=' * 70)
print(f'발견된 화면 목록 (총 {len(flat)}개)')
print('=' * 70)
print(f'  {'번호':>4}  {'화면명':<20} {'경로(route)':<35} 탭')
print('-' * 70)
for i, s in enumerate(flat, 1):
    tabs = ', '.join(t.get('label','') for t in s.get('tabs', []))
    tab_str = f'[{tabs}]' if tabs else ''
    path_str = s.get('route', '')[-33:] or '(경로 없음)'
    print(f'  {i:>4}. {s[\"label\"]:<20} {path_str:<35} {tab_str}')
    menu = ' > '.join(s.get('path', []))
    if menu:
        print(f'       메뉴경로: {menu}')

print()
print('─' * 70)
print('[피드백 입력 방법] — 여러 개는 줄바꿈으로 구분')
print()
print('  ✅ 이상없으면      : \"계속\" 또는 Enter')
print()
print('  ❌ 화면 제외       : 제외 3,7,12')
print('     → 해당 번호 화면을 캡처 목록에서 제외')
print()
print('  ✏️  화면명 수정     : 수정 5 / 상품상세조회')
print('     → 해당 번호 화면의 label 수정')
print()
print('  🔘 버튼 진입 화면  : 진입 8 / 목록 첫번째 행의 상세버튼 클릭')
print('     → 해당 번호 화면에 preActions 추가 (캡처 전 실행)')
print('     → 진입 방법을 자연어로 설명하면 Claude가 selectors 생성')
print()
print('  ➕ 화면 추가       : 추가 / 팝업명 / /admin/product/popup / 상품목록에서 팝업버튼 클릭')
print('     → BFS에서 발견 못한 화면 추가 (버튼·팝업 등)')
print()
print('  예시 복합 입력:')
print('    제외 3,7')
print('    진입 8 / 상품목록 첫번째 행 클릭')
print('    추가 / 옵션팝업 / /admin/product/option / 상품목록에서 [옵션]버튼 클릭')
"
```

사용자 응답을 받아 `_tmp/screen_confirmed.json`을 생성한다.  
**Claude가 직접 JSON을 생성한다** — 사용자의 자연어 설명을 해석하여 `preActions`를 구성한다.

> #### preActions 변환 가이드
>
> | 사용자 설명 | preActions 구성 |
> |------------|----------------|
> | "목록 첫번째 행 클릭" | `[{"type":"click","selector":"table tbody tr:first-child","wait":1500}]` |
> | "검색 후 첫번째 결과 클릭" | `[{"type":"click","selector":".search-btn","wait":500},{"type":"click","selector":"table tbody tr:first-child","wait":1500}]` |
> | "상품목록으로 이동 후 팝업버튼 클릭" | `[{"type":"navigate","url":"/admin/product/list","wait":1500},{"type":"click","selector":"button[class*='popup'],.popup-btn","wait":1200}]` |
> | selector 불확실 | `"selector":"MANUAL"` 로 표기 (실행 시 자동 스킵됨) |
>
> **`screen_confirmed.json` 형식:**
> ```json
> {
>   "confirmedAt": "2026-...",
>   "screens": [
>     {
>       "screenId": "product_list_N0001",
>       "label": "상품목록",
>       "route": "/admin/product/list",
>       "path": ["상품관리", "상품목록"],
>       "tabs": [...],
>       "include": true,
>       "preActions": [],
>       "notes": ""
>     },
>     {
>       "screenId": "order_detail_N0015",
>       "label": "주문상세",
>       "route": "/admin/order/detail",
>       "path": ["주문관리", "주문상세"],
>       "tabs": [],
>       "include": true,
>       "preActions": [
>         {"type": "click", "selector": "table tbody tr:first-child", "wait": 1500}
>       ],
>       "notes": "목록 첫번째 행 클릭해야 진입"
>     }
>   ],
>   "additions": [
>     {
>       "screenId": "product_option_popup",
>       "label": "상품옵션팝업",
>       "route": "/admin/product/option",
>       "path": [],
>       "tabs": [],
>       "include": true,
>       "preActions": [
>         {"type": "navigate", "url": "/admin/product/list", "wait": 1500},
>         {"type": "click", "selector": "button[class*='option'],.option-btn", "wait": 1200}
>       ],
>       "notes": "상품목록에서 [옵션]버튼 클릭 후 팝업"
>     }
>   ]
> }
> ```

실제 `screen_confirmed.json` 생성 (Claude가 사용자 피드백 반영 후 실행):

```bash
!python3 -c "
import json, os, datetime

hier = json.load(open('_tmp/screen_hierarchy.json', encoding='utf-8'))
flat = [s for s in hier.get('flat', []) if s.get('type') == 'screen']

# ─── 아래 두 변수를 사용자 피드백에 따라 채운다 ───────────────────────────────

# 제외할 화면 번호 (1-based)
excluded_nums = []    # 예: [3, 7, 12]

# 수정 사항: {번호: {'label': '새 화면명'}}
modifications = {}    # 예: {5: {'label': '상품상세조회'}}

# preActions 추가: {번호: [action, ...]}
pre_actions_map = {}  # 예: {8: [{'type':'click','selector':'table tbody tr:first-child','wait':1500}]}

# 추가 화면 목록
additions = []        # 형식: {'screenId':..., 'label':..., 'route':..., 'preActions':[...], 'notes':...}

# ─────────────────────────────────────────────────────────────────────────────

screens = []
for i, s in enumerate(flat, 1):
    entry = {
        'screenId': s.get('screenId', f'screen_{i:04d}'),
        'label':    s.get('label', ''),
        'route':    s.get('route', ''),
        'fullUrl':  s.get('fullUrl', ''),
        'path':     s.get('path', []),
        'tabs':     s.get('tabs', []),
        'include':  i not in excluded_nums,
        'preActions': pre_actions_map.get(i, []),
        'notes':    modifications.get(i, {}).get('notes', ''),
    }
    if i in modifications:
        entry.update(modifications[i])
    screens.append(entry)

additions_full = []
for j, a in enumerate(additions):
    sid = a.get('screenId') or f'addition_{j+1:03d}'
    additions_full.append({
        'screenId':   sid,
        'label':      a.get('label', ''),
        'route':      a.get('route', ''),
        'fullUrl':    a.get('fullUrl', ''),
        'path':       a.get('path', []),
        'tabs':       a.get('tabs', []),
        'include':    True,
        'preActions': a.get('preActions', []),
        'notes':      a.get('notes', ''),
    })

confirmed = {
    'confirmedAt': datetime.datetime.now().isoformat(),
    'totalScreens': len([s for s in screens if s['include']]),
    'totalAdditions': len(additions_full),
    'screens':    screens,
    'additions':  additions_full,
}
os.makedirs('_tmp', exist_ok=True)
json.dump(confirmed, open('_tmp/screen_confirmed.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

inc = len([s for s in screens if s['include']])
exc = len([s for s in screens if not s['include']])
pre = len([s for s in screens if s['include'] and s['preActions']])
print(f'screen_confirmed.json 저장 완료')
print(f'  포함: {inc}개  제외: {exc}개  preActions: {pre}개  추가: {len(additions_full)}개')
"
```

> **확인 전 STEP 6-2 절대 진행 금지.**

---

### STEP 6-2: 확정 목록 기반 캡처 (preActions 포함)

`screen_confirmed.json`의 각 화면을 캡처한다.  
- `preActions`가 있는 화면: 지정된 클릭/이동 시퀀스 실행 후 캡처
- 일반 화면: BFS 메뉴 경로(`path`)로 네비게이션 후 캡처
- `include: false`인 화면: 스킵

> PREVIEW_BASE_URL 미설정 시 이 단계를 스킵하고 STEP 6-3으로 이동.

```bash
!python3 -c "
import os, subprocess, sys, json

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
plugin   = env.get('PLUGIN_PATH', '')
cdp_port = env.get('PREVIEW_CDP_PORT', '9222')
base_url = env.get('PREVIEW_BASE_URL', '')
ws       = os.getcwd()

if not base_url:
    print('[캡처 스킵] PREVIEW_BASE_URL 미설정 → STEP 6-3으로 이동')
    sys.exit(0)

script = os.path.join(plugin, 'scripts', 'bfs_navigator.js') if plugin else ''
if not (script and os.path.exists(script)):
    print('[ERROR] bfs_navigator.js 없음'); sys.exit(1)

confirmed_path = '_tmp/screen_confirmed.json'
if not os.path.exists(confirmed_path):
    print('[ERROR] screen_confirmed.json 없음 — STEP 6-1.5 먼저 실행'); sys.exit(1)

confirmed = json.load(open(confirmed_path, encoding='utf-8'))
total = confirmed.get('totalScreens', 0) + confirmed.get('totalAdditions', 0)
print(f'캡처 대상: {total}개 (preActions 있는 화면 포함)')

r = subprocess.run(
    ['node', script,
     f'--confirmed={confirmed_path}',
     f'--port={cdp_port}',
     f'--out=_tmp',
     f'--workspace={ws}'],
    capture_output=True, text=True, encoding='utf-8', errors='ignore'
)
print(r.stderr[-2000:] if len(r.stderr) > 2000 else r.stderr)
if r.returncode != 0:
    print('[ERROR] 캡처 실패 — stderr 확인')
    sys.exit(1)

hier = json.load(open('_tmp/screen_hierarchy.json', encoding='utf-8'))
done = len([s for s in hier.get('flat', []) if s.get('captureStatus') == 'done'])
fail = len([s for s in hier.get('flat', []) if s.get('captureStatus') == 'fail'])
print(f'\\n캡처 결과: 성공 {done}개 / 실패 {fail}개')
if fail > 0:
    print('[실패 화면] preActions selector가 MANUAL인 항목은 수동 캡처 필요:')
    for s in hier.get('flat', []):
        if s.get('captureStatus') == 'fail':
            print(f'  {s[\"label\"]:25} {s[\"route\"]}')
"
```

> 캡처 실패한 화면은:
> 1. `screen_confirmed.json`에서 해당 화면의 `preActions` selector를 수정 후 재실행
> 2. 또는 사용자가 수동으로 `docs/05_설계서/{domain}/UI/{screenId}/preview.png` 경로에 직접 놓기

---

### STEP 6-3: 도메인 배정 + 화면 인벤토리 생성

각 화면의 URL 경로·메뉴 경로를 `_domain_plan.json`과 매칭하여 도메인을 배정한다.

```bash
!python3 -c "
import json, os, re

hier  = json.load(open('_tmp/screen_hierarchy.json', encoding='utf-8'))
plan  = json.load(open('docs/05_설계서/_domain_plan.json', encoding='utf-8'))
flat  = hier.get('flat', [])

domain_kw = {}
for d in plan['domains']:
    kws = set()
    kws.add(d['name'].lower())
    for w in re.split(r'[\s/\-_,]+', d.get('description', '')):
        if len(w) >= 2: kws.add(w.lower())
    for rp in d.get('rootPaths', []):
        parts = rp.replace(chr(92), '/').rstrip('/').split('/')
        for p in parts[-3:]:
            if len(p) >= 2: kws.add(p.lower())
    domain_kw[d['name']] = sorted(kws)

def assign_domain(screen):
    route = (screen.get('route') or '').lower()
    path_labels = [p.lower() for p in screen.get('path', [])]
    search_text = route + ' ' + ' '.join(path_labels)
    best_domain, best_score = 'unassigned', 0
    for dname, kws in domain_kw.items():
        score = sum(1 for k in kws if k in search_text)
        if score > best_score:
            best_score, best_domain = score, dname
    return best_domain

uis_counters = {d['name']: d.get('uis', {}).get('start', 1) for d in plan['domains']}

inventory = []
for screen in flat:
    if screen.get('type') != 'screen':
        continue
    domain = assign_domain(screen)
    uis_id = uis_counters.get(domain, 1)
    if domain in uis_counters:
        uis_counters[domain] += 1

    cap_dir = os.path.join('_tmp', 'captures', screen.get('screenId', ''))
    has_capture = os.path.isdir(cap_dir) and bool(os.listdir(cap_dir))

    inventory.append({
        'uisId':          uis_id,
        'screenId':       screen.get('screenId', ''),
        'screenName':     screen.get('label', ''),
        'domain':         domain,
        'route':          screen.get('route', ''),
        'fullUrl':        screen.get('fullUrl', ''),
        'menuPath':       screen.get('path', []),
        'tabs':           screen.get('tabs', []),
        'captureStatus':  screen.get('captureStatus', 'none'),
        'captureDir':     cap_dir if has_capture else '',
        'entryFile':      '',
        'componentFiles': [],
    })

os.makedirs('_tmp', exist_ok=True)
json.dump(inventory, open('_tmp/screen_inventory.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

from collections import Counter
dc = Counter(s['domain'] for s in inventory)
print(f'화면 인벤토리: 총 {len(inventory)}개')
for i, (d, cnt) in enumerate(sorted(dc.items()), 1):
    captured = len([s for s in inventory if s['domain'] == d and s['captureStatus'] == 'done'])
    print(f'  {i:2}. {d:20} {cnt:3}개  (캡처: {captured}개)')
unassigned = dc.get('unassigned', 0)
if unassigned:
    print(f'\\n[주의] unassigned {unassigned}개 — 도메인 배정 확인 필요')
    for s in inventory:
        if s['domain'] == 'unassigned':
            print(f'  {s[\"screenId\"]:30} route={s[\"route\"]}')
"
```

도메인 배정이 잘못된 항목이 있으면 `_tmp/screen_inventory.json`을 직접 수정하거나 알려주면 재배정한다.

---

### ✋ STEP 6-3.5: 도메인 선택 체크포인트 (필수)

screen_inventory.json 생성 후 **어떤 도메인을 이번 실행에서 처리할지 확인**한다.

```bash
!python3 -c "
import json, os
from collections import Counter

inv = json.load(open('_tmp/screen_inventory.json', encoding='utf-8'))
dc  = Counter(s.get('domain', 'unknown') for s in inv)

print('도메인별 화면 수:')
for i, (d, cnt) in enumerate(sorted(dc.items()), 1):
    done = len([s for s in inv if s.get('domain') == d
                and os.path.exists(f'docs/05_설계서/{d}/UI/{s.get(\"screenId\",\"\")}/spec.md')])
    cap  = len([s for s in inv if s.get('domain') == d and s.get('captureStatus') == 'done'])
    print(f'  {i:2}. {d:20} {cnt:3}개 화면  (캡처: {cap}개, 완료: {done}개)')
print()
print(f'전체: {sum(dc.values())}개 화면')
print()
print('[선택 방법]')
print('  전체 처리: \"all\" 또는 \"계속\"')
print('  특정 도메인: 도메인명 입력 (예: \"product\" 또는 \"product,order\")')
"
```

사용자 응답 처리:

```bash
!python3 -c "
import json, os, shutil

selected_domains = []   # ← 사용자 응답에 따라 채운다 (빈 리스트 = 전체)

inv = json.load(open('_tmp/screen_inventory.json', encoding='utf-8'))
filtered = [s for s in inv if s.get('domain') in selected_domains] if selected_domains else inv
print(f'{'선택: ' + str(selected_domains) + ' → ' if selected_domains else '전체 → '}{len(filtered)}개 화면 처리')

os.makedirs('_tmp', exist_ok=True)
json.dump({'selected_domains': selected_domains or None, 'screens': filtered},
          open('_tmp/uis_domain_selection.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

# 캡처 파일 이동: _tmp/captures/{screenId}/ → docs/05_설계서/{domain}/UI/{screenId}/
moved = 0
for s in filtered:
    src = s.get('captureDir', '')
    if not src or not os.path.isdir(src):
        continue
    dst = os.path.join('docs', '05_설계서', s['domain'], 'UI', s['screenId'])
    os.makedirs(dst, exist_ok=True)
    for fname in os.listdir(src):
        sf, df = os.path.join(src, fname), os.path.join(dst, fname)
        if not os.path.exists(df):
            shutil.copy2(sf, df); moved += 1

if moved: print(f'캡처 파일 {moved}개 이동 완료')
print('_tmp/uis_domain_selection.json 저장 완료')
"
```

> **확인 전 STEP 6-4 절대 진행 금지.**

---

### STEP 6-4: [A] generate_uis_spec.py — 시각 spec.md 초안

캡처(`widgets.json` 또는 `preview_*.png`)가 있는 화면에만 실행한다.  
없는 화면은 이 단계를 스킵하고 STEP 6-5(ddd-ui-agent)가 전체 spec.md를 생성한다.

```bash
!python3 -c "
import os, sys, subprocess, glob, json

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
ws = os.getcwd()

sel_path = '_tmp/uis_domain_selection.json'
screens = json.load(open(sel_path, encoding='utf-8')).get('screens', []) if os.path.exists(sel_path) \
          else json.load(open('_tmp/screen_inventory.json', encoding='utf-8'))

for s in screens:
    uid       = f'UIS-F-{s[\"uisId\"]:03d}' if isinstance(s.get('uisId'), int) else (s.get('uisId') or 'UIS-F-001')
    screen_id = s.get('screenId') or uid.lower().replace('-','_')
    ui_dir    = os.path.join('docs', '05_설계서', s['domain'], 'UI', screen_id)

    has_widgets = (
        os.path.exists(os.path.join(ui_dir, 'widgets.json')) or
        bool(glob.glob(os.path.join(ui_dir, '*_widgets.json'))) or
        bool(glob.glob(os.path.join(ui_dir, 'preview*.png')))
    )
    if not has_widgets:
        continue
    if os.path.exists(os.path.join(ui_dir, 'spec.md')):
        print(f'{uid}: spec.md 이미 존재 — 스킵')
        continue

    script = os.path.join(plugin, 'scripts', 'generate_uis_spec.py') if plugin else ''
    if not (script and os.path.exists(script)):
        print(f'generate_uis_spec.py 없음 — 스킵')
        continue

    screen_name = s.get('screenName') or screen_id
    cmd = [sys.executable, script, ui_dir,
           f'--uis-id={uid}', f'--screen-id={screen_id}',
           f'--screen-name={screen_name}',
           f'--route={s[\"route\"]}', f'--domain={s[\"domain\"]}',
           f'--workspace={ws}']
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='ignore')
    if r.returncode == 0:
        print(f'{uid}: generate_uis_spec 완료')
    else:
        print(f'{uid}: [WARN] {(r.stderr or \"\")[:300]}')
"
```

---

### STEP 6-5: [B] ddd-ui-agent — 소스 분석 + §5 작성 (항상 실행)

**캡처 여부와 무관하게 선택된 모든 화면에 실행한다.**  
spec.md가 이미 있으면(STEP 6-4에서 생성) §5만 패치한다. 없으면 전체 생성한다.

`_tmp/uis_domain_selection.json`(존재 시) 또는 `_tmp/screen_inventory.json`을 읽어 배치 처리한다.

```
선택된 화면 목록의 각 항목에 대해 Agent 도구 호출 (배치 3개씩 동시):
  subagent_type: "speclinker:ddd-ui-agent"
  description: "{screenName} UIS 생성"
  prompt: |
    라우트 경로: {route}
    화면명: {screenName}
    메뉴 경로: {menuPath joined with ' > '}
    탭 목록: {tabs[].label}  (탭 있는 경우)
    도메인: {domain}
    UIS-F ID: UIS-F-{uisId:03d}
    INF 디렉토리: docs/05_설계서/{domain}/INF/
    MODE: RECON
    워크스페이스: {현재 작업 디렉토리 절대경로}
    프로젝트 Profile: .speclinker/profile.yaml

    기존 spec.md: docs/05_설계서/{domain}/UI/{screenId}/spec.md
    (파일이 존재하면 §5만 패치한다. 존재하지 않으면 전체 spec.md를 생성한다.)

    목표:
    1. 소스 파일에서 버튼→API 매핑을 추출하여 §5 인터랙션 이벤트 매핑 표를 작성한다.
    2. INF가 없는 URL을 _tmp/{화면ID}_inf_required.json에 기록한다.
    3. JSP 화면이면 반드시 포함 JS 파일까지 읽어 $.ajax({url:...}) 패턴을 추출한다.

    결과 반환: '✅ {UIS-ID} {화면명} — spec.md 생성|패치 완료 (위젯 N개, API M개)' 1줄만.
```

> 3개씩 배치 순차 실행 — 토큰 과소비 방지.

---

### STEP 6-6: api_hints 수집 (STEP 7 입력 준비)

모든 ddd-ui-agent 배치 완료 후, spec.md의 api_hints를 파싱해 전체 URL 목록 생성:

```bash
!python3 -c "
import os, re, json

sel_path = '_tmp/uis_domain_selection.json'
screens = json.load(open(sel_path, encoding='utf-8')).get('screens', []) if os.path.exists(sel_path) \
          else json.load(open('_tmp/screen_inventory.json', encoding='utf-8'))

hints_all = {}
for s in screens:
    uid       = f'UIS-F-{s[\"uisId\"]:03d}' if isinstance(s.get('uisId'), int) else (s.get('uisId') or 'UIS-F-001')
    screen_id = s.get('screenId', uid.lower().replace('-','_'))
    spec_path = f'docs/05_설계서/{s[\"domain\"]}/UI/{screen_id}/spec.md'
    if not os.path.exists(spec_path):
        continue
    body = open(spec_path, encoding='utf-8').read()
    fm = re.search(r'^---\s*\n(.*?)\n---', body, re.DOTALL)
    if fm:
        for line in fm.group(1).splitlines():
            m = re.search(r'url:\s*[\"\'](.*?)[\"\']\s*.*method:\s*[\"\'](.*?)[\"\']\s*', line)
            if not m:
                m = re.search(r'-\s*\{.*?url:\s*[\"\'](.*?)[\"\']\s*,\s*method:\s*[\"\'](.*?)[\"\']\s*', line)
            if m:
                key = f'{m.group(2).upper()}:{m.group(1)}'
                hints_all[key] = {'url': m.group(1), 'method': m.group(2).upper(),
                                  'screen': uid, 'domain': s['domain']}
    gaps_path = f'_tmp/{screen_id}_inf_gaps.json'
    if os.path.exists(gaps_path):
        for g in json.load(open(gaps_path, encoding='utf-8')).get('gaps', []):
            key = f'{g[\"method\"].upper()}:{g[\"url\"]}'
            hints_all[key] = {'url': g['url'], 'method': g['method'].upper(),
                              'screen': uid, 'domain': s['domain']}

result = list(hints_all.values())
json.dump(result, open('_tmp/uis_api_hints.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(f'api_hints 수집: {len(result)}개 유니크 URL')
"
```

---

### STEP 6-7: UI _TOC.md 생성

```bash
!python3 -c "
import os, re, json

plan = json.load(open('docs/05_설계서/_domain_plan.json'))
for d in plan['domains']:
    domain = d['name']
    ui_dir = f'docs/05_설계서/{domain}/UI'
    if not os.path.isdir(ui_dir):
        continue
    rows = []
    for dname in sorted(os.listdir(ui_dir)):
        spec_path = os.path.join(ui_dir, dname, 'spec.md')
        if not os.path.isfile(spec_path):
            continue
        c = open(spec_path, encoding='utf-8').read()
        uis_id    = re.search(r'^UIS-ID:\s*(\S+)', c, re.M)
        screen_nm = re.search(r'^화면명:\s*(.+)', c, re.M)
        req_f     = re.search(r'^REQ-F:\s*(\S+)', c, re.M)
        if uis_id:
            rows.append((uis_id.group(1), screen_nm.group(1).strip() if screen_nm else dname,
                         req_f.group(1) if req_f else '[TBD]', dname))
    toc = f'# UI 화면 목록 — {domain}\n\n**parseSISpecs 파서 호환 형식**\n\n'
    toc += '## 화면 목록\n\n| UIS-ID | 화면명 | REQ-ID |\n|--------|--------|--------|\n'
    for uis_id, nm, req, dname in rows:
        toc += f'| {uis_id} | [{nm}](./{dname}/spec.md) | {req} |\n'
    with open(os.path.join(ui_dir, '_TOC.md'), 'w', encoding='utf-8') as f:
        f.write(toc)
    print(f'{domain}: UI _TOC.md {len(rows)}건')
"
```

---

## 다음 단계

STEP 6 완료. UIS 설계서 생성이 완료됐습니다.

**체크포인트 업데이트:**
```bash
!python3 -c "
import json, os, datetime
cp = json.load(open('_tmp/recon_checkpoint.json', encoding='utf-8')) if os.path.exists('_tmp/recon_checkpoint.json') else {}
cp.update({'phase': 'recon-uis', 'completed_at': datetime.datetime.now().isoformat(), 'status': 'ok'})
json.dump(cp, open('_tmp/recon_checkpoint.json','w'), ensure_ascii=False, indent=2)
print('체크포인트 업데이트 완료')
"
```

다음 커맨드 실행: **`/sl-recon-inf`**
