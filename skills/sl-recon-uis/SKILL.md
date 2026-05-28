---
name: sl-recon-uis
description: RECON Phase-2 — 화면 캡처 + UIS 설계서 생성 (STEP 6). /sl-recon 완료 후 실행.
triggers:
  - /sl-recon-uis
---

# /sl-recon-uis — 화면 설계서 생성

## 실행 전 확인

```bash
!python3 -c "
import json, os, sys

errors = []
confirmed   = '.speclinker/screen_plan.confirmed.json'
domain_plan = 'docs/05_설계서/_domain_plan.json'
checkpoint  = '_tmp/recon_checkpoint.json'

if not os.path.exists(checkpoint):
    errors.append('[FAIL] recon_checkpoint.json 없음 — /sl-recon 먼저 실행')
if not os.path.exists(confirmed):
    errors.append('[FAIL] screen_plan.confirmed.json 없음 — /sl-recon STEP 2-2 확인')
if not os.path.exists(domain_plan):
    errors.append('[FAIL] _domain_plan.json 없음 — /sl-recon STEP 3 확인')

if errors:
    for e in errors: print(e)
    sys.exit(1)

screens = json.load(open(confirmed, encoding='utf-8')).get('screens', [])
domains = json.load(open(domain_plan, encoding='utf-8')).get('domains', [])
print(f'[OK] 확정 화면 {len(screens)}개 / 도메인 {len(domains)}개')
print('     → STEP 6-1에서 screen_inventory.json 생성 예정')
"
```

---

### STEP 6-0.5: 캡처 가능 여부 확인 + bootstrap 자동 실행

`PREVIEW_BASE_URL`과 `PREVIEW_STORAGE_STATE`(storageState) 상태를 확인하고,  
필요 시 bootstrap을 **이 단계에서 자동으로 실행**한다.

| 단계 | 역할 | 항상 실행? |
|------|------|---------|
| STEP 6-2 [A] 런타임 캡처 | DOM 구조·위젯 위치·스크린샷 → §0/§2/§4/§8 | PREVIEW_BASE_URL + Chrome CDP 포트 열려있을 때만 |
| STEP 6-3 [B] generate_uis_spec.py | widgets.json → spec.md 시각 초안 | widgets.json 있는 화면만 |
| STEP 6-4 [C] ddd-ui-agent | 소스 파일 → §5 인터랙션 + _inf_required.json | **항상** |

> **capture.js는 CDP attach 방식** — `runtime_capture.js`(구버전·deprecated)와 달리 storageState 불필요.  
> 사용자가 Chrome을 CDP 포트로 미리 실행하고 로그인한 상태에서 attach 한다.

```bash
!python3 -c "
import os
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
base_url = env.get('PREVIEW_BASE_URL', '')
cdp_port = env.get('PREVIEW_CDP_PORT', '9222')

print(f'PREVIEW_BASE_URL  : {base_url if base_url else \"미설정\"}')
print(f'PREVIEW_CDP_PORT  : {cdp_port}')

if not base_url:
    print()
    print('[캡처 스킵] PREVIEW_BASE_URL 미설정')
    print('  → project.env에 PREVIEW_BASE_URL=http://... 추가 후 재실행하면 캡처 활성화')
else:
    print()
    print('[캡처 준비] Chrome을 CDP 포트로 실행하고 로그인한 상태여야 합니다.')
    print('  Windows : start chrome --remote-debugging-port=' + cdp_port)
    print('  macOS   : open -a \"Google Chrome\" --args --remote-debugging-port=' + cdp_port)
    print('  Linux   : google-chrome --remote-debugging-port=' + cdp_port)
    print('  → 로그인 완료 후 STEP 6-2 진행')
"
```

> **사용자 액션 필요 (1회 설정):**  
> 1. Chrome을 `--remote-debugging-port=9222` 옵션으로 실행  
> 2. `PREVIEW_BASE_URL`에 접속하여 로그인 (2FA·SSO 포함)  
> 3. 로그인 완료 상태 유지 → STEP 6-2에서 `capture.js`가 attach하여 캡처 진행  
> → Chrome 세션이 살아있는 한 재로그인 불필요

