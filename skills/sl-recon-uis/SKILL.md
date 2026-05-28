---
name: sl-recon-uis
description: RECON Phase-2 — 소스 기반 화면 발견 → UIS 설계서 생성 → 선택적 BFS 캡처 (STEP 6). /sl-recon 완료 후 실행.
triggers:
  - /sl-recon-uis
---

# /sl-recon-uis — 화면 설계서 생성

## 실행 전 확인

```bash
!python -c "
import json, os, sys

errors = []
if not os.path.exists('_tmp/recon_checkpoint.json'):
    errors.append('[FAIL] recon_checkpoint.json 없음 — /sl-recon 먼저 실행')
if not os.path.exists('docs/05_설계서/_domain_plan.json'):
    errors.append('[FAIL] _domain_plan.json 없음 — /sl-recon STEP 3 확인')
if errors:
    for e in errors: print(e)
    sys.exit(1)

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
plan = json.load(open('docs/05_설계서/_domain_plan.json', encoding='utf-8'))
base_url = env.get('PREVIEW_BASE_URL', '')
print('[OK] 도메인 ' + str(len(plan['domains'])) + '개')
print('[BFS 보강] ' + ('활성 (STEP 6-3 실행)' if base_url else '비활성 (PREVIEW_BASE_URL 미설정) — 소스 분석만 실행'))
"
```

---

## STEP 6-1: 소스 기반 화면 발견

소스코드(knowledge-graph + Spring MVC 컨트롤러)에서 화면 목록을 추출한다.
브라우저·네트워크 불필요 — 항상 실행된다.

```bash
!python -c "
import os, subprocess, sys

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH', '')
script = os.path.join(plugin, 'scripts', 'screen_inventory.py') if plugin else ''
if not (script and os.path.exists(script)):
    print('[ERROR] screen_inventory.py 없음 — PLUGIN_PATH 확인'); sys.exit(1)

r = subprocess.run([sys.executable, script, os.getcwd()],
                   capture_output=True, text=True, encoding='utf-8', errors='ignore')
print(r.stdout); print(r.stderr[-1000:] if r.stderr else '')
if r.returncode != 0: sys.exit(1)
"
```

---

## ✋ STEP 6-1.5: 화면 목록 검토 (필수 체크포인트)

발견된 화면 목록을 출력하고 피드백을 받는다.

```bash
!python -c "
import json, os
from collections import Counter

inv = json.load(open('_tmp/screen_inventory.json', encoding='utf-8'))
dc = Counter(s['domain'] for s in inv)

print('=' * 70)
print('발견된 화면 목록 (총 ' + str(len(inv)) + '개)')
print('=' * 70)
print('  ' + '번호'.rjust(4) + '  ' + '화면ID'.ljust(25) + ' ' + '도메인'.ljust(15) + ' 경로')
print('-' * 70)
for i, s in enumerate(inv, 1):
    sid    = s.get('screenId', '') or os.path.splitext(os.path.basename(s.get('entryFile','')))[0]
    domain = s.get('domain', '')
    route  = s.get('route', '')
    src    = s.get('source', '')
    tag    = ' [BFS]' if src == 'bfs' else ''
    print('  ' + str(i).rjust(4) + '. ' + sid.ljust(25) + ' ' + domain.ljust(15) + ' ' + route + tag)

print()
print('도메인별: ' + str(dict(dc)))
print()
print('[피드백 방법]')
print('  이상없음    : \"계속\"')
print('  제외        : 제외 3,7')
print('  도메인수정  : 도메인 5 / order')
print('  화면명수정  : 수정 5 / 새화면명')
"
```

사용자 피드백을 받아 `_tmp/screen_inventory.json`을 직접 수정한다.

> **확인 전 STEP 6-2 진행 금지.**

---

## STEP 6-2: UIS 스펙 생성 (ddd-ui-agent 배치)

**캡처 유무와 무관하게 모든 화면에 실행한다.**
spec.md가 이미 있으면 §5만 패치, 없으면 전체 생성.

