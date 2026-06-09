---
name: sl-recon-inf
description: RECON Phase 1.5 — 확정된 도메인 기준으로 router_inventory(INF 대상 census)를 만들고 INF/BAT 명세를 생성한다. /sl-recon(도메인 확정) 후 실행하거나, 소스 변경 후 INF만 현행화할 때 단독 재실행.
triggers:
  - /sl-recon-inf
---

# /sl-recon-inf — INF(인터페이스) 명세 생성

> `/sl-recon`에서 분리된 **독립 INF 생성 단계**. 도메인이 확정돼 있어야 한다(`docs/05_설계서/_domain_plan.json`).
> 소스에 엔드포인트가 추가/변경되면 **이 명령만 단독 재실행**해 INF 대상 census(`.speclinker/inf_targets.json`)와
> INF 명세를 현행화한다. (SCH/UIS/doc과 동일한 페이즈-커맨드 패밀리)

## 전제 조건

```bash
!python -c "import os,sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
plan=os.path.exists('docs/05_설계서/_domain_plan.json');
print('_domain_plan.json:', '있음' if plan else '없음');
print('— /sl-recon(도메인 확정) 먼저 실행 필요' if not plan else '— INF 생성 진행 가능')"
```

- `docs/05_설계서/_domain_plan.json` 없음 — **중단**, `/sl-recon` 먼저 안내.

---

## STEP I-0 — source_index 갱신 (소스 변경 자동 반영 · POC_SKIP_UA 시 재사용)

> STEP 4-1은 `_tmp/source_index.json`을 읽는다. **기본은 매 실행 재스캔**(scan_source.js, zero-LLM)하여
> 소스에 추가/변경된 엔드포인트를 census에 자동 반영한다 — 별도로 파일을 지울 필요 없다.
> `POC_SKIP_UA=true`이고 기존 인덱스가 있으면 재사용한다(main `/sl-recon` STEP 1과 동일 의미).

```bash
!python -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import os, subprocess
if not os.path.exists('project.env'):
    print('[ERROR] project.env 없음 — /sl-init 먼저 실행'); sys.exit(1)
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
idx = '_tmp/source_index.json'
skip = env.get('POC_SKIP_UA','false').lower() == 'true' and os.path.exists(idx)
if skip:
    print('POC_SKIP_UA=true — 기존 source_index.json 재사용')
else:
    plugin = env.get('PLUGIN_PATH','')
    script = os.path.join(plugin, 'scripts', 'scan_source.js') if plugin else ''
    if not (script and os.path.exists(script)):
        print('[ERROR] scan_source.js 없음 (PLUGIN_PATH 확인)'); sys.exit(1)
    r = subprocess.run(['node', script, '--workspace=.'], capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.stdout: print(r.stdout[-1500:])
    if r.returncode != 0:
        print('[ERROR]', (r.stderr or '')[:500]); sys.exit(1)
    print('source_index.json 갱신 완료 (소스 변경분 반영)')
"
```

---

## STEP 4 — router_inventory 생성 + INF 명세 작성

> `source_index.json`의 routes에서 `kind: "api"`만 INF 후보로 사용.  
> `kind: "form"` routes는 `_tmp/screen_inventory_static.json`으로 분리 → `/sl-recon-uis` static fallback.

### STEP 4-1: router_inventory 생성 (api routes only)

