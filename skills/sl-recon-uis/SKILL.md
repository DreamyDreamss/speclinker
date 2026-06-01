---
name: sl-recon-uis
description: RECON Phase-2 — BFS 브라우저 전수 탐색(E2E 스타일)으로 화면 목록 확정 → 소스 역매핑 → UIS 설계서 생성. /sl-recon 완료 후 실행.
triggers:
  - /sl-recon-uis
---

# /sl-recon-uis — 화면 설계서 생성 (BFS-First)

**E2E 스타일 화면 발견**: Playwright E2E 테스트처럼 실제 브라우저로 모든 메뉴를 순회하여
런타임 화면 목록을 확정 → 각 화면의 소스 파일 역매핑 → UIS 생성.

**왜 BFS-First인가:**
- 정적분석은 프레임워크(jwork, Spring MVC 등) URL 패턴을 모른다
- 실제 앱에서 보이는 화면이 진실 — URL prefix, 권한 제한 화면, 동적 라우팅 모두 자동 대응
- 화면 렌더링 시 발생하는 XHR/Fetch URL → INF path 매핑 → INF 도메인 결정론적 사용 (GNB 텍스트 해석 불필요)

**실행 순서:**
1. STEP 6-1: Chrome + 로그인 (브라우저 환경 준비)
2. STEP 6-2: BFS 전수 탐색 → `uis_capture_map.json` 생성
3. STEP 6-2-3: BFS → 도메인 구조 자동생성 + 소스 파일 역매핑 (선택적 보강)
4. STEP 6-2-3-C: 탭 화면 자동 감지 → 탭 서브엔트리 추가 (`detect_tabs.py`)
5. STEP 6-2-3-D: 탭 서브엔트리 캡처 (`capture_single_tab.js --tab=N`)
6. ✋ STEP 6-2-4: 사용자 검토 (필수 체크포인트)
7. STEP 6-3: UIS spec 생성 (ddd-ui-agent 배치 — **Phase 0.5에서 LLM이 이미지+소스 분석 → 블록 마커 생성 → annotate 실행**)
8. STEP 6-4: api_hints 수집
9. STEP 6-5: _TOC.md 생성

---

## 실행 인수 파싱

인수가 있으면 도메인 필터 / 실행 모드를 결정한다.

| 인수 형식 | 설명 |
|---------|------|
| (없음) | 전체 BFS + 전체 UIS 생성 |
| `방송관리` | 해당 GNB만 BFS + UIS 생성 (타 도메인 보존) |
| `--spec-only 방송관리` | BFS 없이 기존 캡처 기반 UIS spec 재생성만 |

**지금 실행된 인수를 확인하고 Write 도구로 `_tmp/_recon_uis_mode.json`을 생성하세요:**

- 인수가 `--spec-only 방송관리` 형식 → `{"domain_filter": "방송관리", "spec_only": true}`
- 인수가 `방송관리`만 → `{"domain_filter": "방송관리", "spec_only": false}`
- 인수가 없음 → `{"domain_filter": null, "spec_only": false}`

```bash
!python -c "
import json, os, sys
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

mode = json.load(open('_tmp/_recon_uis_mode.json', encoding='utf-8'))
df   = mode.get('domain_filter')
so   = mode.get('spec_only', False)

if df:
    tag = '[spec-only 재생성]' if so else '[도메인 필터]'
    print(tag + ' 대상: ' + df)
    if os.path.exists('_tmp/uis_capture_map.json'):
        cap = json.load(open('_tmp/uis_capture_map.json', encoding='utf-8'))
        other  = [e for e in cap if e.get('domain','') != df]
        target = [e for e in cap if e.get('domain','') == df]
        print('  기존 cap_map: 전체 ' + str(len(cap)) + '개 (타도메인 ' + str(len(other)) + '개 보존 / 대상 ' + str(len(target)) + '개 재탐색)')
    if so:
        print()
        print('→ STEP 6-1, 6-2 스킵 — STEP 6-2-3으로 바로 이동')
else:
    print('[전체 모드] 모든 GNB BFS + 전체 UIS 생성')
"
```

> - `spec_only=true` → **STEP 6-1, 6-2 스킵 → STEP 6-2-3**  
> - `static_fallback=true` (실행 전 확인에서 자동 설정) → **STEP 6-1, 6-2 스킵 → STEP 6-0 → STEP 6-2-3**

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

if not os.path.exists('_tmp/recon_checkpoint.json'):
    print('[FAIL] recon_checkpoint.json 없음 -> /sl-recon 먼저 실행')
    sys.exit(1)

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
base_url = env.get('PREVIEW_BASE_URL', '')

# mode json 로드/초기화
mode = {}
if os.path.exists('_tmp/_recon_uis_mode.json'):
    mode = json.load(open('_tmp/_recon_uis_mode.json', encoding='utf-8'))

if not base_url:
    print('[INFO] PREVIEW_BASE_URL 미설정 → 정적 소스 분석 fallback 모드')
    print('  /sl-recon STEP 4에서 생성된 screen_inventory_static.json 사용')
    mode['static_fallback'] = True
    os.makedirs('_tmp', exist_ok=True)
    json.dump(mode, open('_tmp/_recon_uis_mode.json', 'w', encoding='utf-8'),
              ensure_ascii=False, indent=2)
    print()
    print('→ STEP 6-1, 6-2 스킵 — STEP 6-0 (정적 fallback)으로 이동')
else:
    mode['static_fallback'] = False
    json.dump(mode, open('_tmp/_recon_uis_mode.json', 'w', encoding='utf-8'),
              ensure_ascii=False, indent=2)

    cap_exists = os.path.exists('_tmp/uis_capture_map.json')
    if cap_exists:
        cap_map = json.load(open('_tmp/uis_capture_map.json', encoding='utf-8'))
        print('[재개] 기존 캡처 ' + str(len(cap_map)) + '개 — BFS 재개 가능')
    else:
        print('[신규] BFS 전수 탐색 시작')

    cfg_path = '_tmp/capture_config.json'
    if os.path.exists(cfg_path):
        cfg = json.load(open(cfg_path, encoding='utf-8'))
        strategy = cfg.get('strategy', '?')
        desc     = cfg.get('description', '')
        print('[캡처 전략] strategy = ' + strategy + ' — ' + desc)
    else:
        print('[캡처 전략] capture_config.json 없음 → 기본: shell-iframe')

    print('[OK] PREVIEW_BASE_URL = ' + base_url)
