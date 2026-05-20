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

## STEP 0.5 — POC 모드 상태 확인 (RECON 반복 개발용)

`project.env`의 `POC_MODE` 플래그를 읽어 이번 실행 범위를 결정한다.  
POC 모드는 전체 소스를 매번 다시 처리하지 않고 특정 도메인만 빠르게 반복하는 용도다.

```bash
!python3 -c "
import os
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
poc_mode    = env.get('POC_MODE', 'false').lower() == 'true'
poc_domains = [d.strip() for d in env.get('POC_DOMAINS','').split(',') if d.strip()]
poc_skip_ua = env.get('POC_SKIP_UA', 'false').lower() == 'true'
poc_limit   = env.get('POC_FILE_LIMIT', '')

if poc_mode:
    print('━' * 50)
    print('🧪 POC 모드 활성화 — 부분 실행')
    print(f'  대상 도메인: {poc_domains if poc_domains else \"plan 전체\"}')
    print(f'  UA 분석 스킵: {poc_skip_ua}')
    print(f'  도메인별 파일 제한: {poc_limit if poc_limit else \"제한 없음\"}')
    print('━' * 50)
else:
    print('일반 모드 — 전체 소스 분석')
"
```

---

## STEP 1 — 코드 구조 분석 (UA 에이전트)

> **POC 가드**: `POC_SKIP_UA=true`이면 이 단계 전체를 스킵하고 기존 `.understand-anything/knowledge-graph.json` 재사용.

```bash
!python3 -c "
import os
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
skip = env.get('POC_SKIP_UA', 'false').lower() == 'true'
if skip:
    import json
    kg = '.understand-anything/knowledge-graph.json'
    if os.path.exists(kg):
        data = json.load(open(kg))
        print(f'🧪 POC_SKIP_UA=true — STEP 1 스킵 (기존 그래프 재사용)')
        print(f'  노드: {len(data.get(\"nodes\",[]))}, 엣지: {len(data.get(\"edges\",[]))}')
        print('  STEP 2로 진행')
    else:
        print('⚠️  POC_SKIP_UA=true이지만 knowledge-graph.json 없음 → STEP 1 강제 실행')
else:
    print('UA 분석 진행 (POC_SKIP_UA=false)')
"
```

`POC_SKIP_UA=true`이고 기존 그래프가 있으면 **아래 STEP 1 본문(1-1~1-6)을 전부 건너뛰고 STEP 2로 이동**.

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

### STEP 2-0: knowledge-graph 압축 (토큰 절약 필수)

spec-agent에게 전체 그래프를 그대로 넘기면 수백 노드가 그대로 컨텍스트에 들어간다.  
**도메인 분류에 필요한 필드만 추출**하여 `_tmp/kg_summary.json`을 생성한다.

```bash
!python3 -c "
import json, os

kg = json.load(open('.understand-anything/knowledge-graph.json'))

# 도메인 분류에 필요한 필드만 추출 (filePath, type, summary 100자, tags, layer)
summary_nodes = []
for n in kg.get('nodes', []):
    if n.get('type') not in ('file', 'module', 'class', 'router', 'endpoint', 'entrypoint', 'service'):
        continue
    summary_nodes.append({
        'id':       n.get('id'),
        'type':     n.get('type'),
        'filePath': n.get('filePath', ''),
        'summary':  (n.get('summary') or '')[:100],
        'tags':     n.get('tags', []),
        'layer':    n.get('layer', ''),
    })

kg_summary = {
    'project':  kg.get('project', {}),
    'layers':   [{k: l[k] for k in ('id','name','description') if k in l} for l in kg.get('layers', [])],
    'nodeCount': len(kg.get('nodes', [])),
    'nodes':    summary_nodes,
}

os.makedirs('_tmp', exist_ok=True)
json.dump(kg_summary, open('_tmp/kg_summary.json', 'w'), ensure_ascii=False, indent=2)
print(f'압축 완료: 전체 {len(kg[\"nodes\"])}노드 → 요약 {len(summary_nodes)}노드 (필드 5개로 축약)')
"
```

### STEP 2-1: spec-agent로 도메인 확정