```bash
!python -c "
import json, os

inv  = json.load(open('_tmp/screen_inventory.json', encoding='utf-8'))
ws   = os.getcwd()

# 재시작 지원: spec.md 이미 있는 항목은 §5 패치 모드, 없으면 전체 생성
pending = []
for s in inv:
    sid    = s.get('screenId') or os.path.splitext(os.path.basename(s.get('entryFile','')))[0]
    domain = s.get('domain','')
    spec   = 'docs/05_설계서/' + domain + '/UI/' + sid + '/spec.md'
    merged = dict(s)
    merged['_specExists'] = os.path.exists(spec)
    merged['_specPath']   = spec
    merged['_screenId']   = sid
    pending.append(merged)

new_cnt   = len([p for p in pending if not p['_specExists']])
patch_cnt = len([p for p in pending if p['_specExists']])
print('전체 ' + str(len(pending)) + '개 — 신규생성: ' + str(new_cnt) + '개 / §5패치: ' + str(patch_cnt) + '개')
print()
for i, p in enumerate(pending, 1):
    mode = '§5패치' if p['_specExists'] else '전체생성'
    print('  ' + str(i).rjust(3) + '. [' + mode + '] ' + p['_screenId'].ljust(30) + ' ' + p['route'])
"
```

`_tmp/screen_inventory.json`의 각 항목을 3개씩 묶어 `ddd-ui-agent`를 병렬 호출한다:

```
각 배치(3개씩) → Agent 도구 호출:
  subagent_type: "speclinker:ddd-ui-agent"
  description: "{domain} UIS 생성 ({screenId1}, {screenId2}, {screenId3})"
  prompt: |
    처리 대상 (여러 화면):

    [화면 1]
    라우트: {route}
    진입 파일: {entryFile}
    참조 컴포넌트: {componentFiles JSON}
    도메인: {domain}
    UIS-F ID: UIS-F-{uisId:03d}
    INF 디렉토리: docs/05_설계서/{domain}/INF/
    MODE: RECON
    워크스페이스: {현재 작업 디렉토리 절대경로}
    기존 spec.md: {_specPath if _specExists else "없음"}

    [화면 2] ...
    [화면 3] ...

각 배치 완료 후 다음 배치 시작 (3개씩 순차).
```

> 모든 배치 완료 전 STEP 6-3 진행 금지.

---

## STEP 6-3: [선택] 브라우저 보강

> **PREVIEW_BASE_URL 미설정 시 이 STEP 전체를 스킵하고 STEP 6-4로 이동.**

```bash
!python -c "
import os
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
if not env.get('PREVIEW_BASE_URL',''):
    print('[SKIP] PREVIEW_BASE_URL 미설정 — STEP 6-4로 이동')
else:
    print('[OK] BFS 보강 시작')
"
```

### STEP 6-3-0: Chrome 실행 + 로그인 대기

```bash
!python -c "
import os, subprocess, sys, socket, time, platform

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
cdp_port = env.get('PREVIEW_CDP_PORT', '9222')
base_url = env.get('PREVIEW_BASE_URL', '')

def cdp_alive(port):
    try:
        s = socket.create_connection(('localhost', int(port)), timeout=1); s.close(); return True
    except: return False

if cdp_alive(cdp_port):
    print('[OK] Chrome CDP ' + cdp_port + ' 이미 열려있음')
else:
    plat = platform.system()
    if plat == 'Windows':
        subprocess.Popen('start chrome --remote-debugging-port=' + cdp_port,
                         shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    elif plat == 'Darwin':
        subprocess.Popen(['open', '-a', 'Google Chrome', '--args', '--remote-debugging-port=' + cdp_port],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        subprocess.Popen(['google-chrome', '--remote-debugging-port=' + cdp_port],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print('Chrome 시작 대기 중', end='', flush=True)
    for _ in range(20):
        time.sleep(1); print('.', end='', flush=True)
        if cdp_alive(cdp_port): print(' 준비!'); break
    else:
        print(); print('[ERROR] Chrome 시작 실패'); sys.exit(1)

print()
print('━' * 55)
print(' Chrome 창에서 ' + base_url + ' 로그인 완료 후')
print(' Claude에게 \"계속\" 이라고 말해주세요.')
print('━' * 55)
"
```

> 사용자가 **"계속"** 하면 STEP 6-3-1로 이동.

### STEP 6-3-1: BFS 메뉴 탐색 (nav 자동 감지)

