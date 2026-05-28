---
name: sl-recon-inf
description: RECON Phase-3 — INF API 명세 + DB 스키마 생성 (STEP 7~8). /sl-recon-uis 완료 후 실행.
triggers:
  - /sl-recon-inf
---

# /sl-recon-inf — INF/SCH 생성

## 실행 전 확인

```bash
!python3 -c "
import json, os, sys
errors = []
cp     = '_tmp/recon_checkpoint.json'
hints  = '_tmp/uis_api_hints.json'
router = '_tmp/router_inventory_with_chain.json'
plan   = '_tmp/inf_generation_plan.json'
if not os.path.exists(cp):
    errors.append('[FAIL] recon_checkpoint.json 없음 — /sl-recon 먼저 실행')
if not os.path.exists(hints):
    errors.append('[FAIL] uis_api_hints.json 없음 — /sl-recon-uis STEP 6-5 확인')
if not os.path.exists(router):
    errors.append('[FAIL] router_inventory_with_chain.json 없음 — /sl-recon STEP 4-2 확인')
if not os.path.exists(plan):
    errors.append('[FAIL] inf_generation_plan.json 없음 — /sl-recon STEP 4-3 확인')
if errors:
    for e in errors: print(e)
    sys.exit(1)
hints_data  = json.load(open(hints,  encoding='utf-8'))
router_data = json.load(open(router, encoding='utf-8'))
plan_data   = json.load(open(plan,   encoding='utf-8'))
print(f'[OK] api_hints {len(hints_data)}개 | router_groups {len(router_data)}개 | inf_plan {len(plan_data)}개 처리 예정')
"
```

---

## ✋ STEP 7-선택: 도메인 선택 체크포인트 (필수)

UIS가 완료된 도메인 현황을 보여주고, **이번 실행에서 INF/SCH를 생성할 도메인을 사용자에게 확인**한다.

```bash
!python3 -c "
import json, os, re

plan = json.load(open('docs/05_설계서/_domain_plan.json', encoding='utf-8'))
hints = json.load(open('_tmp/uis_api_hints.json', encoding='utf-8')) if os.path.exists('_tmp/uis_api_hints.json') else []

# UIS 완료 도메인별 hints 수
from collections import Counter
hints_by_domain = Counter(h.get('domain','unknown') for h in hints)

print('도메인별 UIS/INF 현황:')
for i, d in enumerate(plan['domains'], 1):
    name = d['name']
    # UIS spec.md 개수
    ui_dir = f'docs/05_설계서/{name}/UI'
    uis_done = sum(1 for root, dirs, files in os.walk(ui_dir) for f in files if f == 'spec.md') if os.path.isdir(ui_dir) else 0
    # INF 개수
    inf_dir = f'docs/05_설계서/{name}/INF'
    inf_done = len([f for f in os.listdir(inf_dir) if f.startswith('INF-')]) if os.path.isdir(inf_dir) else 0
    # SCH 개수
    sch_done = len([f for f in os.listdir(f'docs/05_설계서/{name}') if f.startswith('SCH-')]) if os.path.isdir(f'docs/05_설계서/{name}') else 0
    api_hints_cnt = hints_by_domain.get(name, 0)
    print(f'  {i:2}. {name:20} UIS:{uis_done:3}개  api_hints:{api_hints_cnt:3}개  INF:{inf_done:3}개  SCH:{sch_done:2}개')

print()
print('[선택 방법]')
print('  전체 처리: \"all\" 또는 \"계속\"')
print('  특정 도메인: 도메인명 입력 (예: \"product\" 또는 \"product,order\")')
print()
print('※ UIS spec.md가 0개인 도메인은 api_hints가 없어 INF 생성 품질이 낮을 수 있습니다.')
"
```

사용자 응답을 받아 처리 대상 도메인을 확정하고 `_tmp/inf_domain_selection.json`에 저장한다:

```bash
!python3 -c "
import json, os

# 사용자 응답값을 여기서 반영 — [] 이면 전체
selected_domains = []  # ← 사용자 응답에 따라 채운다

hints = json.load(open('_tmp/uis_api_hints.json', encoding='utf-8')) if os.path.exists('_tmp/uis_api_hints.json') else []
if selected_domains:
    filtered_hints = [h for h in hints if h.get('domain') in selected_domains]
    print(f'선택: {selected_domains} → api_hints {len(filtered_hints)}개 / INF+SCH 생성 예정')
else:
    filtered_hints = hints
    print(f'전체 선택 → api_hints {len(filtered_hints)}개 / 전체 도메인 INF+SCH 생성')

os.makedirs('_tmp', exist_ok=True)
json.dump({'selected_domains': selected_domains or None, 'filtered_hints': filtered_hints},
          open('_tmp/inf_domain_selection.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('_tmp/inf_domain_selection.json 저장 완료')
"
```

> **SCH도 동일 도메인 범위 적용**: STEP 8 ddd-db-agent도 `inf_domain_selection.json`의 `selected_domains`를 참조한다.  
> **확인 전 STEP 7-0 절대 진행 금지.**

---

## STEP 7 — Phase B-2: INF 생성 (api_hints 기반)

> **Screen-first INF**: UIS spec.md의 `api_hints`(화면이 실제 호출하는 URL)에서 INF를 생성한다.  
> 화면에 연결되지 않은 컨트롤러(API-residual)는 마지막에 `used_by_screens: []`로 처리한다.  
> **선택된 도메인의 api_hints만 처리한다** — `_tmp/inf_domain_selection.json` 참조.

### STEP 7-0: api_hints 집계 + call chain 매핑

`_tmp/uis_api_hints.json`과 `_tmp/router_inventory_with_chain.json`을 cross-match 한다:

```bash
!python3 -c "
import os, json, re

# domain selection 우선 — filtered_hints 사용, fallback to full hints
sel_path = '_tmp/inf_domain_selection.json'
if os.path.exists(sel_path):
    sel = json.load(open(sel_path, encoding='utf-8'))
    hints = sel.get('filtered_hints') or json.load(open('_tmp/uis_api_hints.json', encoding='utf-8')) if os.path.exists('_tmp/uis_api_hints.json') else []
    if sel.get('selected_domains'):
        print(f'도메인 필터 적용: {sel[\"selected_domains\"]}')
else:
    hints = json.load(open('_tmp/uis_api_hints.json', encoding='utf-8')) if os.path.exists('_tmp/uis_api_hints.json') else []
if not hints:
    print('[WARN] api_hints 없음 — STEP 6-4 재실행 필요')
else:
    inventory = json.load(open('_tmp/router_inventory_with_chain.json', encoding='utf-8')) if os.path.exists('_tmp/router_inventory_with_chain.json') else []

    # router_inventory의 모든 파일에서 정의된 URL 추출 (어노테이션 기반)
    URL_RE = re.compile(r'''(?:@(?:Get|Post|Put|Delete|Patch|Request)Mapping|Router\.|app\.).*?['\"](/[^'\"]+)''')
    file_to_urls = {}
    for group in inventory:
        for item in group:
            fp = item.get('filePath','')
            if not fp or not os.path.exists(fp): continue
            try:
                body = open(fp, encoding='utf-8', errors='ignore').read()
                urls = set(URL_RE.findall(body))
                file_to_urls[fp] = list(urls)
            except: pass

    # api_hints URL → matched controller file 매핑
    matched = {}
    unmatched = []
    for h in hints:
        url = h['url']
        found = None
        for fp, urls in file_to_urls.items():
            if any(u == url or url.startswith(u.rstrip('/')) or u.startswith(url.rstrip('/')) for u in urls):
                found = fp
                break
        if found:
            matched[url] = {'hint': h, 'filePath': found}
        else:
            unmatched.append(h)

    # API-residual: router_inventory에 있지만 api_hints에 없는 파일
    all_hint_urls = {h['url'] for h in hints}
    residual_files = set()
    for group in inventory:
        for item in group:
            fp = item.get('filePath','')
            urls = file_to_urls.get(fp, [])
            if not any(u in all_hint_urls for u in urls):
                residual_files.add(fp)

    os.makedirs('_tmp', exist_ok=True)
    json.dump({'matched': list(matched.values()), 'unmatched': unmatched,
               'residualFiles': list(residual_files)},
              open('_tmp/inf_generation_plan.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'api_hints 매칭: {len(matched)}개 → 컨트롤러 파일 확인됨')
    print(f'미매칭 api_hints: {len(unmatched)}개 (컨트롤러 미발견 — 직접 URL 기반 생성)')
    print(f'API-residual: {len(residual_files)}개 파일 (화면 미연결 컨트롤러)')
"
```