```bash
!python -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import json, os, math

idx  = json.load(open('_tmp/source_index.json', encoding='utf-8'))
plan = json.load(open('docs/05_설계서/_domain_plan.json'))
env  = dict(l.strip().split('=',1) for l in open('project.env') if '=' in l and not l.startswith('#'))

def norm(p): return (p or '').replace(os.sep, '/')

ctrl_files = [f for f in idx.get('files', []) if f.get('type') == 'controller']

# 배치 파일 경로 집합 사전 계산
BATCH_NAME_KW = ('batch', 'job', 'scheduler', 'task', 'worker', 'consumer', 'processor', 'jobbean')
BATCH_DIR_KW  = ('batch', 'job', 'jobs', 'scheduler', 'schedule')
NON_BATCH_KW  = ('controller', 'handler', 'restcontroller', 'restapi')

def _is_batch_fp(fp):
    fp_n = norm(fp).lower()
    bn = os.path.splitext(os.path.basename(fp_n))[0].replace('_','').replace('-','')
    if any(k in bn for k in NON_BATCH_KW): return False
    if any(k in bn for k in BATCH_NAME_KW): return True
    return any(any(k in p for k in BATCH_DIR_KW) for p in fp_n.split('/')[:-1])

batch_fps = set(
    f.get('filePath','') for f in idx.get('files', [])
    if f.get('type') == 'batch' or _is_batch_fp(f.get('filePath',''))
)

def is_batch_candidate(fp): return fp in batch_fps

result       = []
bat_all      = []
bat_id_next  = [1]
BAT_SLOT     = 5
all_form_routes = []

import glob as _glob, re as _re

def scan_inf_max(ws, domain_name, domain_code):
    """도메인 INF 디렉토리에서 현재 최대 순번 반환 (없으면 0)."""
    pattern = os.path.join(ws, 'docs', '05_설계서', domain_name, 'INF', f'INF-{domain_code}-*.md')
    nums = []
    for f in _glob.glob(pattern):
        m = _re.search(rf'INF-{_re.escape(domain_code)}-(\d+)', os.path.basename(f))
        if m: nums.append(int(m.group(1)))
    return max(nums, default=0)

def scan_bat_max(ws):
    """전체 BAT-*.md 스캔 → 현재 최대 순번 반환."""
    nums = []
    for f in _glob.glob(os.path.join(ws, 'docs', '05_설계서', '*', 'BAT', 'BAT-*.md')):
        m = _re.search(r'BAT-(\d+)', os.path.basename(f))
        if m: nums.append(int(m.group(1)))
    return max(nums, default=0)

bat_id_next[0] = scan_bat_max(os.getcwd()) + 1

def norm_key(p):
    return norm(p).lower()

for d in plan['domains']:
    roots = [norm(r).rstrip('/') for r in d['rootPaths']]
    code  = d.get('code', d['name'][:3].upper())

    # 도메인 루트 controller 파일
    domain_ctrl = [f for f in ctrl_files
                   if any(norm(f.get('filePath','')).startswith(r) or norm(f.get('relPath','')).startswith(r) for r in roots)]

    # form routes → screen_inventory_static (sl-recon-uis fallback용)
    for f in domain_ctrl:
        for r in f.get('routes', []):
            if r.get('kind') == 'form':
                all_form_routes.append({
                    'route':     r['path'],
                    'entryFile': f['filePath'],
                    'domain':    d['name'],
                    'screenId':  r['handlerMethod'],
                })

    # api routes가 있는 파일만 INF 후보
    api_ctrl = [f for f in domain_ctrl
                if any(r.get('kind', 'api') == 'api' for r in f.get('routes', []))]

    # batch 후보 (type=batch)
    bat_src = [f for f in idx.get('files', [])
               if f.get('type') == 'batch' and
               any(norm(f.get('filePath','')).startswith(r) or norm(f.get('relPath','')).startswith(r) for r in roots)]
    all_domain = api_ctrl + [f for f in bat_src if f not in api_ctrl]

    files = sorted(set(f.get('filePath','') for f in all_domain if f.get('filePath')))
    if not files:
        if ctrl_files:
            print(f'  [WARN {d[\"name\"]}] api 파일 0건 — rootPaths={roots} vs filePath/relPath 매칭 실패 의심(절대/상대 경로 점검)')
        continue

    # POC_FILE_LIMIT 보조 필터
    poc_mode  = env.get('POC_MODE','false').lower() == 'true'
    poc_limit = int(env.get('POC_FILE_LIMIT','0') or 0) if poc_mode else 0
    if poc_limit > 0 and len(files) > poc_limit:
        print(f'  [{d[\"name\"]}] POC_FILE_LIMIT={poc_limit} 적용: {len(files)}개 → {poc_limit}개')
        files = files[:poc_limit]

    # filePath → api routes 룩업 (kind=form 제외)
    api_routes_lookup = {
        norm_key(f.get('filePath','')): [
            {'method': r.get('method','GET'), 'path': r.get('path',''), 'handler': r.get('handlerMethod','')}
            for r in f.get('routes', []) if r.get('kind', 'api') == 'api'
        ]
        for f in api_ctrl
    }

    # INF 시작 순번: 기존 파일 스캔 후 max+1. 파일마다 route 수 만큼 포인터 전진.
    current_inf_id = scan_inf_max(os.getcwd(), d['name'], code) + 1

    all_items = []
    for fp in files:
        routes = api_routes_lookup.get(norm_key(fp), [])
        all_items.append({
            'domain':            d['name'],
            'domainCode':        code,
            'domainDescription': d.get('description', ''),
            'layer':             d.get('layer', ''),
            'filePath':          fp,
            'infIdStart':        current_inf_id,
            'apiRoutes':         routes,
        })
        # 다음 파일 시작 ID = 현재 route 수 + 1 (최소 1 보장)
        current_inf_id += max(len(routes), 1)

    api_items = [item for item in all_items if not is_batch_candidate(item['filePath'])]
    bat_items = [item for item in all_items if is_batch_candidate(item['filePath'])]

    for item in bat_items:
        item['batStart'] = bat_id_next[0]
        item['batEnd']   = bat_id_next[0] + BAT_SLOT - 1
        bat_id_next[0]  += BAT_SLOT
        bat_all.append(item)
    if bat_items:
        print(f'  [{d[\"name\"]}] 배치 후보 {len(bat_items)}개 → batch_inventory 분리')

    BATCH = 3
    for b in range(0, len(api_items), BATCH):
        result.append(api_items[b:b+BATCH])

os.makedirs('_tmp', exist_ok=True)

# form routes 저장 (sl-recon-uis static fallback)
json.dump(all_form_routes, open('_tmp/screen_inventory_static.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=2)

# 재시작 지원: 파일 단위 완료 확인 (그룹 전체 스킵 → 파일 개별 스킵)
def file_already_done(item):
    inf_dir = f'docs/05_설계서/{item[\"domain\"]}/INF'
    if not os.path.isdir(inf_dir): return False
    basename = os.path.splitext(os.path.basename(item['filePath']))[0].lower()
    for fname in os.listdir(inf_dir):
        if not (fname.startswith('INF-') and fname.endswith('.md')): continue
        try:
            c = open(os.path.join(inf_dir, fname), encoding='utf-8').read()
            if basename in c.lower(): return True
        except: pass
    return False

total_api = sum(len(g) for g in result)
# 완료된 파일 제외 후 재그룹화 (그룹 내 일부만 완료돼도 나머지 재처리)
all_pending_items = [item for g in result for item in g if not file_already_done(item)]
skipped_files = total_api - len(all_pending_items)
REBATCH = 3
pending = [all_pending_items[b:b+REBATCH] for b in range(0, len(all_pending_items), REBATCH)]
pending_files = len(all_pending_items)

json.dump(pending, open('_tmp/router_inventory.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

# 전체 INF 대상 census(미생성 필터 이전) — 뷰어 커버리지 expected의 durable ground truth.
# router_inventory.json은 pending(미생성)만 담고 _tmp는 휘발되므로, 생성 완료 후엔 expected를 잃는다.
# result(전체 api_items, file_already_done 필터 적용 전)를 .speclinker에 영속화한다.
# → gen_docsify.build_manifest가 INF expected 소스로 이 파일을 우선 사용(SCH처럼 미생성 census 유지).
os.makedirs('.speclinker', exist_ok=True)
full_inf_targets = [item for g in result for item in g]
json.dump(full_inf_targets, open('.speclinker/inf_targets.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=2)
print(f'INF 대상 census(전체 {len(full_inf_targets)}건) -> .speclinker/inf_targets.json (커버리지 expected)')

bat_groups = [bat_all[b:b+3] for b in range(0, len(bat_all), 3)]
json.dump(bat_groups, open('_tmp/batch_inventory.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

api_msg = f'API {total_api}파일 → {len(pending)}그룹 처리/{pending_files}파일 (스킵: {skipped_files}파일 — 기존 INF 있음)'
bat_msg = f'배치 후보 {len(bat_all)}파일 → {len(bat_groups)}그룹' if bat_all else '배치 후보 없음'
form_msg = f'form routes {len(all_form_routes)}개 → _tmp/screen_inventory_static.json'
print(f'{api_msg} | {bat_msg}')
print(form_msg)
"
```