```bash
!python -c "
import os, subprocess, sys, json

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
plugin   = env.get('PLUGIN_PATH', '')
cdp_port = env.get('PREVIEW_CDP_PORT', '9222')
ws       = os.getcwd()

script = os.path.join(plugin, 'scripts', 'bfs_navigator.js') if plugin else ''
if not (script and os.path.exists(script)):
    print('[ERROR] bfs_navigator.js 없음'); sys.exit(1)

os.makedirs('_tmp', exist_ok=True)

# 1단계: 정적 트리 추출 (nav 자동 감지 테스트)
r = subprocess.run(['node', script, '--port=' + cdp_port, '--tree-only',
                    '--max-depth=6', '--out=_tmp', '--workspace=' + ws],
                   capture_output=True, text=True, encoding='utf-8', errors='ignore')
print(r.stderr[-2000:] if len(r.stderr) > 2000 else r.stderr)
if r.returncode != 0:
    print('[ERROR] BFS 트리 추출 실패 — nav 자동 감지가 모든 frame에서 실패했습니다.')
    print('  Chrome DevTools에서 메뉴 컨테이너 selector를 확인 후 project.env에 추가하세요:')
    print('  PREVIEW_NAV_SELECTOR=<selector>')
    sys.exit(1)

hier = json.load(open('_tmp/screen_hierarchy.json', encoding='utf-8'))
print('트리 추출 완료: L1 ' + str(hier['stats']['l1Count']) + '개 / 노드 ' + str(hier['stats']['totalNodes']) + '개')
"
```

nav 자동 감지 실패 시 `project.env`에 `PREVIEW_NAV_SELECTOR=<selector>` 추가 후 재실행:

```bash
!python -c "
import os, subprocess, sys, json

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
plugin   = env.get('PLUGIN_PATH', '')
cdp_port = env.get('PREVIEW_CDP_PORT', '9222')
nav_sel  = env.get('PREVIEW_NAV_SELECTOR', '')
ws       = os.getcwd()

# 전체 BFS 탐색 (클릭 포함, 캡처 없음)
script = os.path.join(plugin, 'scripts', 'bfs_navigator.js')
cmd = ['node', script, '--port=' + cdp_port, '--max-depth=6', '--out=_tmp', '--workspace=' + ws]
if nav_sel:
    cmd.append('--nav-selector=' + nav_sel)

r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='ignore')
print(r.stderr[-2000:] if len(r.stderr) > 2000 else r.stderr)
if r.returncode != 0:
    sys.exit(1)

hier  = json.load(open('_tmp/screen_hierarchy.json', encoding='utf-8'))
flat  = [s for s in hier.get('flat', []) if s.get('type') == 'screen']
inv   = json.load(open('_tmp/screen_inventory.json', encoding='utf-8'))
known = {s.get('route','') for s in inv}
new_screens = [s for s in flat if s.get('route','') not in known]

print('BFS 탐색 완료: ' + str(len(flat)) + '개 화면 발견')
print('소스 분석 기존: ' + str(len(inv)) + '개 / BFS 신규: ' + str(len(new_screens)) + '개')
"
```

### ✋ STEP 6-3-2: BFS 발견 화면 검토 + 피드백 (필수 체크포인트)

```bash
!python -c "
import json, os

hier  = json.load(open('_tmp/screen_hierarchy.json', encoding='utf-8'))
flat  = [s for s in hier.get('flat', []) if s.get('type') == 'screen']
inv   = json.load(open('_tmp/screen_inventory.json', encoding='utf-8'))
known = {s.get('route','') for s in inv}

bfs_new = [s for s in flat if s.get('route','') not in known]
bfs_dup = [s for s in flat if s.get('route','') in known]

print('소스 분석에 없는 신규 화면 (' + str(len(bfs_new)) + '개):')
for i, s in enumerate(bfs_new, 1):
    print('  ' + str(i).rjust(3) + '. ' + s['label'].ljust(30) + ' ' + s['route'])
print('소스 분석 기존 화면 (BFS 재발견): ' + str(len(bfs_dup)) + '개')
print()
print('[피드백]')
print('  이상없음  : \"계속\" (전체 캡처)')
print('  일부 제외 : 제외 2,5')
print('  버튼진입  : 진입 3 / 목록 첫번째 행 클릭')
print('  추가      : 추가 / 팝업명 / /경로 / 진입방법')
"
```