### STEP 7-1: ddd-api-agent 호출 (api_hints 기반, call chain 주입)

`_tmp/inf_generation_plan.json`의 matched + unmatched URL을 처리한다.  
**`router_inventory_with_chain.json`의 call chain 데이터를 함께 전달한다.**

```
inf_generation_plan.json의 matched 항목을 3개씩 묶어 Agent 도구 호출 (배치당 동시):
  subagent_type: "speclinker:ddd-api-agent"
  description: "{domain} INF gap 생성 ({url}...)"
  prompt: |
    처리 대상 — UIS spec.md의 api_hints에서 수집된 실제 호출 엔드포인트:
    - {item[0].hint.url} ({item[0].hint.method}) ← 화면: {item[0].hint.screen}
    - {item[1].hint.url} ... (있는 경우)
    - {item[2].hint.url} ... (있는 경우)
    도메인: {item[0].hint.domain}
    컨트롤러 파일: {item[0].filePath} (있는 경우)
    기존 INF 번호 현황: docs/05_설계서/{domain}/INF/ 디렉토리 스캔 후 다음 번호 배정
    워크스페이스: {현재 작업 디렉토리 절대경로}
    MODE: RECON
    출처: UIS spec.md api_hints (화면에서 실제 호출 확인된 URL) — 소스도 확인하여 request/response 채움

    === 사전 계산된 연관 파일 (있는 경우 읽기 의무) ===
    router_inventory_with_chain.json에서 {item[0].filePath} 항목의:
    서비스: {relatedFiles.service}
    DAO:    {relatedFiles.dao}
    쿼리:   {relatedFiles.query}
    스키마(사전추출): {relatedFiles.querySchemas}

    완료 후:
    - docs/05_설계서/{domain}/INF/INF-{NNN}.md 생성
    - inf-id / method / path / used_by_screens frontmatter 필수
    - used_by_screens: [{화면 UIS-F ID}]  ← STEP 7-2 spec.md 갱신에 사용

    결과 반환: "✅ {도메인} INF {INF-NNN}~{INF-MMM} — {N}개 생성완료" 형식 1줄만. INF 파일 내용 반환 금지.
```

> ⚠️ 배치 완료 확인 후 다음 배치 시작. 토큰 절약: 3그룹 이하 동시 실행.

### STEP 7-2: spec.md INF 링크 갱신

ddd-api-agent 완료 후, api_hints가 있던 화면들의 spec.md를 재생성해 INF 링크를 채운다:

```bash
!python3 -c "
import os, sys, subprocess, json
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
screens = json.load(open('_tmp/screen_inventory.json', encoding='utf-8')) if os.path.exists('_tmp/screen_inventory.json') else []
hints = json.load(open('_tmp/uis_api_hints.json', encoding='utf-8')) if os.path.exists('_tmp/uis_api_hints.json') else []
screens_with_hints = {h['screen'] for h in hints}
script = os.path.join(plugin, 'scripts', 'generate_uis_spec.py') if plugin else ''
for s in screens:
    uid = f'UIS-F-{s[\"uisId\"]:03d}'
    if uid not in screens_with_hints:
        continue
    screen_id = uid.lower().replace('-', '_')
    ui_dir = f'docs/05_설계서/{s[\"domain\"]}/UI/{screen_id}'
    if not os.path.exists(ui_dir):
        continue
    if script and os.path.exists(script):
        subprocess.run([sys.executable, script, ui_dir,
                       f'--uis-id={uid}', f'--screen-id={screen_id}',
                       f'--route={s[\"route\"]}', f'--domain={s[\"domain\"]}'],
                      capture_output=True, text=True)
        print(f'{uid}: spec.md INF 링크 갱신 완료')
    else:
        print(f'{uid}: generate_uis_spec.py 없음 — 수동 INF 링크 삽입 필요')
"
```

