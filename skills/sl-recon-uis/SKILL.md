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
- `menuPath[0]` (L1 GNB 카테고리) = 도메인 — 매핑 불필요

**실행 순서:**
1. STEP 6-1: Chrome + 로그인 (브라우저 환경 준비)
2. STEP 6-2: BFS 전수 탐색 → `uis_capture_map.json` 생성
3. STEP 6-2-3: BFS → 도메인 구조 자동생성 + 소스 파일 역매핑 (선택적 보강)
4. ✋ STEP 6-2-4: 사용자 검토 (필수 체크포인트)
5. STEP 6-3: UIS spec 생성 (브라우저 불필요, ddd-ui-agent 배치)
6. STEP 6-4: api_hints 수집
7. STEP 6-5: _TOC.md 생성

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

> `spec_only=true`이면 **STEP 6-1과 STEP 6-2를 건너뛰고 STEP 6-2-3으로 바로 이동**한다.

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
if errors:
    for e in errors: print(e)
    sys.exit(1)

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
base_url = env.get('PREVIEW_BASE_URL', '')
if not base_url:
    print('[FAIL] PREVIEW_BASE_URL 미설정')
    print('  project.env에 PREVIEW_BASE_URL=http://localhost:8080 추가 후 재실행')
    sys.exit(1)

cap_exists = os.path.exists('_tmp/uis_capture_map.json')
if cap_exists:
    cap_map = json.load(open('_tmp/uis_capture_map.json', encoding='utf-8'))
    print('[재개] 기존 캡처 ' + str(len(cap_map)) + '개 — BFS 재개 가능')
else:
    print('[신규] BFS 전수 탐색 시작')

print('[OK] PREVIEW_BASE_URL = ' + base_url)
"
```

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

**루프 종료 조건:**
- depth=0 frame=main 항목 전부 `clicked_labels`에 있음
- AND visible 항목 중 미클릭 nav-link 없음
- OR 연속 5회 click 후 `activeRoute`/navigables 변화 없음

---

## STEP 6-2-3: BFS 결과 → 도메인 구조 자동생성 + 소스 역매핑

> **설계 원칙**:
> - 도메인 = `menuPath[0]` (L1 GNB 카테고리). 정적분석 도메인과 무관.
> - `_domain_plan.json` = BFS 완료 후 자동 생성. 사전에 존재할 필요 없음.
> - 소스 역매핑 = `activeRoute` → controller/JSP 역추적 (선택적 보강).

### 6-2-3-A: menuPath[0] → 도메인 구조 자동생성 + 도메인 코드 추출

> **도메인 코드 규칙**: `INF-BRD-001`, `UIS-ORD-001`, `SCH-PRD-001` 형식.
> 도메인명은 **LLM이 비즈니스 의미 기반으로 동적 생성** — 하드코딩 맵 없음.
> 회사·프로젝트마다 도메인명이 다르므로 LLM 판단으로 어느 시스템에도 적용 가능.
> 사용자가 STEP 6-2-4에서 확인/수정 가능.

**Phase 1 — 도메인명 목록 추출**

```bash
!python -c "
import json, os, sys, re
from collections import OrderedDict

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

# 도메인 필터 읽기
mode = {}
if os.path.exists('_tmp/_recon_uis_mode.json'):
    mode = json.load(open('_tmp/_recon_uis_mode.json', encoding='utf-8'))
domain_filter = mode.get('domain_filter')

cap_map = json.load(open('_tmp/uis_capture_map.json', encoding='utf-8'))

# 도메인 필터가 있으면 해당 도메인 항목만 처리
if domain_filter:
    work_map = [e for e in cap_map if
                e.get('domain', '') == domain_filter or
                (not e.get('domain') and (e.get('menuPath', [''])[0] == domain_filter))]
    print('[도메인 필터] ' + domain_filter + ': ' + str(len(work_map)) + '개 (전체 ' + str(len(cap_map)) + '개 중)')
else:
    work_map = cap_map

# menuPath[0] = 도메인 (L1 GNB 카테고리)
domain_screens = OrderedDict()
for entry in work_map:
    mp = entry.get('menuPath', [])
    domain = mp[0] if mp else 'unknown'
    if domain not in domain_screens:
        domain_screens[domain] = []
    domain_screens[domain].append(entry)

# 도메인 필터: 이미 코드가 있으면 재사용
if domain_filter and os.path.exists('_tmp/domain_codes.json'):
    existing_codes = json.load(open('_tmp/domain_codes.json', encoding='utf-8'))
    if domain_filter in existing_codes:
        print('  코드 재사용: ' + domain_filter + ' = ' + existing_codes[domain_filter])