### STEP 4-2: call chain 사전 계산 (서비스·DAO·쿼리 파일 경로 주입)

컨트롤러만 전달하면 에이전트가 서비스/DAO 경로를 스스로 추론해야 하는데, 토큰 압박 하에서 이 단계가 생략되어 `resultData: {}` 가 반복된다. **사전에 call chain을 계산하여 에이전트에게 전달한다.**

```bash
!python -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import os, sys
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'resolve_call_chain.py') if plugin else ''
ws = os.getcwd()
if script and os.path.exists(script):
    import subprocess
    r = subprocess.run([sys.executable, script, '_tmp/router_inventory.json', ws], capture_output=True, text=True)
    print(r.stdout[-2000:] if len(r.stdout) > 2000 else r.stdout)
    if r.returncode != 0:
        print('[WARN] resolve_call_chain 실패 — 기본 inventory로 진행:', r.stderr[:500])
        import shutil; shutil.copy('_tmp/router_inventory.json', '_tmp/router_inventory_with_chain.json')
else:
    print('resolve_call_chain.py 없음 — 기본 inventory 복사')
    import shutil; shutil.copy('_tmp/router_inventory.json', '_tmp/router_inventory_with_chain.json')
"
```

> 📌 **부가 산출물**: `resolve_call_chain.py`는 `_tmp/sch_draft/{도메인}/{테이블}.json`도 함께 생성한다.  
> SQL 텍스트에서 추출한 도메인별 테이블·컬럼·근거 파일·INF 범위 매핑. STEP 5의 `ddd-db-agent` 1차 입력.