피드백 반영 후 `_tmp/screen_confirmed.json` 생성. 기존 화면(BFS 재발견) + 신규 화면 모두 포함:

```bash
!python -c "
import json, os, datetime

hier  = json.load(open('_tmp/screen_hierarchy.json', encoding='utf-8'))
flat  = [s for s in hier.get('flat', []) if s.get('type') == 'screen']

# 사용자 피드백 반영
excluded_routes = []    # 예: ['/admin/old/page']
pre_actions_map = {}    # 예: {'3': [{'type':'click','selector':'table tbody tr:first-child','wait':1500}]}
additions       = []    # 예: [{'label':'팝업명','route':'/path','preActions':[...]}]

screens = []
for i, s in enumerate(flat, 1):
    screens.append({
        'screenId':   s.get('screenId', s.get('id', '')),
        'label':      s.get('label', ''),
        'route':      s.get('route', ''),
        'fullUrl':    s.get('fullUrl', ''),
        'path':       s.get('path', []),
        'tabs':       s.get('tabs', []),
        'include':    s.get('route','') not in excluded_routes,
        'preActions': pre_actions_map.get(str(i), []),
        'notes':      '',
    })

additions_full = []
for j, a in enumerate(additions):
    additions_full.append({
        'screenId':   a.get('screenId', 'addition_' + str(j+1).zfill(3)),
        'label':      a.get('label', ''),
        'route':      a.get('route', ''),
        'path':       [],
        'tabs':       [],
        'include':    True,
        'preActions': a.get('preActions', []),
        'notes':      a.get('notes', ''),
    })

os.makedirs('_tmp', exist_ok=True)
confirmed = {
    'confirmedAt':    datetime.datetime.now().isoformat(),
    'totalScreens':   len([s for s in screens if s['include']]),
    'totalAdditions': len(additions_full),
    'screens':        screens,
    'additions':      additions_full,
}
json.dump(confirmed, open('_tmp/screen_confirmed.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('screen_confirmed.json 저장: ' + str(confirmed['totalScreens']) + '개 + 추가 ' + str(confirmed['totalAdditions']) + '개')
"
```

> **확인 전 STEP 6-3-3 진행 금지.**

### STEP 6-3-3: 캡처 실행

```bash
!python -c "
import os, subprocess, sys, json

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
plugin   = env.get('PLUGIN_PATH', '')
cdp_port = env.get('PREVIEW_CDP_PORT', '9222')
ws       = os.getcwd()

script = os.path.join(plugin, 'scripts', 'bfs_navigator.js')
confirmed_path = '_tmp/screen_confirmed.json'

if not os.path.exists(confirmed_path):
    print('[SKIP] screen_confirmed.json 없음 — STEP 6-3-2 먼저 실행'); sys.exit(0)

confirmed = json.load(open(confirmed_path, encoding='utf-8'))
total = confirmed.get('totalScreens',0) + confirmed.get('totalAdditions',0)
print('캡처 대상: ' + str(total) + '개')

r = subprocess.run(
    ['node', script, '--confirmed=' + confirmed_path,
     '--port=' + cdp_port, '--out=_tmp', '--workspace=' + ws],
    capture_output=True, text=True, encoding='utf-8', errors='ignore')
print(r.stderr[-2000:] if len(r.stderr) > 2000 else r.stderr)
if r.returncode != 0:
    sys.exit(1)
"
```

### STEP 6-3-4: BFS 병합 + 신규 화면 처리

screen_inventory.py를 재실행해 BFS 결과를 병합하고 신규 화면만 추려 ddd-ui-agent를 추가 실행한다.

```bash
!python -c "
import os, subprocess, sys, json

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH', '')
script = os.path.join(plugin, 'scripts', 'screen_inventory.py')

# BFS 결과 포함하여 재실행 (screen_hierarchy.json 있으면 자동 병합)
prev = json.load(open('_tmp/screen_inventory.json', encoding='utf-8'))
prev_routes = {s.get('route','') for s in prev}

r = subprocess.run([sys.executable, script, os.getcwd()],
                   capture_output=True, text=True, encoding='utf-8', errors='ignore')
print(r.stdout)

new_inv = json.load(open('_tmp/screen_inventory.json', encoding='utf-8'))
bfs_only = [s for s in new_inv if s.get('source') == 'bfs' and s.get('route','') not in prev_routes]
print('BFS 전용 신규 화면: ' + str(len(bfs_only)) + '개')
for s in bfs_only:
    print('  ' + s['screenId'].ljust(30) + ' ' + s['route'])
"
```