미해결 gaps는 `_tmp/_unresolved_gaps.json`에 기록된다.

### STEP 7-3: API-residual 처리 (화면 미연결 컨트롤러)

`_tmp/inf_generation_plan.json`의 `residualFiles` 목록을 처리한다.  
이 컨트롤러들은 어떤 화면의 api_hints에도 등장하지 않으므로 `used_by_screens: []`로 INF를 생성한다.

```bash
!python3 -c "
import json, os
plan = json.load(open('_tmp/inf_generation_plan.json', encoding='utf-8')) if os.path.exists('_tmp/inf_generation_plan.json') else {}
residual = plan.get('residualFiles', [])
if not residual:
    print('API-residual 없음 — 모든 컨트롤러가 화면 api_hints에 연결됨')
else:
    print(f'API-residual {len(residual)}개 파일:')
    for fp in residual:
        print(f'  {fp}')
    print()
    print('→ ddd-api-agent로 INF 생성 (used_by_screens: [])')
"
```

residualFiles가 있으면 `router_inventory_with_chain.json`에서 해당 파일의 그룹을 찾아 ddd-api-agent 호출:

```
residualFiles를 3개씩 묶어 Agent 도구 호출:
  subagent_type: "speclinker:ddd-api-agent"
  description: "{domain} API-residual INF 생성 ({filePath basename}...)"
  prompt: |
    처리 대상 파일 목록 (화면 api_hints에 미연결 컨트롤러):
    - {residual[0]} → INF-{infStart:03d} ~ INF-{infEnd:03d}  (router_inventory_with_chain.json에서 범위 확인)
    도메인: {domain}
    MODE: RECON
    워크스페이스: {현재 작업 디렉토리 절대경로}

    frontmatter 필수:
    - used_by_screens: []   ← 화면 미연결 명시
    - inf-id / method / path / linked_func: TBD
    [call chain 주입 — router_inventory_with_chain.json 동일 형식]

    결과 반환: "✅ {도메인} INF {INF-NNN}~{INF-MMM} — {N}개 생성완료" 형식 1줄만. INF 파일 내용 반환 금지.
```

### STEP 7-4: INF 색인 생성

모든 INF 파일 생성 완료 후 도메인별 INF 색인 파일을 생성한다.

```bash
!python3 -c "
import os, re, json

plan = json.load(open('docs/05_설계서/_domain_plan.json'))
for d in plan['domains']:
    domain = d['name']
    inf_dir = f'docs/05_설계서/{domain}/INF'
    if not os.path.isdir(inf_dir):
        continue
    rows = []
    for fname in sorted(os.listdir(inf_dir)):
        if not fname.startswith('INF-') or not fname.endswith('.md'):
            continue
        c = open(os.path.join(inf_dir, fname), encoding='utf-8').read()
        inf_id = re.search(r'^inf-id:\s*(\S+)', c, re.M)
        method  = re.search(r'^method:\s*(\S+)', c, re.M)
        path_   = re.search(r'^path:\s*(\S+)', c, re.M)
        req_f   = re.search(r'^req-f:\s*(\S+)', c, re.M)
        used_by = re.search(r'^used_by_screens:\s*(\[.*?\])', c, re.M)
        if inf_id:
            rows.append((inf_id.group(1), method.group(1) if method else '?',
                         path_.group(1) if path_ else '?',
                         req_f.group(1) if req_f else '[TBD]',
                         used_by.group(1) if used_by else ''))
    toc = f'# INF 목록 — {domain}\n\n'
    toc += '| INF-ID | 메서드 | 엔드포인트 | FUNC-ID / REQ-F | 연결 화면 |\n'
    toc += '|--------|--------|-----------|----------------|----------|\n'
    for inf_id, m, p, r, ub in rows:
        toc += f'| [{inf_id}]({inf_id}.md) | {m} | {p} | {r} | {ub} |\n'
    with open(os.path.join(inf_dir, '_TOC.md'), 'w', encoding='utf-8') as f:
        f.write(toc)
    api_content = f'# API 명세 — {domain}\n\n| INF-ID | 메서드 | 엔드포인트 | 파일 |\n'
    api_content += '|--------|--------|-----------|------|\n'
    for inf_id, m, p, _, _ in rows:
        api_content += f'| {inf_id} | {m} | {p} | [INF/{inf_id}.md](INF/{inf_id}.md) |\n'
    with open(f'docs/05_설계서/{domain}/API_{domain}.md', 'w', encoding='utf-8') as f:
        f.write(api_content)
    print(f'{domain}: INF {len(rows)}건 색인 완료')
"
```

