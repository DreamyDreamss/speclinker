---
name: sl-recon
description: RECON 모드 전용 — 기존 소스코드를 UA로 역분석하여 ASIS/SAD/SRS 산출물을 생성. 코드는 있지만 설계서가 없을 때 실행.
triggers:
  - /sl-recon
---

# /sl-recon — 코드 역분석

기존 소스코드에서 설계 산출물을 역방향으로 추출합니다.  
RECON 모드 (`project.env`의 `MODE=RECON`)에서 실행합니다.

## 실행 전 확인

```bash
!cat project.env
```

`MODE=RECON`이 아니면 실행을 중단하고 `/sl-init`으로 모드 재설정을 안내한다.

---

## STEP 0 — MCP 연결 상태 확인

`project.env`의 MCP 플래그(`true`=사용 의도)를 읽어 **매번 재시도**한다.  
결과는 `_tmp/mcp_status.json`에만 저장하고 **`project.env`는 절대 수정하지 않는다.**

> **설계 원칙**: `project.env` MCP 플래그 = 사용자 설정(의도).  
> 런타임 결과로 덮어쓰면 자격증명 채운 뒤 재실행해도 영원히 false로 고정됨.  
> 따라서 매 실행마다 `true`인 항목은 항상 재시도한다.

```bash
!python3 -c "
import os, json

os.makedirs('_tmp', exist_ok=True)
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
active = [k for k, v in env.items() if k.startswith('MCP_') and v == 'true']

if not active:
    print('활성화된 MCP 없음 — 로컬 파일만 사용')
    json.dump({}, open('_tmp/mcp_status.json', 'w'))
else:
    print('테스트할 MCP:', ', '.join(active))
"
```

활성화된 MCP 각각에 대해 **실제 MCP 도구를 직접 호출**하여 연결을 테스트한다:

| MCP 유형 | 테스트 방법 | 성공 판단 |
|---------|-----------|---------|
| `MCP_DB_{별칭}` | `db-{별칭}` 서버 query 도구로 `SELECT 1` 실행 | 오류 없이 응답 |
| `MCP_JIRA` | `atlassian` MCP list_projects 도구 실행 | 오류 없이 응답 |
| `MCP_WIKI` | `atlassian` MCP list_spaces 도구 실행 | 오류 없이 응답 |

테스트 결과를 `_tmp/mcp_status.json`에 저장한다 (`project.env` 수정 금지):

```bash
!python3 -c "
import json, os

# 위 실제 MCP 도구 호출 결과로 채운다
status = {
    'MCP_DB_MAIN': True,   # 도구 호출 성공 여부
    'MCP_JIRA':    False,  # 도구 호출 성공 여부
}
os.makedirs('_tmp', exist_ok=True)
json.dump(status, open('_tmp/mcp_status.json', 'w'), ensure_ascii=False, indent=2)
print('_tmp/mcp_status.json 저장 완료')
"
```

이후 ddd-db-agent 등 각 에이전트는 `_tmp/mcp_status.json`을 읽어 MCP 사용 가능 여부를 판단한다.

**보고 형식:**

```
[MCP 연결 결과] — 매 실행마다 재시도 (project.env 설정값 유지)
✔ MCP_DB_MAIN  — 연결 성공
✘ MCP_JIRA     — 연결 실패 (.mcp.json 자격증명 미입력 등) → 이번 실행만 fallback
✔ MCP_WIKI     — 연결 성공

→ _tmp/mcp_status.json에만 저장. 다음 /sl-recon 실행 시 자동 재시도합니다.
```

---

## STEP 1 — 코드 구조 분석 (UA 에이전트)

먼저 `project.env`에서 소스 경로 목록을 읽어 분석 대상을 확정한다:

```powershell
$env = Get-Content project.env -Encoding UTF8 | Where-Object { $_ -match '=' }
$pairs = @{}; $env | ForEach-Object { $k,$v = $_ -split '=',2; $pairs[$k.Trim()] = $v.Trim() }
$count = [int]($pairs['SOURCE_COUNT'] ?? 1)
Write-Host "분석 대상 소스 ($count 곳):"
for ($i = 1; $i -le $count; $i++) {
    $label = $pairs["SOURCE_${i}_LABEL"]
    $path  = $pairs["SOURCE_${i}_PATH"]
    if (Test-Path $path) { Write-Host "  [OK] [$label] $path" -ForegroundColor Green }
    else                 { Write-Host "  [XX] [$label] $path — 경로 없음" -ForegroundColor Red }
}
```

경로가 하나라도 존재하지 않으면 사용자에게 알리고 중단한다.

**소스별로 독립적인 knowledge-graph를 생성한다.**  
파일명 규칙: `.understand-anything/knowledge-graph-{label}.json`

```powershell
# 생성 여부 사전 확인
$pairs.GetEnumerator() | Where-Object { $_.Key -match '^SOURCE_\d+_LABEL$' } | ForEach-Object {
    $label = $_.Value
    $exists = Test-Path ".understand-anything/knowledge-graph-$label.json"
    Write-Host "  knowledge-graph-$label.json : $(if ($exists) {'기존 재사용'} else {'새로 생성 필요'})"
}
```

**각 소스별로 순서대로** UA 에이전트를 실행한다 (SOURCE 1 완료 → SOURCE 2 → ...):

**1-1. 프로젝트 스캔**  
`project-scanner` UA 에이전트를 서브에이전트로 실행.  
분석 루트: `SOURCE_{N}_PATH` 값을 전달한다.

**1-2. 파일 분석**  
`file-analyzer` UA 에이전트를 서브에이전트로 실행.  
→ `.understand-anything/knowledge-graph-{label}.json` 생성

**1-3. 아키텍처 레이어 분류**  
`architecture-analyzer` UA 에이전트를 서브에이전트로 실행.

**1-4. 도메인 플로우 분석**  
`domain-analyzer` UA 에이전트를 서브에이전트로 실행.  
→ `.understand-anything/domain-graph-{label}.json` 생성

**1-5. knowledge-graph 조립 (분산 저장 시)**

UA가 intermediate/ 에 분산 저장한 경우 조립한다. **{label}별로 반복 실행한다.**

```bash
!node -e "
const fs = require('fs'), path = require('path');
const label = process.argv[1];
const uaDir = '.understand-anything';
const intDir = path.join(uaDir, 'intermediate');
if (!fs.existsSync(intDir)) { console.log('intermediate 없음 — 조립 불필요'); process.exit(0); }
let nodes = [], edges = [];
const asmPath = path.join(intDir, 'assembled-graph.json');
if (fs.existsSync(asmPath)) {
  const a = JSON.parse(fs.readFileSync(asmPath, 'utf-8'));
  nodes = a.nodes || []; edges = a.edges || [];
} else {
  fs.readdirSync(intDir).filter(f => /^batch-\d+\.json$/.test(f)).sort().forEach(f => {
    const b = JSON.parse(fs.readFileSync(path.join(intDir, f), 'utf-8'));
    nodes.push(...(b.nodes||[])); edges.push(...(b.edges||[]));
  });
}
let layers = [];
const lp = path.join(intDir, 'layers.json');
if (fs.existsSync(lp)) layers = JSON.parse(fs.readFileSync(lp, 'utf-8'));
const kg = { version: '1.0.0', label, project: { name: path.basename(process.cwd()) }, nodes, edges, layers };
fs.writeFileSync(path.join(uaDir, \`knowledge-graph-\${label}.json\`), JSON.stringify(kg, null, 2));
console.log(\`[\${label}] 조립 완료:\`, nodes.length, '노드,', edges.length, '엣지');
" -- {label}
```

**1-6. 전체 병합 그래프 생성**

모든 소스의 knowledge-graph를 하나로 합쳐 `knowledge-graph.json`을 만든다.  
spec-agent(Phase-A)의 SAD + 도메인 분석에 사용된다.  
**노드 ID에 레이블 접두어를 붙여 소스 간 ID 충돌을 방지한다.**