신규 BFS 화면에 ddd-ui-agent 추가 실행 (배치 3개씩, 위 STEP 6-2와 동일 방식).

---

## STEP 6-4: api_hints 수집

```bash
!python -c "
import os, re, json

inv = json.load(open('_tmp/screen_inventory.json', encoding='utf-8'))

hints_all = {}
for s in inv:
    sid  = s.get('screenId') or os.path.splitext(os.path.basename(s.get('entryFile','')))[0]
    spec = 'docs/05_설계서/' + s['domain'] + '/UI/' + sid + '/spec.md'
    if not os.path.exists(spec):
        continue
    body = open(spec, encoding='utf-8').read()
    for line in body.splitlines():
        m = re.search(r'(GET|POST|PUT|DELETE|PATCH)\s+\|.*?\|.*?(/[^\s|]+)', line, re.I)
        if m:
            key = m.group(1).upper() + ':' + m.group(2)
            hints_all[key] = {'url': m.group(2), 'method': m.group(1).upper(),
                              'screen': sid, 'domain': s['domain']}
    gaps = '_tmp/' + sid + '_inf_gaps.json'
    if os.path.exists(gaps):
        for g in json.load(open(gaps, encoding='utf-8')).get('gaps', []):
            key = g['method'].upper() + ':' + g['url']
            hints_all[key] = {'url': g['url'], 'method': g['method'].upper(),
                              'screen': sid, 'domain': s['domain']}

result = list(hints_all.values())
json.dump(result, open('_tmp/uis_api_hints.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('api_hints: ' + str(len(result)) + '개')
"
```

---

## STEP 6-5: UI _TOC.md 생성

```bash
!python -c "
import os, re, json

plan = json.load(open('docs/05_설계서/_domain_plan.json'))
for d in plan['domains']:
    domain = d['name']
    ui_dir = 'docs/05_설계서/' + domain + '/UI'
    if not os.path.isdir(ui_dir):
        continue
    rows = []
    for dname in sorted(os.listdir(ui_dir)):
        spec = os.path.join(ui_dir, dname, 'spec.md')
        if not os.path.isfile(spec): continue
        c = open(spec, encoding='utf-8').read()
        uis_id  = re.search(r'^UIS-ID:\s*(\S+)', c, re.M)
        screen  = re.search(r'^화면명:\s*(.+)',   c, re.M)
        req_f   = re.search(r'^REQ-F:\s*(\S+)',   c, re.M)
        if uis_id:
            rows.append((uis_id.group(1),
                         screen.group(1).strip() if screen else dname,
                         req_f.group(1) if req_f else '[TBD]', dname))
    toc = '# UI 화면 목록 — ' + domain + '\n\n| UIS-ID | 화면명 | REQ-ID |\n|--------|--------|--------|\n'
    for uid, nm, req, dn in rows:
        toc += '| ' + uid + ' | [' + nm + '](./' + dn + '/spec.md) | ' + req + ' |\n'
    open(os.path.join(ui_dir, '_TOC.md'), 'w', encoding='utf-8').write(toc)
    print(domain + ': _TOC.md ' + str(len(rows)) + '건')
"
```

---

## 완료

```bash
!python -c "
import json, os, datetime
cp = json.load(open('_tmp/recon_checkpoint.json', encoding='utf-8')) if os.path.exists('_tmp/recon_checkpoint.json') else {}
cp.update({'phase': 'recon-uis', 'completed_at': datetime.datetime.now().isoformat(), 'status': 'ok'})
json.dump(cp, open('_tmp/recon_checkpoint.json','w'), ensure_ascii=False, indent=2)
inv = json.load(open('_tmp/screen_inventory.json', encoding='utf-8'))
print('완료: 화면 ' + str(len(inv)) + '개 / spec.md 생성')
print('다음 커맨드: /sl-recon-inf')
"
```