---

## STEP 8 — Phase B-3: SCH 생성

INF 생성 완료 후 DB 스키마를 생성한다. INF → SCH 순서는 `sch_draft`가 INF 단계 데이터를 참조하기 때문이다.

ddd-db-agent 호출 전 가용 DB MCP 목록을 확인한다:

```bash
!python3 -c "
import json, os, re

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
db_aliases = []
for k, v in env.items():
    m = re.match(r'^MCP_DB_(.+)$', k)
    if m and v == 'true':
        db_aliases.append(m.group(1).lower())

status = {}
if os.path.exists('_tmp/mcp_status.json'):
    status = json.load(open('_tmp/mcp_status.json'))

available = [a for a in db_aliases if status.get(f'MCP_DB_{a.upper()}', True)]
print('가용 DB MCP 서버:', available if available else '없음 (소스코드 분석만 사용)')
print(json.dumps(available))
"
```

**POC 모드 도메인 필터** (POC_SCREENS 설정 시, ddd-db-agent 호출 전 실행):

```bash
!python3 -c "
import json, os
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
poc_mode    = env.get('POC_MODE','false').lower() == 'true'
poc_screens = [s.strip() for s in env.get('POC_SCREENS','').split(',') if s.strip()]

if not poc_mode or not poc_screens:
    print('일반 모드 — 전체 도메인 SCH 생성')
else:
    inv_path = '_tmp/screen_inventory.json'
    plan_path = 'docs/05_설계서/_domain_plan.json'
    if os.path.exists(inv_path):
        inv = json.load(open(inv_path, encoding='utf-8'))
        active = list({s.get('domain') for s in inv if s.get('domain')})
        plan = json.load(open(plan_path, encoding='utf-8'))
        orig = len(plan['domains'])
        filtered = [d for d in plan['domains'] if d['name'] in active]
        if filtered and len(filtered) < orig:
            plan['domains'] = filtered
            json.dump(plan, open(plan_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
            print(f'🧪 POC SCH 필터: {[d[\"name\"] for d in filtered]} ({orig}개 → {len(filtered)}개)')
            print('  복원: _domain_plan.json.full.json → _domain_plan.json 복사')
        else:
            print(f'POC SCH: 활성 도메인 {active} (전체와 동일하거나 필터 불필요)')
    else:
        print('[WARN] screen_inventory.json 없음 — POC SCH 필터 건너뜀')
"
```

**ddd-db-agent — 도메인당 1호출, 최대 3개씩 배치 병렬**

> ⚠️ 토큰 절약: 도메인 전체를 한 번에 띄우지 말고 **3개씩 배치**로 나눠 순차 실행한다.

각 도메인에 대해 Agent 도구 호출 시 **가용 DB MCP 목록**을 함께 전달한다.  
**`_tmp/inf_domain_selection.json`의 `selected_domains`가 있으면 해당 도메인만 처리한다.**

```bash
!python3 -c "
import json, os
sel_path = '_tmp/inf_domain_selection.json'
plan = json.load(open('docs/05_설계서/_domain_plan.json', encoding='utf-8'))
if os.path.exists(sel_path):
    sel = json.load(open(sel_path, encoding='utf-8'))
    sel_domains = sel.get('selected_domains')
    if sel_domains:
        domains = [d for d in plan['domains'] if d['name'] in sel_domains]
        print(f'SCH 대상 도메인 (선택): {[d[\"name\"] for d in domains]}')
    else:
        domains = plan['domains']
        print(f'SCH 대상 도메인 (전체): {[d[\"name\"] for d in domains]}')
else:
    domains = plan['domains']
    print(f'SCH 대상 도메인 (전체): {[d[\"name\"] for d in domains]}')
"
```

