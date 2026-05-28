---
name: sl-recon-uis
description: RECON Phase-2 — 소스 기반 화면 발견 → 브라우저 캡처+마커 → UIS 설계서 생성 (STEP 6). /sl-recon 완료 후 실행.
triggers:
  - /sl-recon-uis
---

# /sl-recon-uis — 화면 설계서 생성

**실행 순서:**
1. STEP 6-1: 소스 정적 분석 → 화면 목록 확정
2. STEP 6-1.5: 사용자 검토 (필수)
3. STEP 6-2: 브라우저 캡처 + 마커 (`PREVIEW_BASE_URL` 설정 시) — **spec 생성 전 반드시 먼저**
4. STEP 6-3: UIS spec 생성 (captureDir 있으면 캡처 포함, 없으면 와이어프레임)
5. STEP 6-4: api_hints 수집
6. STEP 6-5: _TOC.md 생성

---

## 실행 전 확인

```bash
!python -c "
import json, os, sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

errors = []
if not os.path.exists('_tmp/recon_checkpoint.json'):
    errors.append('[FAIL] recon_checkpoint.json 없음 -> /sl-recon 먼저 실행')
if not os.path.exists('docs/05_설계서/_domain_plan.json'):
    errors.append('[FAIL] _domain_plan.json 없음 -> /sl-recon STEP 3 확인')
if errors:
    for e in errors: print(e)
    sys.exit(1)

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
plan = json.load(open('docs/05_설계서/_domain_plan.json', encoding='utf-8'))
base_url = env.get('PREVIEW_BASE_URL', '')
print('[OK] 도메인 ' + str(len(plan['domains'])) + '개')
print('[브라우저 캡처] ' + ('활성 (STEP 6-2 실행)' if base_url else '비활성 (PREVIEW_BASE_URL 미설정) - 소스 기반 와이어프레임만 생성'))
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
    print('[ERROR] screen_inventory.py 없음 (PLUGIN_PATH 확인)'); sys.exit(1)

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

try:
    import sys
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

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
    print('  ' + str(i).rjust(4) + '. ' + sid.ljust(25) + ' ' + domain.ljust(15) + ' ' + route)

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

## STEP 6-2: [선택] 브라우저 캡처 + 마커

> **PREVIEW_BASE_URL 미설정 시 이 STEP 전체를 스킵하고 STEP 6-3으로 이동.**
> 캡처 → 마커 → 이후 STEP 6-3에서 spec 생성 시 캡처 이미지 포함. **반드시 spec 생성 전에 실행.**

```bash
!python -c "
import os, sys
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
if not env.get('PREVIEW_BASE_URL',''):
    print('[SKIP] PREVIEW_BASE_URL 미설정 - STEP 6-3으로 이동')
else:
    print('[OK] 브라우저 캡처 시작 (base_url: ' + env['PREVIEW_BASE_URL'] + ')')