"
```

> `static_fallback=true`이면 **STEP 6-1, 6-2를 건너뛰고 STEP 6-0으로 이동**한다.

---

## 캡처 전략 탐지

> BFS 실행 전 앱 구조에 맞는 캡처 전략을 탐지한다. `static_fallback=true`이면 스킵.

```bash
!python -c "
import os, sys, subprocess, json

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

mode = json.load(open('_tmp/_recon_uis_mode.json', encoding='utf-8'))
if mode.get('static_fallback') or mode.get('spec_only'):
    print('[SKIP] 캡처 전략 탐지 불필요 (static_fallback 또는 spec_only 모드)')
    sys.exit(0)

if os.path.exists('_tmp/capture_config.json'):
    cfg = json.load(open('_tmp/capture_config.json', encoding='utf-8'))
    print('[재사용] capture_config.json strategy=' + cfg.get('strategy','?'))
    sys.exit(0)

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
plugin   = env.get('PLUGIN_PATH', '')
cdp_port = env.get('PREVIEW_CDP_PORT', '9222')
script   = os.path.join(plugin, 'scripts', 'detect_capture_strategy.js') if plugin else ''

if not (script and os.path.exists(script)):
    print('[WARN] detect_capture_strategy.js 없음 — 기본값 shell-iframe 사용')
    os.makedirs('_tmp', exist_ok=True)
    json.dump({'strategy': 'shell-iframe', 'description': '기본값'}, 
              open('_tmp/capture_config.json', 'w', encoding='utf-8'))
    sys.exit(0)

r = subprocess.run(
    ['node', script, '--workspace=.', '--port=' + cdp_port],
    capture_output=True, text=True, encoding='utf-8', errors='replace'
)
print(r.stdout)
if r.returncode != 0:
    print('[WARN]', r.stderr[:300])

cfg_path = '_tmp/capture_config.json'
if os.path.exists(cfg_path):
    cfg = json.load(open(cfg_path, encoding='utf-8'))
    print('[캡처 전략] strategy = ' + cfg.get('strategy','?') + ' — ' + cfg.get('description',''))
    print('  ※ 전략이 틀렸으면 _tmp/capture_config.json의 strategy를 직접 수정하세요:')
    print('     shell-iframe | spa | mpa')
"
```

---

## STEP 6-0: 정적 Fallback (앱 미실행 시)

> `_tmp/_recon_uis_mode.json`의 `static_fallback=true`일 때만 실행한다.  
> `/sl-recon STEP 4`에서 이미 생성된 `_tmp/screen_inventory_static.json`을 직접 사용한다.  
> `static_fallback=false`이면 이 STEP을 **완전히 건너뛰고 STEP 6-1로 이동**한다.

```bash
!python -c "
import json, os, sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

mode = json.load(open('_tmp/_recon_uis_mode.json', encoding='utf-8'))
if not mode.get('static_fallback'):
    print('[SKIP] static_fallback=false — STEP 6-1로 이동')
    sys.exit(0)

# sl-recon STEP 4에서 생성된 form routes 인벤토리
inv_path = '_tmp/screen_inventory_static.json'
if not os.path.exists(inv_path):
    print('[FAIL] screen_inventory_static.json 없음 — /sl-recon STEP 4 먼저 실행')
    print('  힌트: /sl-recon을 실행하면 scan_source.js가 form routes를 자동 추출합니다')
    sys.exit(1)

inventory = json.load(open(inv_path, encoding='utf-8'))
if not inventory:
    print('[WARN] screen_inventory_static.json이 비어 있음')
    print()
    print('  가능한 원인:')
    print('  1. React/Vue/Angular SPA 프로젝트 → @Controller(JSP) 없음, form routes 없음')
    print('     해결: project.env에 PREVIEW_BASE_URL 설정 후 /sl-recon-uis 재실행 (BFS 모드)')
    print('       예) PREVIEW_BASE_URL=http://localhost:3000')
    print()
    print('  2. @RestController만 사용하는 REST API 전용 백엔드 (프론트 분리 구조)')
    print('     → 이 컴포넌트는 UIS 없음. /sl-recon-uis 불필요.')
    print('     → 프론트엔드 소스가 별도 디렉토리에 있으면 SOURCE_2_PATH 추가 후 /sl-recon 재실행')
    print()
    print('  3. scan_source.js가 form routes 미감지 (@Controller 어노테이션 비표준)')
    print('     → _tmp/source_index.json 직접 확인: routes[].kind 값 점검')
    print()
    print('  현재 진행 방법:')
    print('  A. (권장) PREVIEW_BASE_URL 설정 → BFS 모드')
    print('     project.env에 추가: PREVIEW_BASE_URL=http://localhost:8080')
    print('     그 후 /sl-recon-uis 재실행')
    print('  B. 이대로 진행 → uis_capture_map.json 빈 상태로 STEP 6-2-3 진행 (UIS 0개)')

# screen_inventory_static.json → uis_capture_map.json 포맷 변환
cap_map = []
for item in inventory:
    route = item.get('route', '')
    segs  = [s for s in route.rstrip('/').split('/') if s]
    label = item.get('screenId') or (segs[-1] if segs else 'screen')
    cap_map.append({
        'menuPath'       : segs,
        'screenLabel'    : label,
        'activeRoute'    : route,
        'contentRoute'   : route,
        'isIframeApp'    : False,
        'captureDir'     : '',
        'captureFile'    : '',
        'widgetCount'    : 0,
        'domain'         : item.get('domain', segs[0] if segs else 'unknown'),
        'screenId'       : label,
        'entryFile'      : item.get('entryFile', ''),
        'static_fallback': True,
    })