domains_list = list(domain_screens.keys())
os.makedirs('_tmp', exist_ok=True)
json.dump(domains_list, open('_tmp/_bfs_domains_raw.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

print('처리 도메인 목록 (' + str(len(domains_list)) + '개):')
for d in domains_list:
    print('  - ' + d + ' (' + str(len(domain_screens[d])) + '개 화면)')
print()
print('→ _tmp/_bfs_domains_raw.json 저장 완료')
"
```

**Phase 2 — LLM 도메인 코드 생성**

`_tmp/_bfs_domains_raw.json`을 Read 도구로 읽어, 각 도메인명에 대해 **영어 약어(2~4자 대문자)**를 배정한 후 Write 도구로 `_tmp/domain_codes.json`을 생성하세요.

**도메인 필터 모드인 경우**: 기존 `_tmp/domain_codes.json`이 있으면 Read 도구로 읽어 이미 코드가 있는 도메인은 재사용하고, 새 도메인만 추가 배정한다.

배정 규칙:
- 도메인의 **비즈니스 의미**를 영어로 번역 (예: 방송관리→BRD, 협력사관리→VND, 주문→ORD, 상품→PRD)
- 도메인명이 이미 영문이면 앞 3자 대문자 사용
- **중복 코드 불가** — 겹치면 숫자 suffix 추가 (예: ORD, ORD2)
- 형식: `{"도메인명": "코드", ...}`

> 이 단계는 Python 스크립트가 아니라 LLM이 직접 Write 도구로 파일을 생성합니다.

**Phase 3 — ID 배정 + 산출물 저장**

```bash
!python -c "
import json, os, sys, re
from collections import OrderedDict

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

# 도메인 필터 읽기
mode = {}
if os.path.exists('_tmp/_recon_uis_mode.json'):
    mode = json.load(open('_tmp/_recon_uis_mode.json', encoding='utf-8'))
domain_filter = mode.get('domain_filter')

cap_map = json.load(open('_tmp/uis_capture_map.json', encoding='utf-8'))
domain_codes = json.load(open('_tmp/domain_codes.json', encoding='utf-8'))

# 처리 대상: 도메인 필터가 있으면 해당 도메인만
if domain_filter:
    work_map = [e for e in cap_map if
                e.get('domain', '') == domain_filter or
                (not e.get('domain') and e.get('menuPath', [''])[0] == domain_filter)]
else:
    work_map = cap_map

domain_screens = OrderedDict()
for entry in work_map:
    mp = entry.get('menuPath', [])
    domain = mp[0] if mp else 'unknown'
    if domain not in domain_screens:
        domain_screens[domain] = []
    domain_screens[domain].append(entry)

def safe_label(s):
    return re.sub(r'[/\\\\:*?\"<>|]', '', s).strip()

# 누락 도메인 fallback
idx = 1
for domain in domain_screens:
    if domain not in domain_codes:
        while ('D' + str(idx).zfill(2)) in domain_codes.values():
            idx += 1
        domain_codes[domain] = 'D' + str(idx).zfill(2)
        idx += 1

for domain, items in domain_screens.items():
    code = domain_codes[domain]
    for i, item in enumerate(items):
        item['domain'] = domain
        uid_num = i + 1
        item['uisId'] = code + '-' + str(uid_num).zfill(3)
        item['specDirName'] = ('UIS-' + code + '-' + str(uid_num).zfill(3)
                               + '_' + safe_label(item.get('screenLabel', 'screen')))
        if not item.get('screenId'):
            ar = item.get('activeRoute', '')
            seg = [s for s in ar.rstrip('/').split('/') if s]
            item['screenId'] = seg[-1] if seg else item.get('screenLabel', 'screen')

json.dump(cap_map, open('_tmp/uis_capture_map.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

# _domain_plan.json: 도메인 필터면 타 도메인 보존하고 대상 도메인만 교체
plan_path = 'docs/05_설계서/_domain_plan.json'
os.makedirs('docs/05_설계서', exist_ok=True)
if domain_filter and os.path.exists(plan_path):
    existing_plan = json.load(open(plan_path, encoding='utf-8'))
    other_domains = [d for d in existing_plan.get('domains', []) if d['name'] != domain_filter]
else:
    other_domains = []

new_domains = []
for domain, items in domain_screens.items():
    code = domain_codes[domain]
    new_domains.append({
        'name': domain,
        'code': code,
        'description': domain + ' (BFS 자동 추출)',
        'source': 'BFS',
        'uis': {'start': 1, 'end': len(items)},
        'inf': {'start': 1, 'end': len(items)},
        'sch': {'start': 1, 'end': len(items)},
        'rootPaths': [],
        'screens': [e.get('specDirName', e.get('screenId','')) for e in items],
    })

bfs_plan = {
    'project': os.path.basename(os.getcwd()),
    'source': 'BFS',
    'generatedAt': __import__('datetime').datetime.now().isoformat(),
    'idFormat': '{type}-{code}-{NNN:03d}',
    'domains': other_domains + new_domains,
}
json.dump(bfs_plan, open(plan_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

print('도메인 자동 추출 완료 (BFS menuPath[0] + LLM 코드):')
print()
print('  도메인명'.ljust(20) + '코드'.ljust(6) + '화면 수')
print('  ' + '-' * 35)
for domain, items in domain_screens.items():
    code = domain_codes[domain]
    sample = 'UIS-' + code + '-001 ~ UIS-' + code + '-' + str(len(items)).zfill(3)
    print('  ' + domain.ljust(20) + code.ljust(6) + str(len(items)).rjust(3) + '개   ' + sample)
if domain_filter and other_domains:
    print('  (타 도메인 ' + str(len(other_domains)) + '개 보존)')
print()
print('총 ' + str(len(cap_map)) + '개 화면, ' + str(len(other_domains) + len(new_domains)) + '개 도메인')
print('_domain_plan.json 생성/갱신 완료')
print()
print('[주의] 도메인 코드가 잘못됐으면 STEP 6-2-4에서 직접 수정 가능')
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
    진입 파일: {entryFile or "소스 미매핑 (캡처만)"}
    도메인: {domain}
    UIS ID: UIS-{uisId}          ← 예: UIS-BP-001
    INF ID 범위: INF-{uisId} 대응  ← 예: INF-BP-001
    스펙 저장 경로: docs/05_설계서/{domain}/UI/{specDirName}/spec.md
    INF 디렉토리: docs/05_설계서/{domain}/INF/
    캡처 디렉토리: {captureDir}
    MODE: RECON
    워크스페이스: {현재 작업 디렉토리 절대경로}

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