```bash
!node -e "
const fs = require('fs'), path = require('path');
const uaDir = '.understand-anything';
const files = fs.readdirSync(uaDir).filter(f => /^knowledge-graph-.+\.json$/.test(f));
let allNodes = [], allEdges = [], allLayers = [];
files.forEach(f => {
  const label = f.replace('knowledge-graph-', '').replace('.json', '');
  const prefix = label + '__';
  const kg = JSON.parse(fs.readFileSync(path.join(uaDir, f), 'utf-8'));
  const nodeIdMap = {};
  (kg.nodes || []).forEach(n => {
    const newId = prefix + n.id;
    nodeIdMap[n.id] = newId;
    n.id = newId;
    n._source = label;
    allNodes.push(n);
  });
  (kg.edges || []).forEach(e => {
    e.source = nodeIdMap[e.source] || (prefix + e.source);
    e.target = nodeIdMap[e.target] || (prefix + e.target);
    allEdges.push(e);
  });
  allLayers.push(...(kg.layers || []));
});
const merged = { version: '1.0.0', project: { name: path.basename(process.cwd()) }, nodes: allNodes, edges: allEdges, layers: allLayers };
fs.writeFileSync(path.join(uaDir, 'knowledge-graph.json'), JSON.stringify(merged, null, 2));
console.log('병합 완료:', allNodes.length, '노드,', allEdges.length, '엣지 (소스:', files.length, '개)');
"
```

---

## STEP 2 — Phase-A: SAD + 도메인 목록 확정

`agents/spec-agent.md`를 서브에이전트로 실행한다.

> spec-agent에게 (Phase-A):  
> knowledge-graph.json과 domain-graph.json을 분석하여  
> SAD(`docs/04_아키텍처설계서/SAD_v1.0.md`)와 도메인 계획(`docs/05_설계서/_domain_plan.json`)을 생성하라.  
> 도메인 수는 4~8개, 각 도메인에 INF/SCH/UIS ID 범위를 사전 배정하라.

```bash
!cat docs/05_설계서/_domain_plan.json
```

---

## ✋ STEP 3 — 사용자 도메인 검토 (필수 체크포인트)

`_domain_plan.json`의 내용을 사용자에게 보기 좋게 출력하고 **반드시 확인을 받는다.**

```bash
!python3 -c "
import json
plan = json.load(open('docs/05_설계서/_domain_plan.json'))
print(f'프로젝트: {plan[\"project\"]}')
print()
print('감지된 도메인 목록:')
for i, d in enumerate(plan['domains'], 1):
    inf = f'INF-{d[\"inf\"][\"start\"]:03d}~{d[\"inf\"][\"end\"]:03d}'
    sch = f'SCH-{d[\"sch\"][\"start\"]:03d}~{d[\"sch\"][\"end\"]:03d}'
    uis = f'UIS-F-{d[\"uis\"][\"start\"]:03d}~{d[\"uis\"][\"end\"]:03d}'
    print(f'  {i}. {d[\"name\"]:15} {d[\"description\"][:30]:30} {inf} {sch} {uis}')
print(f'\n총 {len(plan[\"domains\"])}개 도메인')
"
```

수정 없으면 "계속", 수정 필요하면 변경 내용 입력 받아 `_domain_plan.json` 수정 후 진행.  
**확인 전 STEP 4 절대 진행 금지.**

---

## STEP 4 — Phase B-1: INF 생성 (라우터 파일별 병렬, 배치 10~15개)

먼저 INF 분석에 사용할 knowledge-graph를 결정한다.  
레이블이 `api`, `backend`, `server`, `batch`, `service` 중 하나인 소스 그래프를 우선 사용한다.  
없으면 병합 그래프(`knowledge-graph.json`)를 사용한다.

```bash
!python3 -c "
import os, re

env = dict(line.strip().split('=',1) for line in open('project.env') if '=' in line and not line.startswith('#'))
count = int(env.get('SOURCE_COUNT', 1))
API_KW = ('api','backend','server','batch','service','was','app')
kg_path = '.understand-anything/knowledge-graph.json'  # fallback
for i in range(1, count+1):
    label = env.get(f'SOURCE_{i}_LABEL', '').lower()
    if any(k in label for k in API_KW):
        candidate = f'.understand-anything/knowledge-graph-{label}.json'
        if os.path.exists(candidate):
            kg_path = candidate
            break
print(f'INF 분석 대상 그래프: {kg_path}')
" 2>/dev/null
```