```
선택된 도메인 목록을 3개씩 묶어 배치 단위로 반복:
  각 배치 내에서 Agent 도구 호출 (배치 내 동시):
  subagent_type: "speclinker:ddd-db-agent"
  description: "{도메인명} DB 스키마 생성"
  prompt: |
    도메인: {도메인명}
    SCH 범위: SCH-{sch.start:03d} ~ SCH-{sch.end:03d}
    INF 디렉토리: docs/05_설계서/{도메인명}/INF/
    사전추출 SCH draft 경로: _tmp/sch_draft/{도메인명}/   ← Phase 1 신호 1순위 (필수 로드)
      - resolve_call_chain.py가 INF 단계에서 만들어 둔 테이블·컬럼·근거 캐시
      - 각 파일: { table, columns, evidence, joinHints, referencedByInfRange }
      - evidence에 등록된 파일은 다시 Read하지 말 것 (이미 INF 단계에서 처리됨)
    프로젝트 Profile: .speclinker/profile.yaml (있으면 persistence.technologies로 ORM/SQL 신호 정밀화)
    가용 DB MCP 서버: {available 목록}  ← 예: ["main", "sub1"]
      - 각 서버는 .mcp.json의 "db-{별칭}" 키로 접근 가능
      - 목록이 비어있으면 MCP 없이 sch_draft + ORM/SQL 보강만으로 SCH 생성
    MODE: RECON
    워크스페이스: {현재 작업 디렉토리 절대경로}

    ⚠️ 토큰 절약 의무:
    - sch_draft를 1차 사실로 사용, evidence 파일 재Read 금지
    - ORM 모델·CREATE TABLE·INF 본문만 보강 Read
    - docs/05_설계서/API_Design.md 전체를 cat하지 말 것 (다른 도메인 INF까지 적재됨)
    - 자기 도메인 INF/ 디렉토리만 ls/cat 한다
    - knowledge-graph는 자기 도메인 rootPaths 범위로 필터링

    결과 반환: "✅ {도메인} SCH {SCH-NNN}~{SCH-MMM} — {N}개 테이블 생성완료" 형식 1줄만.
```

### STEP 8-1: INF → SCH 링크 패치 (link_inf_sch.py)

ddd-db-agent 전체 완료 후 INF 파일의 `## 참조 테이블` 셀 `[TBD]`를 SCH 링크로 교체한다.  
LLM 재호출 없이 스크립트가 처리 — 토큰 절약.

```bash
!python3 -c "
import os, sys, subprocess
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'link_inf_sch.py') if plugin else ''
if script and os.path.exists(script):
    subprocess.run([sys.executable, script, '.'], check=False)
else:
    print('link_inf_sch.py 없음 — PLUGIN_PATH 확인')
"
```

출력 예시:
```
[OK] INF-205: 2개 테이블 → SCH 링크 교체 ['SCH-001', 'SCH-002']
[OK] INF-206: 1개 테이블 → SCH 링크 교체 ['SCH-001']
  남은 미매칭 테이블 1건 → _tmp/INF-207_sch_required.json

총 15개 INF 처리 완료
```

미매칭이 남으면: `_tmp/INF-{NNN}_sch_required.json`의 `tables` 배열에 남은 테이블명 확인 후  
해당 테이블의 SCH가 생성됐는지 점검한다.

---

## 다음 단계

STEP 7~8 완료. INF/SCH 생성이 완료됐습니다.

**체크포인트 업데이트:**
```bash
!python3 -c "
import json, os, datetime
cp = json.load(open('_tmp/recon_checkpoint.json', encoding='utf-8')) if os.path.exists('_tmp/recon_checkpoint.json') else {}
cp.update({'phase': 'recon-inf', 'completed_at': datetime.datetime.now().isoformat(), 'status': 'ok'})
json.dump(cp, open('_tmp/recon_checkpoint.json','w'), ensure_ascii=False, indent=2)
print('체크포인트 업데이트 완료')
"
```

다음 커맨드 실행: **`/sl-recon-doc`**