---

### STEP 6-1: 화면 인벤토리 생성

화면 인벤토리를 생성한다. **Phase 7 경로**와 **KG 경로** 두 가지를 자동 분기한다:

| 조건 | 동작 |
|------|------|
| `.speclinker/screen_plan.confirmed.json` 존재 | Phase 7 확정 목록을 그대로 변환 (KG 미사용) |
| confirmed.json 없음 | KG 기반 라우터 자동감지 fallback |

```python
!python3 -c "
import os, sys, subprocess
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
kg_path = '{위에서 결정한 kg_path}'
script = os.path.join(plugin, 'scripts', 'screen_inventory.py') if plugin else ''
if script and os.path.exists(script):
    # confirmed.json 있으면 Phase 7 패스 자동 사용, 없으면 kg_path 전달
    subprocess.run([sys.executable, script, '.', kg_path], check=False)
else:
    print('screen_inventory.py 없음 — PLUGIN_PATH 확인')
"
```

오류 발생 시:
```bash
!python3 -c "
import json, os
path = '_tmp/screen_inventory.json'
if not os.path.exists(path):
    print('[ERROR] screen_inventory.json 없음 — screen_inventory.py 실행 오류')
else:
    data = json.load(open(path))
    print(f'감지 화면: {len(data)}개')
    for d in data[:5]:
        nf = len(d.get('componentFiles', []))
        print(f'  {d[\"source\"]:20} {d[\"route\"]:30} → {d[\"entryFile\"].split(\"/\")[-1]} (+참조 {nf}개)')
    if len(data) > 5: print(f'  ... 외 {len(data)-5}개')
"
```

### STEP 6-2: [A] 런타임 캡처 (PREVIEW_BASE_URL + Chrome CDP 열려있을 때만)

`capture.js`를 사용하여 각 화면을 개별 캡처한다.  
**PREVIEW_BASE_URL 미설정 또는 Chrome CDP 포트 닫혀있으면 이 단계를 스킵하고 STEP 6-3으로 이동한다.**

```bash
!python3 -c "
import os, subprocess, json, glob, sys
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
plugin   = env.get('PLUGIN_PATH', '')
base_url = env.get('PREVIEW_BASE_URL', '')
cdp_port = env.get('PREVIEW_CDP_PORT', '9222')
ws       = os.getcwd()

if not base_url:
    print('[캡처 스킵] PREVIEW_BASE_URL 미설정')
    sys.exit(0)

script = os.path.join(plugin, 'scripts', 'capture.js') if plugin else ''
if not (script and os.path.exists(script)):
    print('[ERROR] capture.js 없음 — PLUGIN_PATH 확인')
    sys.exit(1)

screens = json.load(open('_tmp/screen_inventory.json', encoding='utf-8'))
ok_count = skip_count = fail_count = 0
for s in screens:
    uid       = f'UIS-F-{s[\"uisId\"]:03d}' if isinstance(s.get('uisId'), int) else (s.get('uisId') or 'UIS-F-001')
    screen_id = s.get('screenId') or uid.lower().replace('-','_')
    ui_dir    = os.path.join('docs', '05_설계서', s['domain'], 'UI', screen_id)
    os.makedirs(ui_dir, exist_ok=True)

    # 이미 캡처된 화면 스킵 (재개 지원)
    if glob.glob(os.path.join(ui_dir, 'preview_tab*_*.png')) or \
       os.path.exists(os.path.join(ui_dir, 'preview.png')):
        print(f'{uid}: 캡처 이미 존재 — 스킵')
        skip_count += 1
        continue

    route_key = s['route'].split('/')[-1].split('?')[0] or screen_id
    r = subprocess.run(
        ['node', script,
         f'--out={ui_dir}',
         f'--frame-url={route_key}',
         '--tabs=auto', '--auto-annotate',
         f'--port={cdp_port}',
         f'--workspace={ws}'],
        capture_output=True, text=True, encoding='utf-8', errors='ignore')
    if r.returncode == 0:
        print(f'{uid}: 캡처 완료')
        ok_count += 1
    else:
        print(f'{uid}: [WARN] {(r.stderr or \"\")[:200]}')
        fail_count += 1

print(f'\\n캡처 완료: {ok_count}개 성공 / {skip_count}개 스킵 / {fail_count}개 실패')
"
```