모든 도메인의 라우터/컨트롤러 파일 목록을 추출한다.  
**UA가 분류한 node type을 1차 기준으로 사용 — 프레임워크 무관하게 동작한다.**

```bash
!python3 -c "
import json, os, math

# INF용 그래프 선택
env = dict(l.strip().split('=',1) for l in open('project.env') if '=' in l and not l.startswith('#'))
count = int(env.get('SOURCE_COUNT',1))
API_KW = ('api','backend','server','batch','service','was','app')
kg_path = '.understand-anything/knowledge-graph.json'
for i in range(1, count+1):
    lbl = env.get(f'SOURCE_{i}_LABEL','').lower()
    if any(k in lbl for k in API_KW):
        c = f'.understand-anything/knowledge-graph-{lbl}.json'
        if os.path.exists(c): kg_path = c; break

kg   = json.load(open(kg_path))
plan = json.load(open('docs/05_설계서/_domain_plan.json'))

# 1차: UA node type 기반 (router, endpoint, entrypoint)
API_NODE_TYPES = {'router', 'endpoint', 'entrypoint'}
# 2차 fallback: 파일 경로 키워드 (node type 미분류 시)
ROUTER_KW = ('controller','handler','route','api','endpoint','rest','servlet','action')

def norm(p): return (p or '').replace(os.sep, '/')

result = []
for d in plan['domains']:
    roots = [norm(r).rstrip('/') for r in d['rootPaths']]
    inf_s, inf_e = d['inf']['start'], d['inf']['end']

    # 해당 도메인 루트에 속하는 노드 필터
    domain_nodes = [n for n in kg['nodes']
                    if any(norm(n.get('filePath','')).startswith(r) for r in roots)]

    # 1차: type 기반
    api_nodes = [n for n in domain_nodes if n.get('type') in API_NODE_TYPES]

    # 2차: type 미분류면 파일명 키워드
    if not api_nodes:
        api_nodes = [n for n in domain_nodes
                     if any(k in norm(n.get('filePath','')).lower() for k in ROUTER_KW)
                     and n.get('type') in ('file','class','module')]

    files = sorted(set(n.get('filePath','') for n in api_nodes if n.get('filePath')))
    if not files:
        continue

    total_slots = inf_e - inf_s + 1
    slot = max(1, math.ceil(total_slots / len(files)))
    for i, fp in enumerate(files):
        s = inf_s + i * slot
        e = min(s + slot - 1, inf_e)
        result.append({'domain': d['name'], 'filePath': fp, 'infStart': s, 'infEnd': e})

import os
os.makedirs('_tmp', exist_ok=True)

# 재시작 지원: 이미 INF 파일이 존재하는 도메인 파일은 건너뜀
def already_done(item):
    inf_dir = f'docs/05_설계서/{item[\"domain\"]}/INF'
    if not os.path.isdir(inf_dir):
        return False
    existing = [f for f in os.listdir(inf_dir) if f.startswith('INF-') and f.endswith('.md')]
    return len(existing) > 0

pending = [r for r in result if not already_done(r)]
skipped = len(result) - len(pending)

with open('_tmp/router_inventory.json', 'w', encoding='utf-8') as f:
    json.dump(pending, f, ensure_ascii=False, indent=2)

print(f'라우터/컨트롤러 파일 총 {len(result)}개 (처리 대상: {len(pending)}개, 기완료 스킵: {skipped}개)')
"
```

위 목록을 **배치 10~15개씩** `ddd-api-agent`에 동시 호출한다.