"
```

### STEP 6-2-0: Chrome 실행 + 로그인 대기

```bash
!python -c "
import os, subprocess, sys, socket, time, platform, tempfile

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

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
    debug_profile = os.path.join(tempfile.gettempdir(), 'speclinker-chrome-debug')
    if plat == 'Windows':
        chrome_candidates = [
            os.path.expandvars(r'%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe'),
            os.path.expandvars(r'%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe'),
            os.path.expandvars(r'%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe'),
        ]
        chrome_exe = next((p for p in chrome_candidates if os.path.exists(p)), 'chrome')
        cmd = '\"' + chrome_exe + '\" --remote-debugging-port=' + cdp_port + ' --user-data-dir=\"' + debug_profile + '\" about:blank'
        subprocess.Popen(cmd, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    elif plat == 'Darwin':
        subprocess.Popen([
            'open', '-a', 'Google Chrome', '--args',
            '--remote-debugging-port=' + cdp_port,
            '--user-data-dir=' + debug_profile,
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        subprocess.Popen([
            'google-chrome',
            '--remote-debugging-port=' + cdp_port,
            '--user-data-dir=' + debug_profile,
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    print('Chrome 시작 대기 중 (디버그 프로파일: ' + debug_profile + ')', flush=True)
    for _ in range(25):
        time.sleep(1); print('.', end='', flush=True)
        if cdp_alive(cdp_port): print(' 준비!'); break
    else:
        print()
        print('[ERROR] Chrome 시작 실패.')
        print('  수동으로 Chrome을 열고 --remote-debugging-port=' + cdp_port + ' 옵션을 추가하세요.')
        sys.exit(1)

print()
print('=' * 55)
print(' Chrome 창에서 ' + base_url + ' 로그인 완료 후')
print(' Claude에게 \"계속\" 이라고 말해주세요.')
print('=' * 55)
"
```

> 사용자가 **"계속"** 하면 STEP 6-2-1로 이동.

### STEP 6-2-1: 탐색 초기화

ai_nav.js 경로와 탐색 파라미터를 확인한다.

```bash
!python -c "
import json, os, sys
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
inv      = json.load(open('_tmp/screen_inventory.json', encoding='utf-8'))
plugin   = env.get('PLUGIN_PATH', '')
cdp_port = env.get('PREVIEW_CDP_PORT', '9222')
ai_nav   = os.path.join(plugin, 'scripts', 'ai_nav.js') if plugin else ''
if not (ai_nav and os.path.exists(ai_nav)):
    print('[ERROR] ai_nav.js 없음 (PLUGIN_PATH 확인)'); sys.exit(1)
print('AI_NAV='   + ai_nav)
print('CDP_PORT=' + cdp_port)
print('CWD='      + os.getcwd())
print()
print('캡처 대상 화면 (' + str(len(inv)) + '개):')
for s in inv:
    print('  ' + (s.get('route') or '미정').ljust(40) + ' ' + s.get('screenId',''))
"
```

### STEP 6-2-2: BFS 탐색 + 캡처 → uis_capture_map.json 누적

**Phase 1 목표**: 브라우저 세션을 유지하며 모든 leaf 화면을 캡처하고
`_tmp/uis_capture_map.json`에 누적 저장한다.
UIS spec 생성은 이 단계에서 절대 하지 않는다 — Phase 2(STEP 6-3)에서 수행.

> ⚠️ **goto 금지 (1단계)** — 메뉴 클릭으로만 탐색. 메뉴로 못 찾은 화면만 2단계에서 goto.

---

**Claude 상태 변수 (메모리 추적):**

| 변수 | 타입 | 역할 |
|------|------|------|
| `capture_map` | list | 캡처 결과 누적 → 매 캡처 후 `_tmp/uis_capture_map.json`에 저장 |
| `visited_routes` | set | 이미 캡처한 `activeRoute` (중복 방지) |
| `clicked_labels` | set | 이미 클릭한 nav-link 텍스트 |
| `current_path` | list | BFS 현재 경로 — 클릭 depth 기반 갱신 |

**재개 지원**: `_tmp/uis_capture_map.json`이 존재하면 로드해 `visited_routes`에 기존 `activeRoute` 추가.

---

**BFS 루프 알고리즘:**

루프마다 snapshot 실행:
```
!node {AI_NAV} --port={CDP_PORT} --workspace={CWD} snapshot
```

**매 iteration 판단:**

**① navigables 필터 — `frame: 'main'` 항목만 BFS 대상**
(content frame 내부 탭/버튼은 절대 클릭하지 않는다)

**② 다음 클릭 대상 선택 (우선순위):**

```
우선순위 1: visible=false AND depth=0 AND frame=main AND label ∉ clicked_labels
  → L1 GNB 카테고리 미탐색 → 클릭 (사이드바 전환)
  → current_path = [label]

우선순위 2: visible=true AND hasChildren=true AND frame=main AND label ∉ clicked_labels
  → 중간 노드 (expand 필요) → 클릭
  → current_path = current_path[0:depth] + [label]

우선순위 3: visible=true AND hasChildren=false AND frame=main AND label ∉ clicked_labels
  → LEAF 화면 → 클릭 후 캡처 실행 (아래 캡처 절차 참조)
  → current_path 갱신 후 menuPath = current_path[0:depth] + [label]
```

> `depth`는 해당 nav-link 항목의 `depth` 필드 값.
> 우선순위 1→2→3 순으로 선택 — 모두 없으면 루프 종료.

**③ LEAF 클릭 후 캡처 절차:**

```
!node {AI_NAV} --port={CDP_PORT} --workspace={CWD} click "{leaf_label}"
```

클릭 결과의 `activeRoute` 확인:
- `activeRoute`가 `visited_routes`에 있으면 → 스킵 (이미 캡처됨)
- 없으면 → 캡처 실행:

```
!node {AI_NAV} --port={CDP_PORT} --workspace={CWD} capture "{screenId}"
```

screenId 생성 규칙: `activeRoute`의 마지막 세그먼트 (예: `/app/order/pay/or416mForm` → `or416mForm`)

캡처 결과를 `capture_map`에 append:
```json
{
  "menuPath": ["L1", "L2", ..., "leaf_label"],
  "screenLabel": "leaf_label",
  "activeRoute": "캡처결과.activeRoute",
  "captureDir":  "캡처결과.captureDir",
  "captureFile": "캡처결과.captureFile",
  "widgetCount": 캡처결과.widgetCount
}
```

즉시 파일 저장 (매 캡처 후):
```
!node -e "
const fs = require('fs');
const map = <capture_map_JSON>;
fs.writeFileSync('_tmp/uis_capture_map.json', JSON.stringify(map, null, 2));
process.stdout.write('uis_capture_map 저장: ' + map.length + '개\n');
"
```

`visited_routes`에 `activeRoute` 추가, `clicked_labels`에 `leaf_label` 추가.

---

**1단계 종료 조건:**
- frame=main 의 depth=0 항목 전부 `clicked_labels`에 있음
- AND visible 항목 중 미클릭 nav-link 없음
- OR 연속 5회 click 후 `activeRoute` / navigables 변화 없음

---

**[2단계] 미캡처 화면 goto 보완**

1단계 완료 후, `screen_inventory.json`의 route 중 `visited_routes`에 없는 항목에 한해 직접 접근:

```
!node {AI_NAV} --port={CDP_PORT} --workspace={CWD} goto "{route}"
```
→ `activeRoute`가 예상 route와 일치하면 capture, 빈 화면/리다이렉트면 스킵.

### STEP 6-2-3: uis_capture_map ↔ screen_inventory 매칭

BFS 완료 후, 두 데이터를 결합해 `uis_capture_map.json`을 최종화한다.

```bash
!python -c "
import json, os, re

try:
    import sys
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

cap_map = json.load(open('_tmp/uis_capture_map.json', encoding='utf-8')) if os.path.exists('_tmp/uis_capture_map.json') else []
inv     = json.load(open('_tmp/screen_inventory.json', encoding='utf-8'))

# route 정규화 (끝 / 제거, 대소문자 통일)
def norm(r): return (r or '').rstrip('/').lower()

inv_by_route = {norm(s.get('route','')): s for s in inv}

matched = 0
for entry in cap_map:
    ar = norm(entry.get('activeRoute',''))
    inv_item = inv_by_route.get(ar)
    if inv_item:
        entry['inventoryMatch'] = {
            'screenId':   inv_item.get('screenId',''),
            'uisId':      inv_item.get('uisId', 0),
            'entryFile':  inv_item.get('entryFile',''),
            'domain':     inv_item.get('domain',''),
            'route':      inv_item.get('route',''),
        }
        matched += 1
    else:
        # BFS에서 발견했지만 정적분석 미포함 화면
        entry.setdefault('inventoryMatch', None)

json.dump(cap_map, open('_tmp/uis_capture_map.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

# 정적분석엔 있지만 BFS에서 못 찾은 화면 → goto 재시도 목록
captured_routes = {norm(e.get('activeRoute','')) for e in cap_map}
goto_fallback = [s for s in inv if norm(s.get('route','')) not in captured_routes]
if goto_fallback:
    json.dump(goto_fallback, open('_tmp/uis_goto_fallback.json','w',encoding='utf-8'), ensure_ascii=False, indent=2)

print('BFS 캡처: ' + str(len(cap_map)) + '개  매칭: ' + str(matched) + '개')
print('goto 재시도 대상: ' + str(len(goto_fallback)) + '개' + (' -> _tmp/uis_goto_fallback.json' if goto_fallback else ''))
for e in cap_map:
    m = e.get('inventoryMatch')
    tag = '[매칭O ' + (m['screenId'] if m else '') + ']' if m else '[매칭X — BFS신규]'
    print('  ' + tag.ljust(30) + ' ' + e.get('activeRoute',''))
"
```

---

## STEP 6-3: UIS 스펙 생성 (ddd-ui-agent 배치)

**Phase 2 — 브라우저 불필요. `_tmp/uis_capture_map.json` 기준으로 실행.**
캡처가 있는 화면은 실제 스크린샷+위젯 기반으로, 없는 화면은 소스 기반 와이어프레임으로 생성한다.

```bash
!python -c "
import json, os

try:
    import sys
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

cap_map = json.load(open('_tmp/uis_capture_map.json', encoding='utf-8')) if os.path.exists('_tmp/uis_capture_map.json') else []
inv     = json.load(open('_tmp/screen_inventory.json', encoding='utf-8'))

# uis_capture_map 항목 — 캡처 있음
pending = []
for e in cap_map:
    m = e.get('inventoryMatch') or {}
    pending.append({
        'source':      'bfs',
        'menuPath':    e.get('menuPath', []),
        'screenLabel': e.get('screenLabel', ''),
        'activeRoute': e.get('activeRoute', ''),
        'captureDir':  e.get('captureDir', ''),
        'captureFile': e.get('captureFile', ''),
        'widgetCount': e.get('widgetCount', 0),
        'screenId':    m.get('screenId', '') or e.get('screenLabel','').replace(' ','_'),
        'uisId':       m.get('uisId', 0),
        'domain':      m.get('domain', ''),
        'entryFile':   m.get('entryFile', ''),
        'route':       m.get('route', '') or e.get('activeRoute',''),
        '_hasCapture': True,
    })

# screen_inventory 항목 — BFS 미발견 (와이어프레임)
captured_routes = {e.get('activeRoute','').rstrip('/').lower() for e in cap_map}
for s in inv:
    if s.get('route','').rstrip('/').lower() in captured_routes:
        continue
    sid = s.get('screenId') or os.path.splitext(os.path.basename(s.get('entryFile','')))[0]
    pending.append({
        'source':      'inventory',
        'menuPath':    [],
        'screenLabel': s.get('screenName', sid),
        'activeRoute': s.get('route',''),
        'captureDir':  '',
        'captureFile': '',
        'widgetCount': 0,
        'screenId':    sid,
        'uisId':       s.get('uisId', 0),
        'domain':      s.get('domain', ''),
        'entryFile':   s.get('entryFile', ''),
        'route':       s.get('route', ''),
        '_hasCapture': False,
    })

cap_cnt  = sum(1 for p in pending if p['_hasCapture'])
wire_cnt = sum(1 for p in pending if not p['_hasCapture'])
print('전체 ' + str(len(pending)) + '개  캡처: ' + str(cap_cnt) + '  와이어프레임: ' + str(wire_cnt))
print()
for i, p in enumerate(pending, 1):
    tag = '[캡처]  ' if p['_hasCapture'] else '[와이어]'
    path_str = ' > '.join(p['menuPath']) if p['menuPath'] else p['route']
    print(str(i).rjust(3) + '. ' + tag + ' ' + p['screenId'].ljust(30) + ' ' + path_str)
"
```

위 목록을 **도메인별로 3개씩 묶어** `ddd-ui-agent`를 병렬 호출한다:

```
각 배치(도메인 동일 3개씩) → Agent 도구 호출:
  subagent_type: "speclinker:ddd-ui-agent"
  description: "{domain} UIS 생성 ({screenId1}, {screenId2}, {screenId3})"
  prompt: |
    처리 대상:

    [화면 1]
    메뉴경로: {menuPath.join(' > ')}
    라우트: {activeRoute}
    진입 파일: {entryFile}
    도메인: {domain}
    UIS-F ID: UIS-F-{uisId:03d}
    INF 디렉토리: docs/05_설계서/{domain}/INF/
    캡처 디렉토리: {captureDir or "없음 (소스 기반 와이어프레임)"}
    MODE: RECON
    워크스페이스: {현재 작업 디렉토리 절대경로}

    [화면 2] ...
    [화면 3] ...

    캡처 디렉토리가 있는 화면:
    - {captureDir}/preview.png  : 원본 스크린샷 (1920x900px)
    - {captureDir}/preview_annotated.png : 마커 스크린샷 (있으면 우선 사용)
    - {captureDir}/preview_widgets.json : 감지된 위젯 목록
    spec.md 미리보기에 이미지 경로(상대경로)를 삽입하고
    widgets.json 기반으로 UI 컴포넌트 목록 작성.

각 배치 완료 후 다음 배치 시작.
```

> 모든 배치 완료 전 STEP 6-4 진행 금지.

---

## STEP 6-4: api_hints 수집

```bash
!python -c "
import os, re, json

try:
    import sys
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

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

try:
    import sys
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

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
        cap_tag = '[캡처]' if os.path.isdir(os.path.join(ui_dir, dname, 'captures')) else '[와이어]'
        if uis_id:
            rows.append((uis_id.group(1),
                         screen.group(1).strip() if screen else dname,
                         req_f.group(1) if req_f else '[TBD]', dname, cap_tag))
    toc = '# UI 화면 목록 - ' + domain + '\n\n| UIS-ID | 화면명 | REQ-ID | 유형 |\n|--------|--------|--------|------|\n'
    for uid, nm, req, dn, tag in rows:
        toc += '| ' + uid + ' | [' + nm + '](./' + dn + '/spec.md) | ' + req + ' | ' + tag + ' |\n'
    open(os.path.join(ui_dir, '_TOC.md'), 'w', encoding='utf-8').write(toc)
    print(domain + ': _TOC.md ' + str(len(rows)) + '건')
"
```

---

## 완료

```bash
!python -c "
import json, os, datetime

try:
    import sys
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

cp = json.load(open('_tmp/recon_checkpoint.json', encoding='utf-8')) if os.path.exists('_tmp/recon_checkpoint.json') else {}
cp.update({'phase': 'recon-uis', 'completed_at': datetime.datetime.now().isoformat(), 'status': 'ok'})
json.dump(cp, open('_tmp/recon_checkpoint.json','w'), ensure_ascii=False, indent=2)
inv = json.load(open('_tmp/screen_inventory.json', encoding='utf-8'))
cap_cnt = len([s for s in inv if s.get('captureDir')])
print('완료: 화면 ' + str(len(inv)) + '개 / 캡처 ' + str(cap_cnt) + '개 / spec.md 생성')
print('다음 커맨드: /sl-recon-inf')
"
```
