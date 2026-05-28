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

### STEP 6-2-2: Claude 주도 탐색 + 캡처 루프

**Claude가 직접 ai_nav.js를 반복 호출하며 탐색 결정을 내린다.**
스크립트는 DOM 조작 / 스크린샷 / 마커 생성만 수행하고, 어디로 갈지 판단은 Claude가 한다.

> ⚠️ **goto로 직접 URL 접근 금지 (1단계)** — enterprise 앱은 메뉴 context 없이 직접 URL 접근 시
> 빈 화면 / 리다이렉트가 발생한다. **반드시 메뉴 클릭 BFS로 탐색**하고,
> 메뉴로 찾지 못한 화면만 2단계에서 goto를 시도한다.

**상태 관리 (Claude가 메모리에서 추적):**
- `visited_routes` — 방문 완료한 route 집합
- `clicked_navs` — 클릭 완료한 nav-link 텍스트 집합
- `captured` — 캡처+마커 완료한 screenId 집합
- `new_screens` — 정적 분석에 없는 신규 발견 화면 목록 `[{route, title, url}]`

---

**[1단계] 메뉴 BFS 탐색 — goto 없이 클릭만 사용**

루프 시작 — 현재 페이지 스냅샷 획득:

```
!node {AI_NAV} --port={CDP_PORT} --workspace={CWD} snapshot
```

**매 iteration 판단 순서:**

1. 반환된 JSON의 `route`를 `screen_inventory.json`과 비교:
   - **매핑 O + 미캡처** → 즉시 캡처 (스크린샷 + 마커 자동 생성):
     ```
     !node {AI_NAV} --port={CDP_PORT} --workspace={CWD} capture {screenId}
     ```
   - **매핑 X** → `new_screens`에 `{route, title, url}` 기록
   - 현재 route를 `visited_routes`에 추가

2. `navigables` 중 **클릭하지 않은 nav-link** 선택:
   - `hasChildren: true` 항목 우선 (서브메뉴 존재 가능) → 클릭 후 snapshot 재확인
   - `type: "nav-link"` 중 `clicked_navs`에 없는 항목
   - **반드시 클릭으로 이동** — goto 절대 사용하지 않음:
     ```
     !node {AI_NAV} --port={CDP_PORT} --workspace={CWD} click "메뉴명"
     ```
   - 클릭 텍스트를 `clicked_navs`에 추가

3. 새 snapshot 반환 → 1번으로 반복

**1단계 종료 조건:**
- `navigables`에 미클릭 `nav-link`가 없음
- 또는 연속 3회 `click` 후 route / DOM 변화 없음

---

**[2단계] 미캡처 화면 직접 goto 보완**

1단계 BFS가 끝난 후, `screen_inventory.json`에서 아직 `captured`에 없는 화면에 한해
정적 분석의 route로 직접 접근을 시도한다.

```
# 미캡처 screenId 목록 확인 후 순서대로:
!node {AI_NAV} --port={CDP_PORT} --workspace={CWD} goto "{route}"
# → 정상 화면이면 capture, 빈 화면 / 리다이렉트면 스킵 (와이어프레임으로 처리)
!node {AI_NAV} --port={CDP_PORT} --workspace={CWD} capture {screenId}
```

**2단계 종료 조건:** 미캡처 화면 모두 시도 완료

### STEP 6-2-3: 캡처 결과 반영

캡처된 화면의 `captureDir`를 screen_inventory에 업데이트하고,
신규 발견 화면을 inventory에 추가한다. **(UIS spec 생성 전 반드시 완료)**

```bash
!python -c "
import json, os

try:
    import sys
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

inv      = json.load(open('_tmp/screen_inventory.json', encoding='utf-8'))
cap_root = os.path.join('_tmp', 'captures')

updated = 0
for s in inv:
    sid = s.get('screenId', '')
    if not sid: continue
    cap_dir = os.path.join(cap_root, sid)
    if os.path.isdir(cap_dir) and any(f.endswith('.png') for f in os.listdir(cap_dir)):
        s['captureDir'] = cap_dir.replace(chr(92), '/')
        updated += 1

json.dump(inv, open('_tmp/screen_inventory.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('captureDir 업데이트: ' + str(updated) + '개')
captured_list = [s for s in inv if s.get('captureDir')]
not_captured  = [s for s in inv if not s.get('captureDir')]
for s in captured_list:
    print('  [캡처O] ' + s.get('screenId','').ljust(30) + ' ' + s.get('route',''))
if not_captured:
    print('캡처 미완 (와이어프레임으로 처리): ' + str(len(not_captured)) + '개')
    for s in not_captured:
        print('  [와이어프레임] ' + s.get('screenId','').ljust(30) + ' ' + s.get('route',''))
"
```

탐색 중 발견한 `new_screens`(정적 분석에 없던 화면)가 있으면 아래 스크립트에서
`new_screens` 리스트를 직접 채워 실행한다:

```bash
!python -c "
import json, os

try:
    import sys
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

# Claude가 탐색 루프에서 수집한 신규 화면 목록을 아래에 채운다
new_screens = []  # 예: [{'route': '/order/popup', 'title': '주문 팝업', 'url': 'http://...'}]

if not new_screens:
    print('신규 화면 없음'); import sys; sys.exit(0)

inv  = json.load(open('_tmp/screen_inventory.json', encoding='utf-8'))
plan = json.load(open('docs/05_설계서/_domain_plan.json', encoding='utf-8'))

uis_max = {d['name']: d['uis']['start'] for d in plan['domains']}
for s in inv:
    dom = s.get('domain','')
    if dom and s.get('uisId'):
        uis_max[dom] = max(uis_max.get(dom, 0), s['uisId'] + 1)

def assign_domain(route):
    seg = [s for s in route.lstrip('/').split('/') if s]
    if seg:
        for d in plan['domains']:
            if d['name'].lower() in seg[0].lower() or seg[0].lower() in d['name'].lower():
                return d['name']
    return plan['domains'][0]['name']

existing_routes = {s.get('route','') for s in inv}
cap_root = os.path.join('_tmp', 'captures')
added = 0
for ns in new_screens:
    route = ns.get('route', '')
    if not route or route in existing_routes: continue
    domain = assign_domain(route)
    uis_id = uis_max.get(domain, 0)
    uis_max[domain] = uis_id + 1
    sid = route.replace('/', '_').strip('_') or ('ai_screen_' + str(added + 1))
    cap_dir = os.path.join(cap_root, sid)
    inv.append({
        'route':          route,
        'domain':         domain,
        'entryFile':      '',
        'componentFiles': [],
        'uisId':          uis_id,
        'screenId':       sid,
        'screenName':     ns.get('title', sid),
        'captureDir':     cap_dir.replace(chr(92), '/') if os.path.isdir(cap_dir) else '',
        'infDir':         '../../INF/',
        'source':         'bfs:ai',
    })
    existing_routes.add(route)
    added += 1

json.dump(inv, open('_tmp/screen_inventory.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(str(added) + '개 신규 화면 추가 (source: bfs:ai) -> 총 ' + str(len(inv)) + '개')
"
```

---

## STEP 6-3: UIS 스펙 생성 (ddd-ui-agent 배치)

**STEP 6-2(캡처) 완료 후 실행.**
captureDir가 있는 화면은 실제 스크린샷+마커를 spec에 포함하고,
없는 화면은 소스 기반 와이어프레임으로 생성한다.
spec.md가 이미 있으면 캡처 유무 관계없이 재생성(덮어쓰기)한다.

```bash
!python -c "
import json, os

try:
    import sys
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

inv = json.load(open('_tmp/screen_inventory.json', encoding='utf-8'))
ws  = os.getcwd()

pending = []
for s in inv:
    sid    = s.get('screenId') or os.path.splitext(os.path.basename(s.get('entryFile','')))[0]
    domain = s.get('domain','')
    spec   = 'docs/05_설계서/' + domain + '/UI/' + sid + '/spec.md'
    cap    = s.get('captureDir','')
    merged = dict(s)
    merged['_specExists'] = os.path.exists(spec)
    merged['_specPath']   = spec
    merged['_screenId']   = sid
    merged['_hasCapture'] = bool(cap and os.path.isdir(cap))
    pending.append(merged)

cap_cnt  = len([p for p in pending if p['_hasCapture']])
wire_cnt = len([p for p in pending if not p['_hasCapture']])
print('전체 ' + str(len(pending)) + '개 (캡처포함: ' + str(cap_cnt) + '개 / 와이어프레임: ' + str(wire_cnt) + '개)')
print()
for i, p in enumerate(pending, 1):
    mode = '[캡처]  ' if p['_hasCapture'] else '[와이어]'
    print('  ' + str(i).rjust(3) + '. ' + mode + ' ' + p['_screenId'].ljust(30) + ' ' + p['route'])
"
```

`_tmp/screen_inventory.json`의 각 항목을 3개씩 묶어 `ddd-ui-agent`를 병렬 호출한다.
**captureDir를 반드시 포함해 에이전트가 실제 캡처 이미지를 spec에 반영할 수 있게 한다:**

```
각 배치(3개씩) -> Agent 도구 호출:
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
    캡처 디렉토리: {captureDir if _hasCapture else "없음 (소스 기반 와이어프레임)"}
    MODE: RECON
    워크스페이스: {현재 작업 디렉토리 절대경로}

    [화면 2] ...
    [화면 3] ...

    캡처 디렉토리가 있는 화면:
    - {captureDir}/capture.png  : 원본 스크린샷
    - {captureDir}/annotated.png : 마커가 표시된 스크린샷 (있으면 우선 사용)
    - {captureDir}/widgets.json : 감지된 UI 위젯 목록 (버튼/인풋/테이블 등)
    spec.md의 미리보기 섹션에 annotated.png 경로를 상대경로로 삽입하고
    widgets.json 기반으로 UI 컴포넌트 목록을 작성할 것.

각 배치 완료 후 다음 배치 시작 (3개씩 순차).
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