```
각 파일에 대해 Agent 도구 호출 (배치당 동시에):
  subagent_type: "speclinker:ddd-api-agent"
  description: "{파일명} INF 생성"
  prompt: |
    처리 대상 파일: {filePath}
    도메인: {domain}
    INF 범위: INF-{infStart:03d} ~ INF-{infEnd:03d}
    MODE: RECON
    워크스페이스: {현재 작업 디렉토리 절대경로}
```

> ⚠️ 배치 완료 확인 후 다음 배치 시작. **모든 배치 완료 전 STEP 5 절대 진행 금지.**

모든 배치 완료 후 도메인별 INF 색인 파일을 생성한다.

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
        if inf_id:
            rows.append((inf_id.group(1), method.group(1) if method else '?',
                         path_.group(1) if path_ else '?', req_f.group(1) if req_f else '[TBD]'))
    toc = f'# INF 목록 — {domain}\n\n'
    toc += '| INF-ID | 메서드 | 엔드포인트 | FUNC-ID / REQ-F |\n'
    toc += '|--------|--------|-----------|----------------|\n'
    for inf_id, m, p, r in rows:
        toc += f'| [{inf_id}]({inf_id}.md) | {m} | {p} | {r} |\n'
    with open(os.path.join(inf_dir, '_TOC.md'), 'w', encoding='utf-8') as f:
        f.write(toc)
    api_content = f'# API 명세 — {domain}\n\n| INF-ID | 메서드 | 엔드포인트 | 파일 |\n'
    api_content += '|--------|--------|-----------|------|\n'
    for inf_id, m, p, _ in rows:
        api_content += f'| {inf_id} | {m} | {p} | [INF/{inf_id}.md](INF/{inf_id}.md) |\n'
    with open(f'docs/05_설계서/{domain}/API_{domain}.md', 'w', encoding='utf-8') as f:
        f.write(api_content)
    print(f'{domain}: INF {len(rows)}건 색인 완료')
"
```

---

## STEP 5 — Phase B-2: SCH + UIS 생성 (INF 완료 후 동시 실행)

INF 파일 생성 완료를 확인한다.

```bash
!python3 -c "
import os, json
plan = json.load(open('docs/05_설계서/_domain_plan.json'))
for d in plan['domains']:
    cnt = len([f for f in os.listdir(f'docs/05_설계서/{d[\"name\"]}/INF') if f.startswith('INF-')]) if os.path.isdir(f'docs/05_설계서/{d[\"name\"]}/INF') else 0
    print(f'{d[\"name\"]}: INF {cnt}건')
" 2>/dev/null
```

UI 화면 분석에 사용할 knowledge-graph를 결정한다.

```bash
!python3 -c "
import os
env = dict(line.strip().split('=',1) for line in open('project.env') if '=' in line and not line.startswith('#'))
count = int(env.get('SOURCE_COUNT', 1))
UI_KW = ('web','frontend','ui','client','front','react','vue','next','nuxt')
kg_path = '.understand-anything/knowledge-graph.json'
for i in range(1, count+1):
    label = env.get(f'SOURCE_{i}_LABEL', '').lower()
    if any(k in label for k in UI_KW):
        c = f'.understand-anything/knowledge-graph-{label}.json'
        if os.path.exists(c): kg_path = c; break
print(kg_path)
" 2>/dev/null
```

라우터 자동감지 + import 트리 추적으로 화면(라우트) 단위 인벤토리를 생성한다.  
`screen_inventory.py`에 **워크스페이스 경로**(현재 디렉토리)와 **knowledge-graph 경로**를 전달한다.  
결과는 `_tmp/screen_inventory.json`에 저장된다.

```python
!python3 -c "
import os, sys, subprocess
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
kg_path = '{위에서 결정한 kg_path}'
script = os.path.join(plugin, 'scripts', 'screen_inventory.py') if plugin else ''
if script and os.path.exists(script):
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

**아래 두 그룹을 같은 메시지에서 동시에 시작한다.**

ddd-db-agent 호출 전 가용 DB MCP 목록을 확인한다:

```bash
!python3 -c "
import json, os, re

# project.env에서 DB 별칭 목록 추출
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
db_aliases = []
for k, v in env.items():
    m = re.match(r'^MCP_DB_(.+)$', k)
    if m and v == 'true':
        db_aliases.append(m.group(1).lower())  # MCP_DB_MAIN → main

# _tmp/mcp_status.json 에서 연결 성공 여부 확인
status = {}
if os.path.exists('_tmp/mcp_status.json'):
    status = json.load(open('_tmp/mcp_status.json'))

available = [a for a in db_aliases if status.get(f'MCP_DB_{a.upper()}', True)]
print('가용 DB MCP 서버:', available if available else '없음 (소스코드 분석만 사용)')
print(json.dumps(available))
"
```

**[그룹 A] ddd-db-agent — 도메인 수만큼 전부 병렬**

각 도메인에 대해 Agent 도구 호출 시 **가용 DB MCP 목록**을 함께 전달한다.  
에이전트가 여러 DB 중 도메인에 맞는 것을 선택하거나 전체를 활용한다.

```
각 도메인에 대해 Agent 도구 호출 (전부 동시에):
  subagent_type: "speclinker:ddd-db-agent"
  description: "{도메인명} DB 스키마 생성"
  prompt: |
    도메인: {도메인명}
    SCH 범위: SCH-{sch.start:03d} ~ SCH-{sch.end:03d}
    INF 디렉토리: docs/05_설계서/{도메인명}/INF/
    가용 DB MCP 서버: {available 목록}  ← 예: ["main", "sub1"]
      - 각 서버는 .mcp.json의 "db-{별칭}" 키로 접근 가능
      - 목록이 비어있으면 MCP 없이 소스코드 분석만으로 SCH 생성
    MODE: RECON
    워크스페이스: {현재 작업 디렉토리 절대경로}
```

**[그룹 B] ddd-ui-agent — 화면(라우트)별, 배치 10~15개씩**

`_tmp/screen_inventory.json`을 읽어 배치 처리한다.  
**이미 `docs/05_설계서/{domain}/UI/{uisId}/spec.md`가 존재하는 화면은 건너뛴다 (재시작 지원).**

```
_tmp/screen_inventory.json의 각 항목에 대해 Agent 도구 호출 (배치당 동시에):
  subagent_type: "speclinker:ddd-ui-agent"
  description: "{route} 화면 명세 생성"
  prompt: |
    라우트 경로: {route}
    진입 파일: {entryFile}
    참조 컴포넌트: {componentFiles}  ← JSON 배열 그대로 전달
    도메인: {domain}
    UIS-F ID: UIS-F-{uisId:03d}
    INF 디렉토리: {infDir}
    MODE: RECON
    워크스페이스: {현재 작업 디렉토리 절대경로}
```

> 그룹 A는 전부 한 번에, 그룹 B는 배치 10~15개씩 순차 실행.  
> **모든 완료 후 UI _TOC.md를 생성한다.**

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

## STEP 6 — Phase-C: 색인 + FUNC 생성 + FUNC_MAP

모든 Phase-B 완료 후 두 에이전트를 순서대로 실행한다.

**6-1. 전체 색인 생성** — `agents/spec-agent.md`를 서브에이전트로 실행:

> spec-agent에게 (Phase-C):  
> `docs/05_설계서/` 하위 모든 도메인 파일을 읽어  
> 전체 색인(API_Design.md, DB_Schema.md, UI_Spec_v1.0.md)을 생성하라.  
> RD/RTM은 생성하지 않는다.

**6-2. FUNC 생성** — `agents/rd-agent.md`를 서브에이전트로 실행 (RECON 모드):

> rd-agent에게 (RECON 모드):  
> `docs/05_설계서/{도메인}/UI/{화면ID}/spec.md` 파일과 INF 파일을 스캔하여  
> `docs/00_FUNC/FUNC_v1.0.md`와 `docs/00_FUNC/domains/FUNC_{도메인}.md`를 생성하라.  
> REQ-F 없음. FUNC-{도메인}-{NNN} ID 체계. 구현 사실만 기록.

**6-3. SRS 생성** — `agents/srs-agent.md`를 서브에이전트로 실행 (RECON 모드):