> `capture.js --auto-annotate`가 각 화면 디렉토리(`docs/05_설계서/{domain}/UI/{화면ID}/`)에 생성하는 파일:
> - `preview_tab{N}_{탭명}.png` + `preview_tab{N}_{탭명}_annotated.png` — 탭별 스크린샷 + 어노테이션
> - `preview_tab{N}_{탭명}_widgets.json` — 탭별 위젯 목록
> - `network_requests.json` — XHR/fetch 인터셉트 기록
>
> `--auto-annotate` 플래그가 어노테이션까지 처리하므로 별도 `annotate_preview.py` 호출 불필요.

### STEP 6-3: [B] generate_uis_spec.py — 시각 spec.md 초안

`widgets.json` 또는 `preview_tab*_widgets.json`이 있는 화면에 실행한다.  
**없는 화면은 이 단계를 스킵한다** — ddd-ui-agent(STEP 6-4)가 전체 spec.md를 생성한다.

> **이 단계의 역할**: §0/§2/§4/§8 (레이아웃·위젯 위치·DOM 조건) 채움. §5는 `[TBD]` 상태로 남김.  
> **§5 채우는 것은 STEP 6-4 ddd-ui-agent의 역할** — 소스 파일 분석으로만 알 수 있음.

각 화면 디렉토리에 위젯 JSON이 있으면 실행한다:

```bash
# 배치 완료 후 각 화면에 대해:
!python3 -c "
import os, sys, subprocess, glob
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
ws = os.getcwd()
import json
screens = json.load(open('_tmp/screen_inventory.json', encoding='utf-8'))
for s in screens:
    uid = f'UIS-F-{s[\"uisId\"]:03d}' if isinstance(s.get('uisId'), int) else (s.get('uisId') or 'UIS-F-001')
    screen_id = s.get('screenId') or uid.lower().replace('-','_')
    ui_dir = os.path.join('docs', '05_설계서', s['domain'], 'UI', screen_id)
    # capture-first: preview_tab*_widgets.json 존재 여부 포함 체크
    has_widgets = (
        os.path.exists(os.path.join(ui_dir, 'widgets.json')) or
        bool(glob.glob(os.path.join(ui_dir, 'preview_tab*_widgets.json')))
    )
    if not has_widgets:
        continue
    # spec.md 이미 생성된 화면 스킵 (재개 지원 — 재생성하려면 spec.md 삭제 후 재실행)
    if os.path.exists(os.path.join(ui_dir, 'spec.md')):
        print(f'{uid}: spec.md 이미 존재 — 스킵')
        continue
    script = os.path.join(plugin, 'scripts', 'generate_uis_spec.py') if plugin else ''
    if not (script and os.path.exists(script)):
        continue
    screen_name = s.get('screenName') or screen_id
    cmd = [
        sys.executable, script, ui_dir,
        f'--uis-id={uid}', f'--screen-id={screen_id}',
        f'--screen-name={screen_name}',
        f'--route={s[\"route\"]}', f'--domain={s[\"domain\"]}',
        f'--workspace={ws}',
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='ignore')
    if r.returncode == 0:
        print(f'{uid} ({screen_id}): generate_uis_spec 완료')
    else:
        print(f'{uid}: [WARN] {(r.stderr or \"\")[:300]}')
"
```

### STEP 6-4: [C] ddd-ui-agent — 소스 분석 + §5 작성 (항상 실행)

**캡처 여부와 무관하게 모든 화면에 실행한다.**  
spec.md가 이미 있으면(STEP 6-3에서 생성) §5만 패치한다. 없으면 전체 생성한다.

`_tmp/screen_inventory.json`을 읽어 배치 처리한다.