`agents/spec-agent.md`를 서브에이전트로 실행한다.  
**RECON 모드에서는 `model: claude-sonnet-4-6` 으로 호출한다** (Opus 다운그레이드 — 도메인 분류는 단순 분류 작업).

```
Agent 도구 호출:
  subagent_type: "speclinker:spec-agent"
  model: "sonnet"
  description: "Phase-A: 도메인 확정 + SAD 생성"
  prompt: |
    Phase-A 실행:
    `_tmp/kg_summary.json`(압축된 코드 구조)과 domain-graph.json을 분석하여
    SAD(`docs/04_아키텍처설계서/SAD_v1.0.md`)와 도메인 계획(`docs/05_설계서/_domain_plan.json`)을 생성하라.
    도메인 수는 4~8개, 각 도메인에 INF/SCH/UIS ID 범위와 rootPaths를 사전 배정하라.
    ⚠️ 전체 knowledge-graph.json은 읽지 말 것 — kg_summary.json만 사용한다.
```

```bash
!cat docs/05_설계서/_domain_plan.json
```

### STEP 2-2: POC 도메인 필터 자동 적용 (POC_DOMAINS 설정 시)

```bash
!python3 -c "
import json, os
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
poc_mode    = env.get('POC_MODE', 'false').lower() == 'true'
poc_domains = [d.strip() for d in env.get('POC_DOMAINS','').split(',') if d.strip()]
if not poc_mode or not poc_domains:
    print('POC 도메인 필터 비활성화 — 전체 도메인 처리')
else:
    plan_path = 'docs/05_설계서/_domain_plan.json'
    plan = json.load(open(plan_path, encoding='utf-8'))
    full = plan['domains']
    kept = [d for d in full if d['name'] in poc_domains]
    skipped = [d['name'] for d in full if d['name'] not in poc_domains]
    if not kept:
        print(f'⚠️  POC_DOMAINS={poc_domains} 와 일치하는 도메인 없음 — plan 전체 유지')
    else:
        # 백업 후 필터된 plan 저장
        backup = plan_path + '.full.json'
        if not os.path.exists(backup):
            json.dump(plan, open(backup, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
            print(f'백업: {backup}')
        plan['domains'] = kept
        plan['_poc'] = {'enabled': True, 'kept': [d['name'] for d in kept], 'skipped': skipped}
        json.dump(plan, open(plan_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
        print(f'🧪 POC 필터 적용:')
        print(f'  처리 대상: {[d[\"name\"] for d in kept]}')
        print(f'  건너뜀:    {skipped}')
        print(f'  복원: {backup} → _domain_plan.json 복사')
"
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

# 배치 후보 판별 헬퍼 (최종 확인은 ddd-batch-agent가 소스 읽어 결정)
BATCH_NAME_KW = ('batch', 'job', 'scheduler', 'task', 'worker', 'consumer', 'processor', 'jobbean')
BATCH_DIR_KW  = ('batch', 'job', 'jobs', 'scheduler', 'schedule')
NON_BATCH_KW  = ('controller', 'handler', 'restcontroller', 'restapi')

def is_batch_candidate(fp):
    fp_norm = fp.replace('\\\\', '/').lower()
    bn = os.path.splitext(os.path.basename(fp_norm))[0].replace('_','').replace('-','')
    if any(k in bn for k in NON_BATCH_KW):
        return False
    if any(k in bn for k in BATCH_NAME_KW):
        return True
    parts = fp_norm.split('/')
    return any(any(k in p for k in BATCH_DIR_KW) for p in parts[:-1])

result  = []
bat_all = []       # 배치 후보 전체 (전역)
bat_id_next = [1]  # BAT-NNN 전역 카운터
BAT_SLOT = 5       # 파일당 BAT ID 여유 범위

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

    # POC 모드: 도메인별 파일 수 제한
    poc_limit = int(env.get('POC_FILE_LIMIT','0') or 0) if env.get('POC_MODE','false').lower() == 'true' else 0
    if poc_limit > 0 and len(files) > poc_limit:
        print(f'  [{d[\"name\"]}] POC_FILE_LIMIT={poc_limit} 적용: {len(files)}개 → {poc_limit}개')
        files = files[:poc_limit]

    total_slots = inf_e - inf_s + 1
    slot = max(1, math.ceil(total_slots / max(1, len(files))))
    all_items = []
    for i, fp in enumerate(files):
        s = inf_s + i * slot
        e = min(s + slot - 1, inf_e)
        all_items.append({
            'domain': d['name'],
            'domainDescription': d.get('description', ''),
            'layer': d.get('layer', ''),
            'filePath': fp,
            'infStart': s,
            'infEnd': e,
        })

    # 배치 후보와 API 파일 분리
    api_items = [item for item in all_items if not is_batch_candidate(item['filePath'])]
    bat_items = [item for item in all_items if is_batch_candidate(item['filePath'])]

    # 배치 후보에 BAT ID 범위 배정
    for item in bat_items:
        item['batStart'] = bat_id_next[0]
        item['batEnd']   = bat_id_next[0] + BAT_SLOT - 1
        bat_id_next[0]  += BAT_SLOT
        bat_all.append(item)
    if bat_items:
        print(f'  [{d[\"name\"]}] 배치 후보 {len(bat_items)}개 → batch_inventory 분리')

    # API 파일만 3개씩 묶어 배치 그룹 생성
    BATCH = 3
    for b in range(0, len(api_items), BATCH):
        result.append(api_items[b:b+BATCH])

os.makedirs('_tmp', exist_ok=True)

# 재시작 지원: 배치 내 모든 파일이 완료된 그룹은 건너뜀
def group_already_done(group):
    for item in group:
        inf_dir = f'docs/05_설계서/{item[\"domain\"]}/INF'
        if not os.path.isdir(inf_dir):
            return False
        existing = [f for f in os.listdir(inf_dir) if f.startswith('INF-') and f.endswith('.md')]
        if not existing:
            return False
    return True

pending = [g for g in result if not group_already_done(g)]
skipped = len(result) - len(pending)
total_api = sum(len(g) for g in result)
pending_files = sum(len(g) for g in pending)

with open('_tmp/router_inventory.json', 'w', encoding='utf-8') as f:
    json.dump(pending, f, ensure_ascii=False, indent=2)

# 배치 후보 인벤토리 저장 (3개씩 그룹)
bat_groups = [bat_all[b:b+3] for b in range(0, len(bat_all), 3)]
with open('_tmp/batch_inventory.json', 'w', encoding='utf-8') as f:
    json.dump(bat_groups, f, ensure_ascii=False, indent=2)

api_msg = f'API {total_api}파일 → {len(result)}그룹 (처리: {len(pending)}그룹/{pending_files}파일, 스킵: {skipped}그룹)'
bat_msg = f'배치 후보 {len(bat_all)}파일 → {len(bat_groups)}그룹' if bat_all else '배치 후보 없음'
print(f'{api_msg} | {bat_msg}')
"
```