> srs-agent에게 (RECON 모드):  
> `docs/05_설계서/{도메인}/UI/{화면ID}/spec.md` + INF 파일을 읽고  
> 화면 시퀀스 + API 체인 + 비즈니스 규칙을 기능 단위 SRS-F로 집약하라.  
> Reflexion 자기검증 루프(최대 2회). REQ-F 없음, FUNC-ID 역방향 연결.  
> 출력:  
> - `docs/03_기능명세서/SRS_v1.0.md` (색인표: `| SRS-F-XXX | 기능명 | FUNC-ID |`)  
> - `docs/03_기능명세서/domains/SRS_{도메인}.md` × 도메인 수

**6-4. FUNC_MAP 생성** — `agents/rtm-agent.md`를 서브에이전트로 실행 (RECON 모드):

> rtm-agent에게 (RECON 모드):  
> screen-map.json + SRS + INF + FUNC_v1.0.md를 읽어  
> `docs/00_FUNC/FUNC_MAP.md`를 화면→SRS→INF→DB 직결 매핑표로 작성하라.  
> linked-req-cache.json 생성 후 ua_req_bridge.js를 실행하라.

```bash
!ls docs/00_FUNC/ 2>/dev/null \
  && echo "FUNC 생성 완료" \
  || echo "00_FUNC 없음 — rd-agent(RECON) 실패 확인 필요"
!ls docs/03_기능명세서/domains/ 2>/dev/null \
  && echo "SRS 생성 완료" \
  || echo "03_기능명세서 없음 — srs-agent 실패 확인 필요"
```

---

## STEP 7 — IA 맵 생성

INF + UIS + screen_inventory를 조합하여 화면 계층 맵을 생성한다.

```bash
!python3 -c "
import os, sys
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'ia_map_builder.py') if plugin else ''
if script and os.path.exists(script):
    import subprocess
    subprocess.run([sys.executable, script, '.'], check=False)
else:
    print('ia_map_builder.py 없음 — PLUGIN_PATH 확인')
"
```

```bash
!test -f _tmp/ia-map.json \
  && python3 -c \"import json; d=json.load(open('_tmp/ia-map.json')); print(f'IA 맵 생성 완료: 화면 {d[\\\"totalScreens\\\"]}개, API 연결 {d[\\\"totalApis\\\"]}건')\" \
  || echo "ia-map.json 없음 — ia_map_builder.py 실패 확인 필요"
```

---

## STEP 8 — si-graph 갱신 확인

```bash
!test -f .understand-anything/si-graph.json \
  && echo "si-graph.json 갱신 완료" \
  || echo "ua_req_bridge.js 재실행 필요"
```

완료 안내:
```
역분석 완료.

생성 파일:
[코드 이해]
- .understand-anything/knowledge-graph.json
- .understand-anything/domain-graph.json
- .understand-anything/screen-map.json

[아키텍처]
- docs/04_아키텍처설계서/SAD_v1.0.md

[상세 설계]
- docs/05_설계서/{도메인}/INF/INF-XXX.md × N개  (인터페이스 개별 파일)
- docs/05_설계서/{도메인}/UI/{화면ID}/spec.md × N개
- docs/05_설계서/{도메인}/DB_{도메인}.md × N개
- docs/05_설계서/API_Design.md / DB_Schema.md / UI_Spec_v1.0.md  (전체 색인)

[기능 명세]
- docs/00_FUNC/FUNC_v1.0.md             (구현 기능 목록 — RD 대체)
- docs/00_FUNC/FUNC_MAP.md              (화면→SRS→INF→DB 직결 매핑 — RTM 대체)
- docs/03_기능명세서/SRS_v1.0.md        (SRS 색인)
- docs/03_기능명세서/domains/SRS_{도메인}.md × N개

[IA 맵]
- _tmp/ia-map.json                      (화면 계층 구조 + 화면↔INF 연결 매트릭스)
  → /understand-dashboard 실행 후 "IA" 탭에서 확인 가능

다음 단계: /sl-dev (코드 수정 필요 시) 또는 납품
```