```
_tmp/screen_inventory.json의 각 항목에 대해 Agent 도구 호출 (배치 3개씩 동시):
  subagent_type: "speclinker:ddd-ui-agent"
  description: "{route} §5 소스 분석"
  prompt: |
    라우트 경로: {route}
    진입 파일: {entryFile}
    참조 컴포넌트: {componentFiles}
    도메인: {domain}
    UIS-F ID: UIS-F-{uisId:03d}
    INF 디렉토리: {infDir}
    MODE: RECON
    워크스페이스: {현재 작업 디렉토리 절대경로}
    프로젝트 Profile: .speclinker/profile.yaml

    기존 spec.md: docs/05_설계서/{domain}/UI/{screenId}/spec.md
    (파일이 존재하면 §5만 패치한다. 존재하지 않으면 전체 spec.md를 생성한다.)

    목표:
    1. 소스 파일에서 버튼→API 매핑을 추출하여 §5 인터랙션 이벤트 매핑 표를 작성한다.
    2. INF가 없는 URL을 _tmp/{화면ID}_inf_required.json에 기록한다.
    3. JSP 화면이면 반드시 포함 JS 파일까지 읽어 $.ajax({url:...}) 패턴을 추출한다.

    결과 반환: "✅ {UIS-ID} {화면명} — spec.md {'생성' if 없었으면 else '패치'}완료 (위젯 N개, API M개)" 형식 1줄만. 전체 spec.md 내용 반환 금지.
```

> 3개씩 배치 순차 실행 — 토큰 과소비 방지.

### STEP 6-5: api_hints 수집 (STEP 7 입력 준비)

모든 ddd-ui-agent 배치 완료 후, 각 spec.md의 `api_hints`를 파싱해 전체 URL 목록 생성:

```bash
!python3 -c "
import os, re, json
screens = json.load(open('_tmp/screen_inventory.json', encoding='utf-8'))
hints_all = {}
for s in screens:
    uid = f'UIS-F-{s[\"uisId\"]:03d}'
    screen_id = uid.lower().replace('-', '_')
    spec_path = f'docs/05_설계서/{s[\"domain\"]}/UI/{screen_id}/spec.md'
    if not os.path.exists(spec_path):
        continue
    body = open(spec_path, encoding='utf-8').read()
    # 프론트매터에서 api_hints 파싱
    fm_match = re.search(r'^---\s*\n(.*?)\n---', body, re.DOTALL)
    if fm_match:
        for line in fm_match.group(1).splitlines():
            m = re.search(r'url:\s*[\"\'](.*?)[\"\']\s*.*method:\s*[\"\'](.*?)[\"\']\s*', line)
            if not m:
                m = re.search(r'-\s*\{.*?url:\s*[\"\'](.*?)[\"\']\s*,\s*method:\s*[\"\'](.*?)[\"\']\s*', line)
            if m:
                key = f'{m.group(2).upper()}:{m.group(1)}'
                hints_all[key] = {'url': m.group(1), 'method': m.group(2).upper(),
                                  'screen': uid, 'domain': s['domain']}
    # gaps.json 있으면 merge
    gaps_path = f'_tmp/{screen_id}_inf_gaps.json'
    if os.path.exists(gaps_path):
        gaps_data = json.load(open(gaps_path, encoding='utf-8'))
        for g in gaps_data.get('gaps', []):
            key = f'{g[\"method\"].upper()}:{g[\"url\"]}'
            hints_all[key] = {'url': g['url'], 'method': g['method'].upper(),
                              'screen': uid, 'domain': s['domain']}
os.makedirs('_tmp', exist_ok=True)
result = list(hints_all.values())
json.dump(result, open('_tmp/uis_api_hints.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(f'api_hints 수집: {len(result)}개 유니크 URL')
"
```

### STEP 6-6: UI _TOC.md 생성

> **모든 ddd-ui-agent 배치 완료 후** UI _TOC.md를 생성한다.

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

### STEP 6-7: 미리보기 캡처 (4단계 폴백)

각 화면의 `preview.png`를 아래 순서로 확보한다. ddd-ui-agent는 spec.md만 만들었으므로 여기서 이미지를 채운다.