### call chain 사전 계산 (서비스·DAO·쿼리 파일 경로 주입)

컨트롤러만 전달하면 에이전트가 서비스/DAO 경로를 스스로 추론해야 하는데, 토큰 압박 하에서 이 단계가 생략되어 `resultData: {}` 가 반복된다. **사전에 call chain을 계산하여 에이전트에게 전달한다.**

```bash
!python3 -c "
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

위 목록을 **파일 3개씩 묶어** `ddd-api-agent`에 동시 호출한다. (배치 크기: 3그룹 동시)

> ⚠️ 토큰 절약 규칙:
> - `router_inventory_with_chain.json` 항목을 3개씩 묶어 1개의 에이전트 호출로 처리
> - 동시에 띄우는 에이전트는 3개 이하
> - 한 배치 완료 후 다음 배치 시작

```
router_inventory_with_chain.json은 이미 3개씩 묶인 배치 그룹 배열이다.
동시에 3그룹씩 Agent 도구 호출, 완료 후 다음 3그룹:

  각 배치 그룹 → 1개의 Agent 도구 호출:
  subagent_type: "speclinker:ddd-api-agent"
  description: "{group[0].domain} INF 생성 ({group[0].filePath basename}, ...)"
  prompt: |
    처리 대상 파일 목록 (여러 파일 한 번에 처리):
    - {group[0].filePath} → INF-{group[0].infStart:03d} ~ INF-{group[0].infEnd:03d}
    - {group[1].filePath} → INF-{group[1].infStart:03d} ~ INF-{group[1].infEnd:03d}  (있는 경우)
    - {group[2].filePath} → INF-{group[2].infStart:03d} ~ INF-{group[2].infEnd:03d}  (있는 경우)
    도메인: {group[0].domain}
    도메인 설명: {group[0].domainDescription}
    관련 레이어: {group[0].layer}
    MODE: RECON
    워크스페이스: {현재 작업 디렉토리 절대경로}

    === 사전 계산된 연관 파일 (읽기 의무) ===
    아래 파일들은 resolve_call_chain이 미리 계산한 Controller→Service→DAO→Query 체인이다.
    Phase 1에서 반드시 Read 도구로 읽어야 한다. 직접 경로 추론은 불필요하다.

    [파일1 연관]
    서비스: {group[0].relatedFiles.service}
    DAO:    {group[0].relatedFiles.dao}
    쿼리:   {group[0].relatedFiles.query}
    스키마(사전추출): {group[0].relatedFiles.querySchemas}
      ← 각 쿼리 파일의 SELECT 컬럼·nullable·LEFT JOIN 테이블이 사전 파싱됨
      ← 응답 스키마 1차 후보로 사용 (LLM은 검증·보강만)

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