### STEP 4-3: INF 명세 생성 (외부 dispatcher 실행)

`dispatch_inf_gen.py`를 블로킹으로 실행한다.  
스크립트가 모든 배치를 완료하고 exit 0을 반환하면 STEP 5로 진행한다.  
메인 Claude 컨텍스트에 배치 결과가 쌓이지 않는다 — 컨텍스트 오버플로 방지.

```bash
!python -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import os, json
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'dispatch_inf_gen.py') if plugin else ''
if not script or not os.path.exists(script):
    print('[ERROR] dispatch_inf_gen.py 없음 - PLUGIN_PATH 확인'); exit(1)
print(f'dispatcher: {script}')
print('inventory: _tmp/router_inventory_with_chain.json')
"
```

```bash
!python "{PLUGIN_PATH}/scripts/dispatch_inf_gen.py" .
```

> **완료 판단**: 위 명령이 exit 0으로 반환되면 모든 배치 완료.  
> exit 1이면 `_tmp/dispatch_status.json`의 `failed` 목록 확인 후 재실행 — 완료된 배치는 자동 스킵됨.

```bash
!python -c "
import json, os, sys
if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sp = '_tmp/dispatch_status.json'
if not os.path.exists(sp):
    print('dispatch_status.json 없음')
else:
    st = json.load(open(sp, encoding='utf-8'))
    done = len(st.get('done', []))
    failed = st.get('failed', [])
    print(f'완료: {done}그룹  실패: {len(failed)}그룹')
    if failed:
        print(f'실패 인덱스: {failed}')
        print('재실행: python dispatch_inf_gen.py .')
    else:
        print('전체 성공 - STEP 5 진행')
"
```