```bash
!python3 -c "
import os
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
if env.get('PREVIEW_BASE_URL'):
    storage = env.get('PREVIEW_STORAGE_STATE', './.preview-storage.json')
    has_storage = os.path.exists(storage)
    print(f'PREVIEW_BASE_URL = {env[\"PREVIEW_BASE_URL\"]}')
    print(f'storageState: {storage} → {\"존재\" if has_storage else \"없음 (--bootstrap 필요)\"}')
else:
    print('PREVIEW_BASE_URL 미설정 → 폴백 단계 진입 (수동 PNG / 미리보기 생략 / BO admin 옵션)')
"
```

**캡처 시나리오 자동 생성 (build_capture_plan.py):**

각 화면을 standalone / dynamic-route / search-result 로 분류하고 preActions를 자동 생성한다.  
사용자가 수동 편집한 항목(`manualOverride: true`)은 보존된다.

```bash
!python3 -c "
import os, sys, subprocess
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'build_capture_plan.py') if plugin else ''
if script and os.path.exists(script):
    subprocess.run([sys.executable, script, '.'], check=False)
else:
    print('build_capture_plan.py 없음 — capture_plan.json 생성 스킵 (모든 화면 기본 goto)')
"
```

**1순위 — capture.js attach 캡처 (PREVIEW_BASE_URL 설정 + Chrome CDP 포트 열려있을 때):**

STEP 6-2에서 아직 캡처되지 않은 화면 대상. Chrome을 CDP 포트로 실행하고 로그인한 상태에서 호출:

```bash
# Chrome을 CDP 모드로 실행 (1회 — 로그인 상태 유지):
#   Windows: Start-Process chrome -ArgumentList '--remote-debugging-port=9222'
#   macOS  : open -a "Google Chrome" --args --remote-debugging-port=9222

# 화면별 attach 캡처:
!node "%PLUGIN_PATH%\scripts\capture.js" --out=docs/05_설계서/{domain}/UI/{화면ID} ^
       --frame-url={routeKeyword} --tabs=auto --auto-annotate

# spec.md 생성 (widgets.json → §4/§5/§8 자동):
!python3 "%PLUGIN_PATH%\scripts\generate_uis_spec.py" ^
       docs/05_설계서/{domain}/UI/{화면ID} ^
       --uis-id=UIS-F-{NNN} --screen-id={화면ID} --screen-name={화면명} ^
       --route={route} --domain={domain}
```

> `--auto-annotate`: DOM 위젯 자동 발견 + 번호 마커 오버레이 + widgets.json (DOM 메타 11종 + api_hints + condition_hints) 생성.

**2순위 — 사용자 수동 PNG (PREVIEW_BASE_URL 미설정 또는 캡처 실패 시):**

사용자가 직접 화면 캡처를 다음 경로에 떨궈놓으면 자동 사용된다:

```
docs/05_설계서/{domain}/UI/{화면ID}/preview.png
```

**3순위 — 미리보기 생략:**

PNG 없음 상태로 진행. spec.md의 `![[preview.png]]` 라인은 그대로 두면 Obsidian이 누락 표시.

**4) INF 역주입 루프** — gaps.json에 `[매칭 INF 없음]` 항목이 있으면 자동 실행:

```bash
!python3 -c "
import json, os
gaps_path = f'_tmp/{화면ID}_inf_gaps.json'
if not os.path.exists(gaps_path):
    print('gaps.json 없음 — INF 역주입 스킵')
else:
    data = json.load(open(gaps_path, encoding='utf-8'))
    gaps = data.get('gaps', [])
    if not gaps:
        print('gaps 0건 — 모든 api_hints 매칭됨')
    else:
        print(f'INF gaps {len(gaps)}건 발견 → ddd-api-agent 호출 필요:')
        for g in gaps:
            print(f'  [{g[\"tab_name\"]}] {g[\"widget_label\"]} → {g[\"url\"]} ({g[\"method\"]})')
"
```

gaps가 있으면 **최대 1회** INF 역주입을 실행한다. 1회 이후에도 남은 gaps는 루프 없이 미해결 파일로 기록한다:

```
gaps 항목 3개씩 묶어 Agent 도구 호출 (1회만, 재시도 없음):
  subagent_type: "speclinker:ddd-api-agent"
  description: "{화면ID} INF gap 생성 ({url}...)"
  prompt: |
    처리 대상 — UIS spec.md에서 api_hints 매칭 실패한 엔드포인트:
    - {gap[0].url} ({gap[0].method}) ← {gap[0].widget_label} [{gap[0].tab_name}]
    - {gap[1].url} ... (있는 경우)
    - {gap[2].url} ... (있는 경우)
    도메인: {domain}
    기존 INF 번호 현황: docs/05_설계서/{domain}/INF/ 디렉토리 스캔 후 다음 번호 배정
    워크스페이스: {현재 작업 디렉토리 절대경로}
    MODE: RECON
    출처: UIS spec.md의 위젯 api_hints (화면 캡처 DOM 기반) — 실제 소스도 확인하여 request/response 채움
    
    완료 후:
    - docs/05_설계서/{domain}/INF/INF-{NNN}.md 생성
    - inf-id / method / path frontmatter 필수 (generate_uis_spec.py 매칭에 사용)
```

ddd-api-agent 완료 후 spec.md 재생성 (이제 `[INF-NNN]` 링크가 채워짐):

```bash
# INF 생성 후 spec.md 재생성 — api_hints ↔ INF 매칭 갱신 (1회만)
!python3 "%PLUGIN_PATH%\scripts\generate_uis_spec.py" ^
       docs/05_설계서/{domain}/UI/{화면ID} ^
       --uis-id=UIS-F-{NNN} --screen-id={화면ID} --screen-name={화면명} ^
       --route={route} --domain={domain}
!python3 -c "
import json, os
gaps_path = f'_tmp/{화면ID}_inf_gaps.json'
data = json.load(open(gaps_path, encoding='utf-8'))
remaining = data.get('gaps', [])
if remaining:
    # 미해결 gaps → _tmp/_unresolved_gaps.json 에 누적
    ur_path = '_tmp/_unresolved_gaps.json'
    ur = json.load(open(ur_path, encoding='utf-8')) if os.path.exists(ur_path) else []
    ur.extend(remaining)
    json.dump(ur, open(ur_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'미해결 gaps {len(remaining)}건 → _tmp/_unresolved_gaps.json 기록')
else:
    print('역주입 완료 — 모든 api_hints 매칭됨')
"
```

> ⚠️ **루프 없음**: 1회 역주입 후에도 gaps가 남으면 `_tmp/_unresolved_gaps.json`에 기록하고 해당 화면의 spec.md §9에 미매칭 항목을 표시한 채 다음 화면으로 진행한다. 반복 재시도는 하지 않는다.

이 경로는 자동 디스패치되지 않는다(사용자 화면 인지·로그인 필요). PREVIEW_BASE_URL 캡처가 부족하다고 판단되는 화면만 선별 적용.

**4순위 — BO admin 폴백 (선택, jwork 전용):**

`project.env`에 `PREVIEW_FALLBACK_BO=true` 설정 시 BO admin 스타일 HTML 생성 → screenshot.js로 캡처.  
(이 경로는 별도 스크립트 `scripts/preview_fallback_bo.py`로 처리 — 미설치 시 스킵)

```bash
!python3 -c "
import os, json
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
fallback = env.get('PREVIEW_FALLBACK_BO','false').lower() == 'true'
if not fallback:
    print('BO admin 폴백 비활성화')
else:
    import glob
    screens = json.load(open('_tmp/screen_inventory.json', encoding='utf-8')) if os.path.exists('_tmp/screen_inventory.json') else []
    missing = []
    for s in screens:
        uid = f'UIS-F-{s[\"uisId\"]:03d}' if isinstance(s.get('uisId'), int) else (s.get('uisId') or 'UIS-F-001')
        screen_id = s.get('screenId') or uid.lower().replace('-','_')
        ui_dir = os.path.join('docs', '05_설계서', s['domain'], 'UI', screen_id)
        has_capture = glob.glob(os.path.join(ui_dir, 'preview_tab*_*.png')) or os.path.exists(os.path.join(ui_dir, 'preview.png'))
        if not has_capture:
            missing.append(uid)
    print(f'BO admin 폴백 대상: {len(missing)}건 (캡처 없는 화면)')
    for m in missing[:10]:
        print(f'  {m}')
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