### STEP 4-B: BAT 생성 (배치 후보 파일 처리)

`_tmp/batch_inventory.json`에 배치 후보가 있는 경우만 실행한다.  
**배치 여부 최종 판단은 ddd-batch-agent가 소스를 직접 읽어 수행한다 — "배치 아님" 반환 가능.**

```bash
!python3 -c "
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
!python3 -c "
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
    MODE: RECON

    === 사전 계산된 연관 파일 (읽기 의무) ===
    아래 파일들은 resolve_call_chain이 미리 계산한 Batch→Service→DAO→Query 체인이다.
    Phase 2에서 반드시 Read 도구로 읽어야 한다. 직접 경로 추론은 불필요하다.

    [파일1 연관]
    서비스: {group[0].relatedFiles.service}
    DAO:    {group[0].relatedFiles.dao}
    쿼리:   {group[0].relatedFiles.query}
    스키마(사전추출): {group[0].relatedFiles.querySchemas}  ← 컬럼·nullable·LEFT JOIN 정보

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

**[그룹 A] ddd-db-agent — 도메인당 1호출, 최대 3개씩 배치 병렬**

> ⚠️ 토큰 절약: 도메인 전체를 한 번에 띄우지 말고 **3개씩 배치**로 나눠 순차 실행한다.

각 도메인에 대해 Agent 도구 호출 시 **가용 DB MCP 목록**을 함께 전달한다.  
에이전트가 여러 DB 중 도메인에 맞는 것을 선택하거나 전체를 활용한다.

```
도메인 목록을 3개씩 묶어 배치 단위로 반복:
  각 배치 내에서 Agent 도구 호출 (배치 내 동시):
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

    ⚠️ 토큰 절약 의무:
    - docs/05_설계서/API_Design.md 전체를 cat하지 말 것 (다른 도메인 INF까지 적재됨)
    - 자기 도메인 INF/ 디렉토리만 ls/cat 한다
    - knowledge-graph는 자기 도메인 rootPaths 범위로 필터링
```

**[그룹 B] ddd-ui-agent — 화면(라우트)별, 배치 3개씩**

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

> 그룹 A·B 모두 3개씩 배치 순차 실행. 토큰 과소비 방지.  
> **ddd-ui-agent는 spec.md만 생성한다.** preview.html/CSS는 생성하지 않는다 (STEP 5-C에서 일괄 캡처).  
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

### STEP 5-C: 미리보기 캡처 (4단계 폴백)

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

**1순위 — 런타임 캡처 (PREVIEW_BASE_URL 설정 시, Playwright):**

storageState가 없으면 **사용자에게 bootstrap 실행을 안내**한다 (캡처 자동 진행하지 않음):

```
storageState 없음 — 다음 명령을 사용자에게 안내하고 사용자가 1회 수동 로그인을 마치면 재실행:

  node "%USERPROFILE%\.claude\plugins\speclinker\scripts\runtime_capture.js" --bootstrap "%CD%"