> ⚠️ **모든 배치 완료(실패 0) 전 STEP 5 절대 진행 금지.**

모든 배치 완료 후 도메인별 INF 색인 파일을 생성한다.

```bash
!python -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
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
        if inf_id:
            rows.append((inf_id.group(1), method.group(1) if method else '?',
                         path_.group(1) if path_ else '?'))
    toc = f'# INF 목록 — {domain}\n\n'
    toc += '| INF-ID | 메서드 | 엔드포인트 |\n'
    toc += '|--------|--------|----------|\n'
    for inf_id, m, p in rows:
        toc += f'| [{inf_id}]({inf_id}.md) | {m} | {p} |\n'
    with open(os.path.join(inf_dir, '_TOC.md'), 'w', encoding='utf-8') as f:
        f.write(toc)
    print(f'{domain}: INF {len(rows)}건 색인 완료')
"
```

---

### STEP 4-B: BAT 생성 (배치 후보 파일 처리)

`_tmp/batch_inventory.json`에 배치 후보가 있는 경우만 실행한다.  
**배치 여부 최종 판단은 ddd-batch-agent가 소스를 직접 읽어 수행한다 — "배치 아님" 반환 가능.**

```bash
!python -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import json, os
path = '_tmp/batch_inventory.json'
if not os.path.exists(path):
    print('batch_inventory.json 없음 — STEP 4-B 건너뜀')
else:
    groups = json.load(open(path, encoding='utf-8'))
    total = sum(len(g) for g in groups)
    if total == 0:
        print('배치 후보 없음 — STEP 4-B 건너뜀')
    else:
        print(f'배치 후보 {total}파일 ({len(groups)}그룹) → ddd-batch-agent 처리:')
        for g in groups:
            for item in g:
                print(f'  {item[\"filePath\"]} → BAT-{item[\"batStart\"]:03d}~BAT-{item[\"batEnd\"]:03d} [{item[\"domain\"]}]')
"
```

### batch_inventory call chain 사전 계산

배치 파일도 컨트롤러와 동일하게 서비스/DAO/쿼리 체인을 사전 계산해 ddd-batch-agent에 주입한다.

```bash
!python -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import os, sys
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'resolve_call_chain.py') if plugin else ''
ws = os.getcwd()
if script and os.path.exists(script):
    import subprocess
    r = subprocess.run([sys.executable, script, '_tmp/batch_inventory.json', ws], capture_output=True, text=True)
    print(r.stdout[-2000:] if len(r.stdout) > 2000 else r.stdout)
    if r.returncode != 0:
        print('[WARN] resolve_call_chain (batch) 실패 — 기본 inventory로 진행:', r.stderr[:500])
        import shutil; shutil.copy('_tmp/batch_inventory.json', '_tmp/batch_inventory_with_chain.json')
else:
    print('resolve_call_chain.py 없음 — 기본 inventory 복사')
    import shutil; shutil.copy('_tmp/batch_inventory.json', '_tmp/batch_inventory_with_chain.json')
"
```

배치 후보가 있으면 **3파일씩 묶어** `ddd-batch-agent`를 호출한다. (각 그룹 순서대로 실행):