json.dump(cap_map, open('_tmp/uis_capture_map.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=2)
print('uis_capture_map.json 생성 완료: ' + str(len(cap_map)) + '개 화면')
print()
print('→ STEP 6-2-3으로 이동 (BFS 없이 도메인 구조 자동생성)')
"
```

> 정적 fallback 완료 후 **STEP 6-2-3으로 바로 이동**한다. STEP 6-1, 6-2는 건너뛴다.

---

## STEP 6-1: Chrome + 로그인 (브라우저 환경 준비)

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

> 사용자가 **"계속"** 하면 STEP 6-2로 이동.

---

## STEP 6-2: BFS 전수 탐색 (E2E 스타일)

**목표**: 실제 앱에서 접근 가능한 **모든 화면**을 발견한다.
- 정적 분석 결과 무관 — 브라우저가 보여주는 것이 진실
- `hasChildren=false` 메뉴 아이템 = 실제 화면 (depth 제한 없음)
- 각 화면: `activeRoute` + 스크린샷 + `menuPath` 수집
- `_tmp/uis_capture_map.json`에 실시간 저장 (재개 지원)

### STEP 6-2-1: 탐색 초기화

```bash
!python -c "
import json, os, sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
plugin   = env.get('PLUGIN_PATH', '')
cdp_port = env.get('PREVIEW_CDP_PORT', '9222')
ai_nav   = os.path.join(plugin, 'scripts', 'ai_nav.js') if plugin else ''
if not (ai_nav and os.path.exists(ai_nav)):
    print('[ERROR] ai_nav.js 없음 (PLUGIN_PATH 확인)'); sys.exit(1)
print('AI_NAV='   + ai_nav)
print('CDP_PORT=' + cdp_port)
print('CWD='      + os.getcwd())

# 도메인 필터 읽기
mode = {}
if os.path.exists('_tmp/_recon_uis_mode.json'):
    mode = json.load(open('_tmp/_recon_uis_mode.json', encoding='utf-8'))
domain_filter = mode.get('domain_filter')

all_existing = []
if os.path.exists('_tmp/uis_capture_map.json'):
    all_existing = json.load(open('_tmp/uis_capture_map.json', encoding='utf-8'))

if domain_filter:
    other_entries  = [e for e in all_existing if e.get('domain','') != domain_filter]
    target_entries = [e for e in all_existing if e.get('domain','') == domain_filter]
    visited_other  = set(e.get('activeRoute','') for e in other_entries)

    print('[도메인 필터] ' + domain_filter + ' 재탐색')
    print('  타 도메인 보존: ' + str(len(other_entries)) + '개 (visited_routes에 사전 등록)')
    print('  대상 도메인 재탐색: ' + str(len(target_entries)) + '개 (기존 항목 교체)')
    print()
    print('[BFS 초기화 지침]')
    print('  - visited_routes 초기값: 타 도메인 routes ' + str(len(visited_other)) + '개')
    print('  - capture_map 초기값: other_entries ' + str(len(other_entries)) + '개 보존')
    print('  - 대상 GNB: ' + domain_filter + ' 만 탐색 (다른 L1 GNB는 클릭하되 스킵 처리)')

    # BFS 루프가 읽을 수 있도록 other_entries 저장
    import json as _j
    os.makedirs('_tmp', exist_ok=True)
    _j.dump(other_entries, open('_tmp/_bfs_other_entries.json', 'w', encoding='utf-8'),
            ensure_ascii=False, indent=2)
    _j.dump(list(visited_other), open('_tmp/_bfs_visited_other.json', 'w', encoding='utf-8'),
            ensure_ascii=False, indent=2)
else:
    if all_existing:
        routes = [e.get('activeRoute','') for e in all_existing]
        print('재개: ' + str(len(all_existing)) + '개 이미 캡처됨')
        print('  visited_routes: ' + str(routes[:5]) + ('...' if len(routes) > 5 else ''))
    else:
        print('신규 탐색 시작')
"
```

### STEP 6-2-2: BFS 탐색 + 캡처 루프

**Claude 상태 변수 (메모리 추적):**

| 변수 | 타입 | 역할 |
|------|------|------|
| `capture_map` | list | 캡처 결과 누적 → 매 캡처 후 `_tmp/uis_capture_map.json`에 저장 |
| `visited_routes` | set | 이미 캡처한 `activeRoute` (중복 방지) |
| `clicked_labels` | set | 이미 클릭한 nav-link 텍스트 |
| `current_path` | list | BFS 현재 경로 — 클릭 depth 기반 갱신 |

**재개 지원**: `_tmp/uis_capture_map.json`이 존재하면 로드해 `visited_routes`에 기존 `activeRoute` 추가.

---

**도메인 필터 초기화 (`_tmp/_recon_uis_mode.json`의 `domain_filter`가 있는 경우):**

BFS 루프 시작 전:
1. `_tmp/_bfs_other_entries.json` 로드 → `capture_map` 초기값으로 사용 (타 도메인 보존)
2. `_tmp/_bfs_visited_other.json` 로드 → `visited_routes` 초기값에 추가 (타 도메인 재캡처 방지)
3. `clicked_labels`에 대상 도메인(`domain_filter`)이 아닌 **모든 L1 GNB 레이블을 사전 등록** → BFS가 해당 GNB는 클릭하더라도 그 하위 메뉴는 탐색하지 않음

**도메인 필터 BFS 규칙:**
- 우선순위 1 (depth=0 L1 GNB): `label == domain_filter`인 항목만 실제 탐색. 다른 L1 GNB는 `clicked_labels`에 추가해 종료 판단에서 제외
- LEAF 캡처 후 `entry.domain = domain_filter` 명시 설정
- 루프 종료 조건 추가: `domain_filter` 하위 모든 LEAF가 `clicked_labels`에 있으면 즉시 종료

**저장 시**: `capture_map` = other_entries(보존) + 새 domain_filter 캡처 결과 (합산해서 `_tmp/uis_capture_map.json` 저장)

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
  → LEAF 화면 → 클릭 후 캡처 실행
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

screenId 생성: `activeRoute`의 마지막 세그먼트 (예: `/app/order/pay/or416mForm` → `or416mForm`)

캡처 결과를 `capture_map`에 append:
```json
{
  "menuPath":    ["L1_GNB", "L2", ..., "leaf_label"],
  "screenLabel": "leaf_label",
  "activeRoute": "캡처결과.activeRoute",
  "contentRoute": "캡처결과.contentRoute",
  "isIframeApp": 캡처결과.isIframeApp,
  "captureDir":  "캡처결과.captureDir",
  "captureFile": "캡처결과.captureFile",
  "widgetCount": 캡처결과.widgetCount,
  "apiHints":    클릭결과.apiHints
}
```

> `apiHints`는 `click` 커맨드 결과의 `apiHints` 필드 값. 화면 렌더링 시 호출된 XHR/Fetch URL 목록.
> STEP 6-2-3에서 INF path와 매칭하여 이 화면의 도메인을 결정하는 데 사용된다.

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

**루프 종료 조건:**
- depth=0 frame=main 항목 전부 `clicked_labels`에 있음
- AND visible 항목 중 미클릭 nav-link 없음
- OR 연속 5회 click 후 `activeRoute`/navigables 변화 없음

---

## STEP 6-2-3: BFS 결과 → INF 매핑으로 도메인 결정 + ID 배정

> **설계 원칙**:
> - 도메인 = BFS 캡처 시 XHR/Fetch URL → 기존 INF `path:` 매칭 → INF의 도메인 (결정론적)
> - fallback: API 호출 없는 화면은 `menuPath[0]` (GNB L1) 사용
> - `_domain_plan.json`의 도메인 구조는 `/sl-recon`에서 확정됨 — BFS는 이를 재사용하고 `screens[]`만 갱신
> - 소스 역매핑 = `activeRoute` → controller/JSP 역추적 (선택적 보강)

### 6-2-3-A: INF path 인덱스 구축 + URL→domain 결정 + UIS ID 배정

**Phase 1 — INF path 인덱스 구축 + 화면 domain 결정**

```bash
!python -c "
import json, os, sys, re
from collections import defaultdict

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

# _domain_plan.json에서 기존 도메인 구조 로드 (sl-recon이 생성한 것)
plan_path = 'docs/05_설계서/_domain_plan.json'
if not os.path.exists(plan_path):
    print('[FAIL] _domain_plan.json 없음 — /sl-recon 먼저 실행')
    sys.exit(1)

plan = json.load(open(plan_path, encoding='utf-8'))
domain_code_map = {d['name']: d.get('code', '') for d in plan.get('domains', [])}

# GNB 텍스트 → 도메인명 정규화 매핑 (공백 제거 + 소문자 → 정확한 도메인명)
# "방송 관리" → "방송관리", "Order Mgmt" → "ordermgmt" 등 불일치 방지
def normalize_label(s):
    return re.sub(r'[\s_\-]', '', s).lower()

gnb_to_domain = {}
for d in plan.get('domains', []):
    gnb_to_domain[normalize_label(d['name'])] = d['name']

def resolve_domain_from_gnb(gnb_text):
    """GNB 레이블을 정규화해 _domain_plan.json의 도메인명과 매칭. 없으면 원본 반환."""
    if not gnb_text:
        return 'unknown'
    key = normalize_label(gnb_text)
    return gnb_to_domain.get(key, gnb_text)  # 정확 도메인명 없으면 GNB 원본 사용

# INF path → domain 인덱스 구축
inf_path_map = {}  # '/api/order/list' → '주문'
for d in plan.get('domains', []):
    domain = d['name']
    inf_dir = os.path.join('docs', '05_설계서', domain, 'INF')
    if not os.path.isdir(inf_dir):
        continue
    for fname in os.listdir(inf_dir):
        if not fname.endswith('.md'):
            continue
        try:
            content = open(os.path.join(inf_dir, fname), encoding='utf-8').read()
            pm = re.search(r'^path:\s*(\S+)', content, re.M)
            if pm:
                inf_path_map[pm.group(1)] = domain
        except Exception:
            pass

print('INF path 인덱스: ' + str(len(inf_path_map)) + '개 ('
      + str(len(domain_code_map)) + '개 도메인)')

# 도메인 필터 읽기
mode = {}
if os.path.exists('_tmp/_recon_uis_mode.json'):
    mode = json.load(open('_tmp/_recon_uis_mode.json', encoding='utf-8'))
domain_filter = mode.get('domain_filter')

cap_map = json.load(open('_tmp/uis_capture_map.json', encoding='utf-8'))

matched = 0
fallback = 0
for entry in cap_map:
    # 도메인 필터: 타 도메인 항목은 건드리지 않음
    if domain_filter and entry.get('domain') and entry.get('domain') != domain_filter:
        continue
    # 정적 fallback 항목은 domain 이미 설정됨
    if entry.get('static_fallback') and entry.get('domain'):
        continue

    api_hints = entry.get('apiHints', [])
    if not api_hints:
        # API 호출 없는 화면 → menuPath[0] fallback (정규화 매칭)
        mp = entry.get('menuPath', [])
        gnb = mp[0] if mp else ''
        entry['domain'] = entry.get('domain') or resolve_domain_from_gnb(gnb)
        fallback += 1
        continue

    # URL → INF 매칭 (정확 일치 2점, suffix 매칭 1점)
    domain_votes = defaultdict(int)
    for hint_url in api_hints:
        clean_url = hint_url.split('?')[0]  # 쿼리스트링 제거
        if clean_url in inf_path_map:
            domain_votes[inf_path_map[clean_url]] += 2
        else:
            for inf_path, dom in inf_path_map.items():
                if clean_url.endswith(inf_path) or inf_path.endswith(clean_url.lstrip('/')):
                    domain_votes[dom] += 1
                    break

    if domain_votes:
        entry['domain'] = max(domain_votes, key=domain_votes.get)
        matched += 1
    else:
        # INF 매칭 실패 → menuPath[0] fallback (정규화 매칭)
        mp = entry.get('menuPath', [])
        gnb = mp[0] if mp else ''
        entry['domain'] = entry.get('domain') or resolve_domain_from_gnb(gnb)
        fallback += 1

json.dump(cap_map, open('_tmp/uis_capture_map.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('도메인 결정: INF 매칭 ' + str(matched) + '개 / GNB fallback ' + str(fallback) + '개')
if fallback > 0:
    print('[INFO] GNB fallback 화면: STEP 6-2-4에서 도메인 수동 확인 권장')
if not inf_path_map:
    print('[WARN] INF 파일이 없어 전체 GNB fallback — /sl-recon STEP 4 완료 후 재실행 권장')
"
```

> INF 파일이 0개이면 전체 fallback(menuPath[0]). STEP 6-2-4에서 수동 확인.

**Phase 2 — UIS ID + specDirName 배정 + _domain_plan.json screens[] 갱신**

```bash
!python -c "
import json, os, sys, re
from collections import OrderedDict

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

plan_path = 'docs/05_설계서/_domain_plan.json'
plan = json.load(open(plan_path, encoding='utf-8'))
domain_code_map = {d['name']: d.get('code', '') for d in plan.get('domains', [])}

mode = {}
if os.path.exists('_tmp/_recon_uis_mode.json'):
    mode = json.load(open('_tmp/_recon_uis_mode.json', encoding='utf-8'))
domain_filter = mode.get('domain_filter')

cap_map = json.load(open('_tmp/uis_capture_map.json', encoding='utf-8'))

def safe_label(s):
    return re.sub(r'[/\\\\:*?\"<>|]', '', s).strip()

# 도메인별 화면 그룹화
domain_screens = OrderedDict()
for entry in cap_map:
    if domain_filter and entry.get('domain') != domain_filter:
        continue
    domain = entry.get('domain', 'unknown')
    if domain not in domain_screens:
        domain_screens[domain] = []
    domain_screens[domain].append(entry)

# 미지정 도메인 코드 fallback (D01, D02 ...)
idx = 1
used_codes = set(domain_code_map.values())
for domain in domain_screens:
    if domain not in domain_code_map or not domain_code_map[domain]:
        while ('D' + str(idx).zfill(2)) in used_codes:
            idx += 1
        domain_code_map[domain] = 'D' + str(idx).zfill(2)
        used_codes.add(domain_code_map[domain])
        idx += 1
        print('[WARN] 미매핑 도메인: ' + domain + ' → 임시 코드 ' + domain_code_map[domain])

for domain, items in domain_screens.items():
    code = domain_code_map.get(domain, 'XX')
    for i, item in enumerate(items):
        uid_num = i + 1
        item['domain'] = domain
        item['uisId'] = code + '-' + str(uid_num).zfill(3)
        item['specDirName'] = ('UIS-' + code + '-' + str(uid_num).zfill(3)
                               + '_' + safe_label(item.get('screenLabel', 'screen')))
        if not item.get('screenId'):
            ar = item.get('activeRoute', '')
            seg = [s for s in ar.rstrip('/').split('/') if s]
            item['screenId'] = seg[-1] if seg else item.get('screenLabel', 'screen')

json.dump(cap_map, open('_tmp/uis_capture_map.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

# _domain_plan.json: 도메인 구조(코드/rootPaths 등)는 건드리지 않고 screens[]만 갱신
domain_lookup = {d['name']: d for d in plan.get('domains', [])}
for domain, items in domain_screens.items():
    if domain in domain_lookup:
        domain_lookup[domain]['screens'] = [e.get('specDirName', e.get('screenId','')) for e in items]
        domain_lookup[domain]['bfsScreenCount'] = len(items)
    else:
        # BFS에서 새로 발견된 도메인 (INF 없는 순수 UI 도메인) → plan에 추가
        code = domain_code_map.get(domain, 'XX')
        plan['domains'].append({
            'name': domain, 'code': code,
            'description': domain + ' (BFS 발견, INF 없음)',
            'source': 'BFS-only',
            'uis': {'start': 1, 'end': len(items)},
            'inf': {'start': 0, 'end': 0},
            'sch': {'start': 0, 'end': 0},
            'rootPaths': [],
            'screens': [e.get('specDirName', e.get('screenId','')) for e in items],
            'bfsScreenCount': len(items),
        })
        print('[NEW] BFS 전용 도메인 추가: ' + domain + ' (' + code + ') — INF 연결 없음')

json.dump(plan, open(plan_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

print('UIS ID 배정 완료:')
print()
print('  도메인명'.ljust(20) + '코드'.ljust(6) + '화면 수')
print('  ' + '-' * 35)
for domain, items in domain_screens.items():
    code = domain_code_map.get(domain, 'XX')
    sample = 'UIS-' + code + '-001 ~ UIS-' + code + '-' + str(len(items)).zfill(3)
    print('  ' + domain.ljust(20) + code.ljust(6) + str(len(items)).rjust(3) + '개   ' + sample)
print()
print('_domain_plan.json screens[] 갱신 완료 (도메인 구조 보존)')
print('[주의] 도메인이 잘못됐으면 STEP 6-2-4에서 직접 수정 가능')
"
```

### 6-2-3-B: 소스 파일 역매핑 (선택적 보강)

`route_source_map.py`가 있으면 `activeRoute` → controller/JSP/service 경로를 보강한다.
없거나 실패해도 BFS 캡처만으로 UIS 생성 진행.

```bash
!python -c "
import os, sys, subprocess, json

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH', '')

# route_source_map.py 우선, 없으면 screen_inventory.py fallback
script = ''
for fname in ('route_source_map.py', 'screen_inventory.py'):
    candidate = os.path.join(plugin, 'scripts', fname) if plugin else ''
    if candidate and os.path.exists(candidate):
        script = candidate
        break

if not script:
    print('[INFO] 소스 역매핑 스크립트 없음 — 캡처만으로 UIS 생성')
else:
    print('[INFO] 소스 역매핑: ' + os.path.basename(script))
    r = subprocess.run([sys.executable, script, os.getcwd()],
                       capture_output=True, text=True, encoding='utf-8', errors='ignore')
    print(r.stdout[-2000:] if len(r.stdout) > 2000 else r.stdout)
    if r.returncode != 0:
        print('[WARN] 소스 역매핑 실패 — 캡처만으로 계속 진행')
        print(r.stderr[-300:] if r.stderr else '')
        sys.exit(0)  # 실패해도 계속

    # screen_inventory.json 이 생성됐으면 capture_map에 entryFile 보강
    if os.path.exists('_tmp/screen_inventory.json'):
        inv = json.load(open('_tmp/screen_inventory.json', encoding='utf-8'))
        cap_map = json.load(open('_tmp/uis_capture_map.json', encoding='utf-8'))

        def norm(r): return (r or '').rstrip('/').lower()
        inv_index = {norm(s.get('route','')): s for s in inv}

        def find_inv(ar):
            ar_n = norm(ar)
            if ar_n in inv_index: return inv_index[ar_n]
            for route, item in inv_index.items():
                if ar_n.endswith(route) or route.endswith(ar_n.lstrip('/')):
                    return item
            return None

        enriched = 0
        for entry in cap_map:
            inv_item = find_inv(entry.get('activeRoute',''))
            if inv_item:
                entry.setdefault('entryFile', inv_item.get('entryFile',''))
                entry.setdefault('componentFiles', inv_item.get('componentFiles',[]))
                enriched += 1

        json.dump(cap_map, open('_tmp/uis_capture_map.json','w',encoding='utf-8'), ensure_ascii=False, indent=2)
        print('소스 역매핑 보강: ' + str(enriched) + '/' + str(len(cap_map)) + '개 화면')
"
```

### 6-2-3-C: 탭 화면 자동 감지 (detect_tabs.py)

JSP 화면 중 다중탭 구조를 가진 화면을 감지하여 탭별 서브엔트리를 `uis_capture_map.json`에 추가한다.  
`<script src="*t01.js">` + `<div id="tab1">` 교집합 패턴으로 탭 확정. 2탭 미만이면 스킵.

```bash
!python -c "
import os, sys, subprocess, json, re

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH', '')
script = os.path.join(plugin, 'scripts', 'detect_tabs.py') if plugin else ''
ws = os.getcwd()

if not (script and os.path.exists(script)):
    print('[INFO] detect_tabs.py 없음 — 탭 감지 건너뜀')
    sys.exit(0)

r = subprocess.run([sys.executable, script, ws],
                   capture_output=True, text=True, encoding='utf-8', errors='ignore')
print(r.stdout[-3000:] if len(r.stdout) > 3000 else r.stdout)
if r.returncode != 0:
    print('[WARN] detect_tabs 실패 — 계속 진행')
    print(r.stderr[-300:] if r.stderr else '')

# 탭 서브엔트리 UIS ID 배정 (부모 uisId + '-T{탭번호}' 형식)
if not (os.path.exists('_tmp/uis_capture_map.json') and os.path.exists('_tmp/domain_codes.json')):
    sys.exit(0)

cap_map = json.load(open('_tmp/uis_capture_map.json', encoding='utf-8'))
domain_codes = json.load(open('_tmp/domain_codes.json', encoding='utf-8'))

def safe_label(s):
    return re.sub(r'[/\\\\:*?\"<>|]', '', s).strip()

parent_idx = {e.get('screenId'): e for e in cap_map if not e.get('parentScreenId')}
modified = 0

for entry in cap_map:
    if not entry.get('parentScreenId') or entry.get('uisId'):
        continue
    parent = parent_idx.get(entry.get('parentScreenId', ''))
    if not parent:
        continue
    domain = parent.get('domain', '')
    code = domain_codes.get(domain, 'XX')
    parent_uid = parent.get('uisId', '001')
    tab_idx = entry.get('tabIndex', 1)
    entry['uisId'] = parent_uid + '-T' + str(tab_idx).zfill(2)
    entry['domain'] = domain
    tab_label = entry.get('tabLabel', 'tab' + str(tab_idx))
    entry['specDirName'] = ('UIS-' + parent_uid
                            + '-T' + str(tab_idx).zfill(2)
                            + '_' + safe_label(tab_label))
    modified += 1

if modified:
    json.dump(cap_map, open('_tmp/uis_capture_map.json', 'w', encoding='utf-8'),
              ensure_ascii=False, indent=2)
    tab_count = len([e for e in cap_map if e.get('parentScreenId')])
    print('탭 서브엔트리 UIS ID 배정 완료: 전체 ' + str(tab_count) + '개 (신규 ' + str(modified) + '개)')
"
```

### 6-2-3-D: 탭 서브엔트리 캡처

`captureDir`가 없는 탭 서브엔트리를 `capture_single_tab.js --tab=N`으로 순차 캡처한다.  
부모 화면의 `activeRoute` + `tabIndex`를 사용하여 특정 탭의 스크린샷을 취득한다.

```bash
!python -c "
import json, os, sys, subprocess

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
plugin    = env.get('PLUGIN_PATH', '')
base_url  = env.get('PREVIEW_BASE_URL', '').rstrip('/')
cdp_port  = env.get('PREVIEW_CDP_PORT', '9222')
capture_js = os.path.join(plugin, 'scripts', 'capture_single_tab.js') if plugin else ''
ws = os.getcwd()

if not (capture_js and os.path.exists(capture_js)):
    print('[ERROR] capture_single_tab.js 없음'); sys.exit(1)

cap_map = json.load(open('_tmp/uis_capture_map.json', encoding='utf-8'))
tab_entries = [e for e in cap_map
               if e.get('parentScreenId') and not e.get('captureDir')]

if not tab_entries:
    print('[INFO] 캡처 필요한 탭 서브엔트리 없음 — 이미 완료됐거나 탭 화면 없음')
    sys.exit(0)

parent_idx = {e.get('screenId'): e for e in cap_map if not e.get('parentScreenId')}
print('탭 서브엔트리 캡처 시작: ' + str(len(tab_entries)) + '개')

for entry in tab_entries:
    parent     = parent_idx.get(entry.get('parentScreenId', ''), {})
    active_route = parent.get('activeRoute', '') or entry.get('activeRoute', '')
    screen_id  = entry.get('screenId', '')
    tab_index  = str(entry.get('tabIndex', 1))
    url        = base_url + active_route
    print('  캡처: ' + screen_id + ' (tab' + tab_index + ') ← ' + url)

    try:
        result = subprocess.run(
            ['node', capture_js,
             '--url=' + url,
             '--screenId=' + screen_id,
             '--workspace=' + ws,
             '--port=' + cdp_port,
             '--tab=' + tab_index,
             '--maxHeight=8000'],
            capture_output=True, text=True, encoding='utf-8', errors='ignore', timeout=90
        )
        data = json.loads(result.stdout.strip())
        if data.get('success'):
            entry['captureDir']  = data['captureDir']
            entry['captureFile'] = data['captureFile']
            entry['widgetCount'] = data.get('widgetCount', 0)
            print('    OK h=' + str(data.get('captureHeight','?')) + '  widgets=' + str(data.get('widgetCount',0)))
        else:
            print('    FAIL: ' + data.get('error', '?'))
    except Exception as ex:
        print('    ERROR: ' + str(ex))

json.dump(cap_map, open('_tmp/uis_capture_map.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
captured = len([e for e in tab_entries if e.get('captureDir')])
print()
print('탭 캡처 완료: ' + str(captured) + '/' + str(len(tab_entries)) + '개')
"
```

---

## ✋ STEP 6-2-4: 화면 목록 + 도메인 코드 검토 (필수 체크포인트)

BFS로 발견된 화면 목록과 자동 추출된 도메인 코드를 출력하고 피드백을 받는다.
**도메인 코드가 잘못됐으면 여기서 수정한다 — INF/UIS/SCH ID 전체에 영향.**

```bash
!python -c "
import json
try:
    import sys
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

cap_map = json.load(open('_tmp/uis_capture_map.json', encoding='utf-8'))
plan    = json.load(open('docs/05_설계서/_domain_plan.json', encoding='utf-8'))

code_map = {d['name']: d.get('code','??') for d in plan['domains']}
from collections import defaultdict
by_domain = defaultdict(list)
for e in cap_map:
    by_domain[e.get('domain','?')].append(e)

print('=' * 80)
print('BFS 발견 화면 목록 (총 ' + str(len(cap_map)) + '개)')
print('=' * 80)

# 도메인 코드 요약
print()
print('[도메인 코드 요약]  ← 코드 변경 시: \"코드수정 방송관리 BM\"')
print('  도메인명'.ljust(22) + '코드   ID 예시')
print('  ' + '-' * 50)
for d in plan['domains']:
    code = d.get('code','??')
    cnt  = len([e for e in cap_map if e.get('domain')==d['name']])
    print('  ' + d['name'].ljust(22) + code.ljust(5) + '  UIS-' + code + '-001 ~ UIS-' + code + '-' + str(cnt).zfill(3)
          + '  /  INF-' + code + '-001')

idx = 0
for domain, items in sorted(by_domain.items()):
    code = code_map.get(domain, '??')
    print()
    print('  [' + domain + '] (' + code + ')  ' + str(len(items)) + '개')
    for e in items:
        idx += 1
        mp    = ' > '.join(e.get('menuPath', []))
        uid   = 'UIS-' + e.get('uisId', '?')
        route = e.get('activeRoute', '')
        ef    = e.get('entryFile','')
        src   = ' ← ' + ef if ef else ''
        print('    ' + str(idx).rjust(3) + '. ' + uid.ljust(14) + mp[:40].ljust(40) + route[:35] + src)

print()
print('[피드백 방법]')
print('  이상없음     : \"계속\"')
print('  제외         : 제외 3,7')
print('  도메인수정   : 도메인 5 / 새도메인명')
print('  코드수정     : 코드수정 방송관리 BM   ← 도메인 코드 변경')
print('  화면명수정   : 수정 5 / 새화면명')
"
```

사용자 피드백을 받아 `_tmp/uis_capture_map.json`과 `_domain_plan.json`을 직접 수정한다.
**도메인 코드 변경 시**: `_domain_plan.json`의 `code` 수정 + `uis_capture_map.json`의 `uisId`/`specDirName` 일괄 재생성.

> **확인 전 STEP 6-3 절대 진행 금지.**

---

## STEP 6-3: UIS 스펙 생성 (ddd-ui-agent 배치)

**Phase 2 — 브라우저 불필요. `_tmp/uis_capture_map.json` 단독 입력.**
BFS로 발견된 화면만 UIS로 생성. 도메인별 3개씩 병렬 처리.

```bash
!python -c "
import json, os

try:
    import sys
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

# 도메인 필터 읽기
mode = {}
if os.path.exists('_tmp/_recon_uis_mode.json'):
    mode = json.load(open('_tmp/_recon_uis_mode.json', encoding='utf-8'))
domain_filter = mode.get('domain_filter')

cap_map = json.load(open('_tmp/uis_capture_map.json', encoding='utf-8'))
plan    = json.load(open('docs/05_설계서/_domain_plan.json', encoding='utf-8'))
code_map = {d['name']: d.get('code','XX') for d in plan['domains']}

from collections import defaultdict
by_domain = defaultdict(list)
for e in cap_map:
    by_domain[e.get('domain','unknown')].append(e)

# 도메인 필터 적용
if domain_filter:
    target_domains = {domain_filter: by_domain.get(domain_filter, [])}
    print('[도메인 필터] ' + domain_filter + ' 만 UIS 생성 (전체 ' + str(len(cap_map)) + '개 중 ' + str(len(target_domains.get(domain_filter,[]))) + '개)')
    by_domain = defaultdict(list, target_domains)
else:
    print('UIS 생성 대상: ' + str(len(cap_map)) + '개')
print()
for dom, items in sorted(by_domain.items()):
    code    = code_map.get(dom, 'XX')
    batches = (len(items) + 2) // 3
    print('  [' + dom + '] (' + code + ')  ' + str(len(items)) + '개  →  ' + str(batches) + '배치')
    for e in items:
        uid     = 'UIS-' + e.get('uisId', '?')
        spec_dn = e.get('specDirName', e.get('screenId',''))
        ef      = e.get('entryFile','')
        src     = ' [' + os.path.basename(ef) + ']' if ef else ' [캡처만]'
        print('    ' + uid.ljust(15) + spec_dn[:45] + src)
"
```

위 목록을 **도메인별로 3개씩 묶어** `ddd-ui-agent`를 병렬 호출한다:

```
각 배치(같은 도메인 3개씩) → Agent 도구 호출:
  subagent_type: "speclinker:ddd-ui-agent"
  description: "{domain}({code}) UIS 생성 ({specDirName1}, ...)"
  prompt: |
    처리 대상:

    [화면 1]
    메뉴경로: {menuPath.join(' > ')}
    라우트: {activeRoute}
    진입 파일: {entryFile or jspPath(탭 모드) or "소스 미매핑 (캡처만)"}
    도메인: {domain}
    UIS ID: UIS-{uisId}          ← 예: UIS-BP-001 / 탭 서브엔트리: UIS-BP-001-T01
    INF ID 범위: INF-{uisId} 대응  ← 예: INF-BP-001
    스펙 저장 경로: docs/05_설계서/{domain}/UI/{specDirName}/spec.md
    INF 디렉토리: docs/05_설계서/{domain}/INF/
    캡처 디렉토리: {captureDir}
    MODE: RECON
    워크스페이스: {현재 작업 디렉토리 절대경로}
    ← 탭 서브엔트리 (parentScreenId 있음) 인 경우에만 아래 4줄 추가:
    탭 인덱스: {tabIndex}           ← ddd-ui-agent 탭 모드 진입 트리거
    탭 레이블: {tabLabel}
    탭 JS 파일: {tabJsFile}         ← Phase 1에서 이 파일만 읽기 (다른 탭 JS 읽기 금지)
    부모 화면ID: {parentScreenId}
    JSP 파일: {jspPath}             ← 진입파일 (부모 JSP — 탭 섹션만 분석)

    [화면 2] ...
    [화면 3] ...

    캡처 디렉토리 파일:
    - {captureDir}/preview.png          : 실제 스크린샷 (1920x900px)
    - {captureDir}/preview_annotated.png : 마커 스크린샷 (있으면 우선)
    - {captureDir}/preview_widgets.json  : 감지된 위젯 목록
    화면명은 menuPath 마지막 항목 사용. spec.md에 이미지 상대경로 삽입.
    widgets.json 기반으로 UI 컴포넌트 목록 작성.
    entryFile이 없으면 캡처 이미지만으로 UI 구조 분석.

    [ID 형식 규칙]
    - UIS-ID: UIS-{uisId}  (예: UIS-BP-001)
    - INF 연결: INF-{uisId}  (예: INF-BP-001)
    - spec.md frontmatter: UIS-ID: UIS-{uisId}
    - 스펙 디렉토리명: {specDirName}  ← 반드시 이 이름으로 생성

각 배치 완료 후 다음 배치 시작.
```

> 모든 배치 완료 전 STEP 6-4 진행 금지.

---

## STEP 6-4: api_hints 수집

UIS spec.md에서 API 호출 패턴을 수집한다.

```bash
!python -c "
import os, re, json

try:
    import sys
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

cap_map = json.load(open('_tmp/uis_capture_map.json', encoding='utf-8'))

hints_all = {}
for e in cap_map:
    sid    = e.get('screenId','')
    domain = e.get('domain','')
    if not (sid and domain): continue

    spec = 'docs/05_설계서/' + domain + '/UI/' + sid + '/spec.md'
    if not os.path.exists(spec):
        continue

    body = open(spec, encoding='utf-8').read()
    for line in body.splitlines():
        m = re.search(r'(GET|POST|PUT|DELETE|PATCH)\s+\|.*?\|.*?(/[^\s|]+)', line, re.I)
        if m:
            key = m.group(1).upper() + ':' + m.group(2)
            hints_all[key] = {'url': m.group(2), 'method': m.group(1).upper(),
                              'screen': sid, 'domain': domain}

    gaps = '_tmp/' + sid + '_inf_gaps.json'
    if os.path.exists(gaps):
        for g in json.load(open(gaps, encoding='utf-8')).get('gaps', []):
            key = g['method'].upper() + ':' + g['url']
            hints_all[key] = {'url': g['url'], 'method': g['method'].upper(),
                              'screen': sid, 'domain': domain}

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

# 도메인 필터 읽기
mode = {}
if os.path.exists('_tmp/_recon_uis_mode.json'):
    mode = json.load(open('_tmp/_recon_uis_mode.json', encoding='utf-8'))
domain_filter = mode.get('domain_filter')

plan = json.load(open('docs/05_설계서/_domain_plan.json', encoding='utf-8'))
target_domains = plan['domains']
if domain_filter:
    target_domains = [d for d in plan['domains'] if d['name'] == domain_filter]
    print('[도메인 필터] ' + domain_filter + ' _TOC.md 재생성')

for d in target_domains:
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

cap_map = json.load(open('_tmp/uis_capture_map.json', encoding='utf-8')) if os.path.exists('_tmp/uis_capture_map.json') else []
plan = json.load(open('docs/05_설계서/_domain_plan.json', encoding='utf-8')) if os.path.exists('docs/05_설계서/_domain_plan.json') else {}
print('완료: 화면 ' + str(len(cap_map)) + '개 / 도메인 ' + str(len(plan.get('domains',[]))) + '개 / spec.md 생성')
print('다음 커맨드: /sl-recon-inf')
"
```