(Chrome 창이 열림 → 로그인 + 2FA/SSO 처리 → 메인 화면 확인 → 터미널에서 Enter)
```

storageState 존재 시 캡처 실행:

```bash
!node "$HOME/.claude/plugins/speclinker/scripts/runtime_capture.js" "$(pwd)" 2>&1 | tail -30
```

Windows:

```bash
!node "%USERPROFILE%\.claude\plugins\speclinker\scripts\runtime_capture.js" "%CD%" 2>&1 | tail -30
```

> 실행 결과:
> - 성공: PNG는 즉시 `docs/05_설계서/{domain}/UI/{화면ID}/preview.png` 에 저장
> - 만료 감지 (로그인 페이지 리다이렉트 3건 이상): 캡처 자동 중단 + bootstrap 재실행 안내
> - 기타 실패 (HTTP 4xx/5xx, 타임아웃 등): `_tmp/runtime_capture_report.json`에 기록

**2순위 — 사용자 수동 PNG (PREVIEW_BASE_URL 미설정 또는 런타임 실패 시):**

사용자가 직접 화면 캡처를 다음 경로에 떨궈놓으면 자동 사용된다:

```
docs/05_설계서/{domain}/UI/{화면ID}/preview.png
```

**3순위 — 미리보기 생략:**

PNG 없음 상태로 진행. spec.md의 `![[preview.png]]` 라인은 그대로 두면 Obsidian이 누락 표시.

**4순위 — BO admin 폴백 (선택, jwork 전용):**

`project.env`에 `PREVIEW_FALLBACK_BO=true` 설정 시 BO admin 스타일 HTML 생성 → screenshot.js로 캡처.  
(이 경로는 별도 스크립트 `scripts/preview_fallback_bo.py`로 처리 — 미설치 시 스킵)

```bash
!python3 -c "
import os, json
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
fallback = env.get('PREVIEW_FALLBACK_BO','false').lower() == 'true'
report_path = '_tmp/runtime_capture_report.json'
if fallback and os.path.exists(report_path):
    r = json.load(open(report_path, encoding='utf-8'))
    missing = [x for x in r['results'] if x['status'] != 'ok']
    print(f'BO admin 폴백 대상: {len(missing)}건')
elif fallback:
    print('runtime_capture 미실행 + PREVIEW_FALLBACK_BO=true → BO admin 폴백 단독 실행')
else:
    print('BO admin 폴백 비활성화')
"
```

---

## STEP 6 — Phase-C: 색인 + FUNC 생성 + FUNC_MAP

모든 Phase-B 완료 후 스크립트 + 에이전트를 순서대로 실행한다.

**6-0. 통합 인덱스 빌드 (rd/srs/rtm 공유용 — LLM 호출 없음)** — `scripts/build_funcs_index.py` 실행:

```bash
!python3 -c "
import os, sys, subprocess
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'build_funcs_index.py') if plugin else ''
if script and os.path.exists(script):
    subprocess.run([sys.executable, script, '.'], check=False)
else:
    print('build_funcs_index.py 없음 — PLUGIN_PATH 확인')
"
```

생성된 `_tmp/funcs_index.json`은 6-2(rd-agent), 6-3(srs-agent), 6-4(rtm-agent) 세 에이전트가 공유한다.  
**동일한 spec.md/INF/*.md를 3번 cat하지 않도록 각 에이전트는 이 인덱스를 1차 입력으로 사용한다.**

**6-1. 전체 색인 생성 (스크립트, LLM 호출 없음)** — `scripts/merge_index.py` 실행:

```bash
!python3 -c "
import os, sys, subprocess
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'merge_index.py') if plugin else ''
if script and os.path.exists(script):
    subprocess.run([sys.executable, script, '.'], check=False)
else:
    print('merge_index.py 없음 — PLUGIN_PATH 확인')