```
_tmp/batch_inventory_with_chain.json의 각 그룹에 대해 Agent 도구 호출:
  subagent_type: "speclinker:ddd-batch-agent"
  description: "{group[0].domain} BAT 생성 ({group[0].filePath basename}...)"
  prompt: |
    파일 목록:
    - {group[0].filePath} → BAT-{group[0].batStart:03d} ~ BAT-{group[0].batEnd:03d}
    - {group[1].filePath} → BAT-{group[1].batStart:03d} ~ BAT-{group[1].batEnd:03d}  (있는 경우)
    - {group[2].filePath} → BAT-{group[2].batStart:03d} ~ BAT-{group[2].batEnd:03d}  (있는 경우)
    도메인: {group[0].domain}
    MCP_DB 서버: {_tmp/mcp_status.json의 가용 DB MCP 서버 별칭 — 없으면 "없음"}
    워크스페이스: {현재 작업 디렉토리 절대경로}
    프로젝트 Profile: .speclinker/profile.yaml (있으면 batch.runner/scheduler로 배치 종류 인식)

    === 사전 계산된 연관 파일 (읽기 의무) ===
    아래 파일들은 resolve_call_chain이 미리 계산한 Batch→Service→DAO→Query 체인이다.
    Phase 2에서 반드시 Read 도구로 읽어야 한다. 직접 경로 추론은 불필요하다.

    [파일1 연관]
    서비스: {group[0].relatedFiles.service}
    DAO:    {group[0].relatedFiles.dao}
    쿼리:   {group[0].relatedFiles.query}
    스키마(사전추출): {group[0].relatedFiles.querySchemas}

    [파일2 연관] (있는 경우)
    서비스: {group[1].relatedFiles.service}
    DAO:    {group[1].relatedFiles.dao}
    쿼리:   {group[1].relatedFiles.query}
    스키마(사전추출): {group[1].relatedFiles.querySchemas}

    [파일3 연관] (있는 경우)
    서비스: {group[2].relatedFiles.service}
    DAO:    {group[2].relatedFiles.dao}
    쿼리:   {group[2].relatedFiles.query}
    스키마(사전추출): {group[2].relatedFiles.querySchemas}
```

> "배치 아님"으로 반환된 파일은 INF 후보로 기록하고, 재처리 여부를 사용자에게 확인 후 결정한다.

---

## STEP 5 — INF 생성 완료 → SCH는 `/sl-recon-sch`

> **SCH(DB 스키마) 생성은 `/sl-recon-sch`로 분리되었다.** INF가 추출대상 테이블의 권위이므로
> INF 생성이 끝난 지금 시점에 별도 명령으로 실행한다(INF/UIS를 고친 뒤 SCH만 재실행하기 쉽다).

```
/sl-recon-sch
```

> `/sl-recon-sch`가 수행: 추출대상 테이블 레지스트리 갱신(`build_table_registry.py`) →
> SCH 스킵판정(`build_sch_todo.py`) → 쿼리패턴 채굴 → 정적 스켈레톤(`build_sch_static.py`) →
> 의미 enrichment(`dispatch_sch_gen.py`) → INF↔SCH 링크 패치(`link_inf_sch_new.py`).

---

## STEP 6 — 완료 체크포인트 + 다음 단계 안내

INF 생성이 끝났습니다. 체크포인트를 저장합니다. **다음은 `/sl-recon-sch`(DB 스키마)** 입니다.

> 단계 순서: `/sl-recon`(INF) → **`/sl-recon-sch`(SCH)** → `/sl-recon-uis`(화면) → `/sl-recon-doc`(FUNC/SRS).
> SCH는 INF의 `tables:`를 권위로 추출하므로 INF 완료 직후 별도 명령으로 실행한다.
> UIS는 `/sl-recon-uis`가 전담(PREVIEW_BASE_URL 있으면 라이브 캡처, 없으면 정적 fallback).

```bash
!python -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import json, os, datetime
os.makedirs('_tmp', exist_ok=True)
json.dump({
    'phase': 'recon-analysis',
    'completed_at': datetime.datetime.now().isoformat(),
    'status': 'ok'
}, open('_tmp/recon_checkpoint.json', 'w'), ensure_ascii=False, indent=2)
print('체크포인트 저장 완료 → _tmp/recon_checkpoint.json')
print()
print('다음 커맨드: /sl-recon-sch  (DB 스키마 SCH 생성)')
print('  이후: /sl-recon-uis (화면) → /sl-recon-doc (FUNC/SRS)')
"
```