"
```

도메인별 INF/SCH/UIS 파일을 스캔해서 색인 3종(API_Design.md, DB_Schema.md, UI_Spec_v1.0.md)을 자동 생성한다.  
**spec-agent Phase-C는 GENESIS 전용 (REQ 역합성·RTM)으로만 호출된다.** RECON에서는 호출하지 않는다.

**6-2. FUNC 생성** — `agents/rd-agent.md`를 서브에이전트로 실행 (RECON 모드, **Sonnet**):

```
Agent 도구 호출:
  subagent_type: "speclinker:rd-agent"
  model: "sonnet"      ← RECON 다운그레이드 (인덱스 → 마크다운 포맷팅 작업)
  description: "RECON: FUNC_v1.0.md 생성"
  prompt: |
    RECON 모드.
    `_tmp/funcs_index.json` 을 1차 입력으로 사용한다 (spec.md/INF cat 금지).
    `docs/00_FUNC/FUNC_v1.0.md`와 `docs/00_FUNC/domains/FUNC_{도메인}.md`를 생성하라.
    REQ-F 없음. FUNC-{도메인}-{NNN} ID 체계. 구현 사실만 기록.
```

**6-3. SRS 생성** — `agents/srs-agent.md`를 서브에이전트로 실행 (RECON 모드, **Sonnet**):

```
Agent 도구 호출:
  subagent_type: "speclinker:srs-agent"
  model: "sonnet"      ← RECON 다운그레이드 (사실 집계 위주, Reflexion은 자체 검증)
  description: "RECON: SRS_v1.0.md 생성"
  prompt: |
    RECON 모드.
    `_tmp/funcs_index.json` 을 1차 입력으로 사용한다.
    화면 시퀀스 + API 체인 + 비즈니스 규칙을 기능 단위 SRS-F로 집약하라.
    Reflexion 자기검증 루프(최대 2회). REQ-F 없음, FUNC-ID 역방향 연결.
    출력:
    - `docs/03_기능명세서/SRS_v1.0.md` (색인표: `| SRS-F-XXX | 기능명 | FUNC-ID |`)
    - `docs/03_기능명세서/domains/SRS_{도메인}.md` × 도메인 수
```

**6-4. FUNC_MAP 생성** — `agents/rtm-agent.md`를 서브에이전트로 실행 (RECON 모드, **Opus 유지**):

```
Agent 도구 호출:
  subagent_type: "speclinker:rtm-agent"
  ← model 미지정 (frontmatter의 opus 유지 — Constitutional 6원칙 검증 필요)
  description: "RECON: FUNC_MAP.md 생성"
  prompt: |
    RECON 모드.
    `_tmp/funcs_index.json` 을 1차 입력으로 사용한다.
    `docs/00_FUNC/FUNC_MAP.md`를 화면→SRS→INF→DB 직결 매핑표로 작성하라.
    linked-req-cache.json 생성 후 ua_req_bridge.js를 실행하라.
```

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
- docs/05_설계서/{도메인}/BAT/BAT-XXX.md × N개  (배치 명세 — 배치 파일 존재 시)
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

> **POC 모드 사용자 안내** (POC_MODE=true 였을 때):  
> `_domain_plan.json`은 POC 필터가 적용된 상태로 저장됨.  
> 전체 도메인으로 다시 돌리려면:
> 1. `_domain_plan.json.full.json` 파일이 있으면 `_domain_plan.json` 으로 복사
> 2. `project.env`의 `POC_DOMAINS=` 를 비우거나 `POC_MODE=false`
> 3. `/sl-recon` 재실행 → 전체 도메인 처리

```bash
!python3 -c "
import os, json
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
if env.get('POC_MODE','false').lower() == 'true':
    plan = json.load(open('docs/05_설계서/_domain_plan.json'))
    poc = plan.get('_poc', {})
    if poc.get('enabled'):
        print('🧪 POC 모드로 실행 완료')
        print(f'  처리: {poc.get(\"kept\",[])}')
        print(f'  건너뜀: {poc.get(\"skipped\",[])}')
        backup = 'docs/05_설계서/_domain_plan.json.full.json'
        if os.path.exists(backup):
            print(f'  복원: cp {backup} docs/05_설계서/_domain_plan.json')
"
```
