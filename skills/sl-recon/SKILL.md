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
    poc_screens = [s.strip() for s in env.get('POC_SCREENS','').split(',') if s.strip()]
    print('━' * 50)
    print('🧪 POC 모드 활성화 — 부분 실행')
    print(f'  대상 화면 (SCREENS): {poc_screens if poc_screens else \"비활성\"}')
    print(f'  대상 도메인 (DOMAINS): {poc_domains if poc_domains else \"plan 전체\"}')
    print(f'  UA 분석 스킵: {poc_skip_ua}')
    print(f'  도메인별 파일 제한: {poc_limit if poc_limit else \"제한 없음\"}')
    if poc_screens:
        print('  ※ POC_SCREENS 활성 — 지정 화면이 호출하는 INF/SCH만 자동 슬라이스')
    print('━' * 50)
else:
    print('일반 모드 — 전체 소스 분석')
"
```

---

## STEP 1 — 코드 구조 분석 (UA 에이전트)

> **POC 가드**: `POC_SKIP_UA=true`이면 이 단계 전체를 스킵하고 기존 `.understand-anything/knowledge-graph.json` 재사용.

> 📌 **Phase 0.2 (2026-05-22)**: 이 단계 직후에 `STEP 1.5 — 프로젝트 Probe`가 새로 추가됨. 정적 신호(매니페스트·디렉토리·확장자·UA 요약)를 `_tmp/probe.json`에 모은다. 현재는 정보 수집만, Phase 1의 profile-agent에서 본격 활용 예정.

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

## STEP 1.5 — 프로젝트 Probe (정적 신호 수집) — Phase 0.2 신규

UA 그래프와 매니페스트(`pom.xml`, `package.json`, `go.mod`, `requirements.txt`, `Cargo.toml` 등)를 정적 분석해 스택·아키텍처 1차 신호를 모은다. **LLM 호출 없음.** 결과는 `_tmp/probe.json`에 저장.

> **현재 활용**: 정보 수집만. 다운스트림 동작은 변경하지 않음 (기존 흐름 그대로).
> **다음 활용 (Phase 1)**: profile-agent가 이 파일 + UA 그래프 + 코드 샘플을 보고 `project.profile.yaml`을 생성. 사용자 confirm 후 영구 저장.

`probe.json`에 들어가는 정보:
- 매니페스트별 dependencies (Spring/FastAPI/NestJS/Gin 등 framework 자동 식별)
- 디렉토리 트리 + 키워드 빈도 (architecture hint: hexagonal·n-tier·fsd·ddd 식별)
- 확장자 분포 (언어 비율)
- UA 그래프 node type 요약
- `indicators`: 추정 신호 (`likely_backend_lang`, `likely_backend_framework`, `likely_persistence`, `architecture_hints`)

```bash
!python3 -c "
import os, sys
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'probe.py') if plugin else ''
if script and os.path.exists(script):
    import subprocess
    r = subprocess.run([sys.executable, script, '.'],
                       capture_output=True, text=True, encoding='utf-8', errors='ignore')
    if r.stdout: print(r.stdout)
    if r.returncode != 0:
        print('[WARN] probe 실패 — 계속 진행:', (r.stderr or '')[:500])
else:
    print('probe.py 없음 — PLUGIN_PATH 확인. 다음 단계로 진행 (기존 동작 보존)')
"
```

---

## STEP 1.7 — 프로젝트 Profile 생성·로드 (Phase 1 신규)

`.speclinker/profile.yaml`이 있으면 그대로 로드, 없으면 `profile-agent`를 호출해 초안 생성.  
**Profile은 영구 저장**이고 confirm 되지 않은 상태에서는 사용자에게 검수를 요청한다.

```bash
!python3 -c "
import os, sys
profile_path = '.speclinker/profile.yaml'
if os.path.exists(profile_path):
    body = open(profile_path, encoding='utf-8').read()
    confirmed = 'confirmed_by:' in body and not 'confirmed_by: \"\"' in body and not 'confirmed_by: \\'\\'' in body
    print(f'기존 Profile 발견: {profile_path}')
    print(f'  confirmed: {confirmed}')
    if not confirmed:
        print('  ⚠️ 아직 사용자 confirm 안 됨 — 검수 후 confirmed_by/confirmed_at을 채워주세요')
    else:
        print('  ✓ confirm 완료 — 이대로 후속 단계 진행')
else:
    print('Profile 없음 → profile-agent 호출 필요')
" 2>/dev/null
```

Profile이 없으면 다음 에이전트 호출:

```
Agent 도구 호출:
  subagent_type: "speclinker:profile-agent"
  description: "프로젝트 Profile 초안 생성"
  prompt: |
    워크스페이스: {현재 작업 디렉토리 절대경로}
    probe.json 경로: _tmp/probe.json
    UA knowledge-graph: .understand-anything/knowledge-graph.json (있을 때만)
    MODE: RECON
    기존 profile.yaml: 없음 (또는 --reprofile 옵션으로 갱신 요청)

    참고 schema: 플러그인 templates/profile_schema.yaml

    완료 후:
    - .speclinker/profile.yaml 생성
    - Phase 4 형식의 사용자 confirm 요청 메시지 출력
    - confirmed_by/confirmed_at 은 빈 문자열로 둘 것 (사람이 채움)
```

profile-agent 완료 후 **사용자에게 confirm 요청**을 명확히 보여준다. 사용자가 confirm 하기 전까지 STEP 2 진행을 막을지는 운영 정책이다 (현재는 경고만 출력하고 진행 허용 — 점진 도입).

### 옵션: 자체 컨벤션 학습 (Phase 3 신규)

profile 생성 후 표준 strategy 합성 결과가 부족해 보이면 (예: follow_layers 가 너무 좁아 보임) **convention-learner** 를 옵션 호출한다.

```bash
!python3 -c "
import os, json
# 학습이 의미 있는 상황 자동 판단 — 예: follow_layers가 5개 미만이면 권장
import sys
sys.path.insert(0, os.environ.get('PLUGIN_PATH','') + '/scripts')
try:
    from resolve_call_chain import load_effective_layers
    follow, _, _ = load_effective_layers('.')
    if len(follow) < 8:
        print('💡 follow_layers가 좁음 — convention-learner 호출 권장')
        print(f'  현재 follow_layers: {sorted(follow)}')
    else:
        print(f'follow_layers 충분 ({len(follow)}개) — convention-learner 호출 불필요')
except Exception as e:
    print(f'check skip: {e}')
" 2>/dev/null
```

사용자가 자체 컨벤션 학습을 원하거나 위 권장이 떴을 때만 호출:

```
Agent 도구 호출:
  subagent_type: "speclinker:convention-learner"
  description: "자체 컨벤션 학습"
  prompt: |
    워크스페이스: {현재 작업 디렉토리 절대경로}
    profile 경로: .speclinker/profile.yaml
    UA knowledge-graph: .understand-anything/knowledge-graph.json
    MODE: RECON
    샘플 갯수: 20

    완료 후:
    - .speclinker/profile.yaml의 overrides 섹션에 학습 결과 추가
    - 사람 검수 요청 메시지 출력
```

### 옵션: 미지원 스택 strategy 자동 제안 (Phase 4 신규)

빌트인 strategy(현재 22개)에 profile.backend.framework가 전혀 매칭 안 되면 meta-extractor를 호출한다.

```bash
!python3 -c "
import os, sys, yaml, glob
sys.path.insert(0, os.environ.get('PLUGIN_PATH','') + '/scripts')
try:
    from resolve_call_chain import load_effective_layers, load_yaml, _profile_matches_strategy
    profile = load_yaml('.speclinker/profile.yaml') if os.path.exists('.speclinker/profile.yaml') else None
    if not profile:
        print('profile 없음 — meta-extractor 호출 불가')
    else:
        plugin = os.environ.get('PLUGIN_PATH','')
        strategies_dir = os.path.join(plugin, 'strategies') if plugin else 'strategies'
        backend_strategies = glob.glob(os.path.join(strategies_dir, 'backends', '*.yaml'))
        matched = []
        for sf in backend_strategies:
            s = load_yaml(sf)
            if s and _profile_matches_strategy(profile, s):
                matched.append(s['name'])
        if not matched and (profile.get('backend') or {}).get('framework'):
            fw = profile['backend']['framework']
            print(f'⚠️ profile.backend.framework={fw} 인데 매칭되는 빌트인 backend strategy 없음')
            print(f'  → meta-extractor 호출 권장 (target_kind=backend, target_name={fw})')
        else:
            print(f'빌트인 매칭: {matched if matched else \"(N/A — profile에 framework 미설정)\"}')
except Exception as e:
    print(f'check skip: {e}')
" 2>/dev/null
```

매칭 안 되는 경우만 호출:

```
Agent 도구 호출:
  subagent_type: "speclinker:meta-extractor"
  description: "신규 스택 strategy 초안 생성"
  prompt: |
    워크스페이스: {현재 작업 디렉토리 절대경로}
    profile 경로: .speclinker/profile.yaml
    UA knowledge-graph: .understand-anything/knowledge-graph.json
    target_kind: backend     ← profile에서 누락된 차원
    target_name: {profile.backend.framework 값}
    MODE: RECON
    샘플 갯수: 30

    완료 후:
    - strategies/community/backend-{name}.yaml 초안 생성
    - 사용자 검수 요청 메시지 출력
```

검수 후 사용자가 `mv strategies/community/X strategies/{kind}/X` 하면 정식 strategy로 promote.

---

## ✋ STEP 2 — 화면 발견 + Screen Plan 확정 (Phase 7 핵심)

> **Phase 7 Screen-first**: 화면이 1차 산출물. 도메인 분석(STEP 3) **전에** 화면 목록을 확정한다.  
> 화면 구조가 도메인 경계 결정에 영향을 주기 때문이다 (D12 결정).  
> 이미 `.speclinker/screen_plan.confirmed.json`이 있으면 이 단계 전체를 스킵한다.

### STEP 2-0: 기존 confirmed plan 확인

```bash
!python3 -c "
import os, json
path = '.speclinker/screen_plan.confirmed.json'
if os.path.exists(path):
    data = json.load(open(path, encoding='utf-8'))
    screens = data.get('screens', [])
    print(f'screen_plan.confirmed.json 존재 ({len(screens)}개, confirmed_by={data.get(\"confirmed_by\",\"\")!r})')
    print('STEP 2 스킵 → STEP 3으로 이동')
else:
    print('screen_plan.confirmed.json 없음 → 정적 발견 진행')
"
```

`confirmed.json`이 있으면 **STEP 3으로 바로 이동**.

### STEP 2-1: 정적 화면 발견

```bash
!python3 -c "
import os, sys, subprocess
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH', '')
script = os.path.join(plugin, 'scripts', 'screen_plan_discover.py') if plugin else ''
if script and os.path.exists(script):
    r = subprocess.run([sys.executable, script, '.'], capture_output=True, text=True, encoding='utf-8', errors='ignore')
    if r.stdout: print(r.stdout)
    if r.returncode != 0:
        print('[WARN] screen_plan_discover 실패:', (r.stderr or '')[:500])
else:
    print('screen_plan_discover.py 없음 — PLUGIN_PATH 확인')
"
```

```bash
!python3 -c "
import json, os
path = '_tmp/screen_plan_static.json'
if not os.path.exists(path):
    print('[WARN] screen_plan_static.json 없음')
else:
    data = json.load(open(path, encoding='utf-8'))
    screens = data.get('screens', [])
    disc    = data.get('discovery', {})
    fw = disc.get('framework_used','?')
    print(f'framework: {fw}  |  정적 {disc.get(\"static_count\",0)}개 + 수동 {disc.get(\"manual_count\",0)}개')
    print()
    for i, s in enumerate(screens, 1):
        nf = len(s.get('component_files', []))
        bn = os.path.basename(s.get('entry','') or '(no entry)')
        print(f'  {i:3}. {s[\"route\"]:45}  {bn:25}  +{nf} 컴포넌트')
    print()
    print(f'총 {len(screens)}개 화면 감지')
"
```

### ✋ STEP 2-2 — Screen Plan 사용자 확정 (필수 체크포인트)

> **POC 모드 자동 처리 (POC_SCREENS 설정 시)**:  
> 화면 목록을 POC_SCREENS로 자동 필터링하고 사람 확인 없이 confirmed.json을 저장한다.  
> 아래 a/b/c 선택지는 **일반 모드 전용**이다.

```bash
!python3 -c "
import json, os, sys
from datetime import datetime, timezone

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
poc_mode    = env.get('POC_MODE','false').lower() == 'true'
poc_screens = [s.strip() for s in env.get('POC_SCREENS','').split(',') if s.strip()]

if not poc_mode or not poc_screens:
    print('일반 모드 — 아래 a/b/c 선택 필요')
    sys.exit(0)

src = '_tmp/screen_plan_static.json'
dst = '.speclinker/screen_plan.confirmed.json'

if not os.path.exists(src):
    print('[WARN] screen_plan_static.json 없음 — STEP 2-1 재실행 필요')
    sys.exit(0)

data = json.load(open(src, encoding='utf-8'))
all_screens = data.get('screens', [])

# POC_SCREENS 필터 (entryFile 베이스명·route 말단 세그먼트·screenId 부분 매칭)
def poc_match(s):
    entry = s.get('entry_file') or s.get('entryFile') or ''
    route = s.get('route') or ''
    sid   = s.get('screen_id') or s.get('screenId') or ''
    base  = os.path.splitext(os.path.basename(entry))[0].lower()
    segs  = {base, route.rstrip('/').split('/')[-1].lower(), sid.lower()}
    for t in poc_screens:
        tl = t.lower()
        if any(c and (c == tl or c.startswith(tl) or tl.startswith(c)) for c in segs):
            return True
    return False

kept = [s for s in all_screens if poc_match(s)]
if not kept:
    print(f'⚠️  POC_SCREENS={poc_screens} 와 매칭 화면 없음 — screen_plan_static에 없거나 이름 불일치')
    print('전체 화면 그대로 확정합니다')
    kept = all_screens

data['screens'] = kept
data['confirmed_by'] = f'poc_auto ({poc_screens})'
data['confirmed_at'] = datetime.now(timezone.utc).astimezone().isoformat()

os.makedirs('.speclinker', exist_ok=True)
json.dump(data, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(f'🧪 POC 자동 확정: {len(kept)}/{len(all_screens)}개 화면 → {dst}')
for s in kept:
    print(f'  - {s.get(\"entry_file\") or s.get(\"entryFile\",\"?\")}  ({s.get(\"route\",\"?\")})')
print('STEP 3으로 진행')
"
```

일반 모드에서는 아래 선택지를 사용한다 (POC 모드이면 위 코드가 자동 처리하므로 건너뜀):

**확인 전 STEP 3 진행 금지.**

```
[화면 목록 확인 요청 — 일반 모드]
위 화면 목록에 대해 선택해 주세요:

a) 이게 다임 → 그대로 확정하고 진행합니다
b) runtime 보강 필요 → Chrome --remote-debugging-port=9222 로 앱을 실행 후 로그인하고
   알려주시면 STEP 2.5 메뉴 traversal로 화면 목록을 보강합니다
c) 일부 수정 → 추가/제외할 화면 번호나 route를 알려주세요
```

**a) 선택 시** — confirmed.json 저장 후 STEP 3으로:

```bash
!python3 -c "
import json, os
from datetime import datetime, timezone
src = '_tmp/screen_plan_static.json'
dst = '.speclinker/screen_plan.confirmed.json'
os.makedirs('.speclinker', exist_ok=True)
data = json.load(open(src, encoding='utf-8'))
data['confirmed_by'] = 'user'
data['confirmed_at'] = datetime.now(timezone.utc).astimezone().isoformat()
json.dump(data, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(f'저장: {dst}  ({len(data[\"screens\"])}개 화면 확정)')
"
```

**c) 수정 시** — 사용자 수정 반영 후 동일하게 confirmed.json 저장.

---

## STEP 2.5 — 런타임 BFS 메뉴 탐색 (Phase 7.4, b) 선택 시만)

> **트리거**: STEP 2-2에서 사용자가 **b) runtime 보강 필요**를 선택한 경우에만 실행.  
> Chrome `--remote-debugging-port=9222`로 앱을 로그인까지 마친 상태에서 아래를 실행.

```bash
# capture.js --traverse-menu 모드 — 메뉴 DOM BFS 탐색 + 실제 클릭 → screen_plan_runtime.json
!node "%PLUGIN_PATH%\scripts\capture.js" --traverse-menu --port=9222 --workspace="%CD%"
```

```bash
!python3 -c "
import os, sys, subprocess
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH', '')
script = os.path.join(plugin, 'scripts', 'screen_plan_merge.py') if plugin else ''
if script and os.path.exists(script):
    subprocess.run([sys.executable, script, '.'], check=False)
else:
    print('screen_plan_merge.py 없음 — PLUGIN_PATH 확인')
"
```

```bash
!python3 -c "
import json, os
from datetime import datetime, timezone
src = '_tmp/screen_plan_merged.json'
dst = '.speclinker/screen_plan.confirmed.json'
os.makedirs('.speclinker', exist_ok=True)
data = json.load(open(src, encoding='utf-8'))
data['confirmed_by'] = 'user+runtime-bfs'
data['confirmed_at'] = datetime.now(timezone.utc).astimezone().isoformat()
json.dump(data, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
disc = data.get('discovery', {})
print(f'저장: {dst}  총 {disc.get(\"merged_total\",0)}개 (정적 {disc.get(\"static_count\",0)} + 런타임 신규 {disc.get(\"runtime_added\",0)})')
"
```

---

## STEP 3 — Phase-A: SAD + 도메인 목록 확정

### STEP 3-0: knowledge-graph 압축 (토큰 절약 필수)

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

### STEP 3-1: spec-agent로 도메인 확정

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

### STEP 3-2: POC 도메인 필터 자동 적용 (POC_DOMAINS 설정 시)

```bash
!python3 -c "
import json, os
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
poc_mode    = env.get('POC_MODE', 'false').lower() == 'true'
poc_domains = [d.strip() for d in env.get('POC_DOMAINS','').split(',') if d.strip()]
if not poc_mode:
    print('POC 도메인 필터 비활성화 — 전체 도메인 처리')
elif not poc_domains:
    # POC_SCREENS만 설정된 경우 — screen_inventory.json에서 도메인 자동 감지
    inv_path = '_tmp/screen_inventory.json'
    if os.path.exists(inv_path):
        inv = json.load(open(inv_path, encoding='utf-8'))
        poc_screens = [s.strip() for s in env.get('POC_SCREENS','').split(',') if s.strip()]
        auto = []
        for s in inv:
            domain = s.get('domain','')
            sid   = (s.get('screenId') or s.get('screen_id') or '').lower()
            entry = os.path.splitext(os.path.basename(s.get('entryFile') or s.get('entry_file') or '')).lower() if True else ''
            if domain and any(sid.startswith(t.lower()) or t.lower().startswith(sid) for t in poc_screens):
                if domain not in auto:
                    auto.append(domain)
        if auto:
            poc_domains = auto
            print(f'POC_SCREENS → 도메인 자동 감지: {poc_domains}')
        else:
            print('POC_SCREENS 설정되었으나 screen_inventory에서 도메인 감지 실패 — 전체 도메인 처리')
    else:
        print('POC_SCREENS 설정되었으나 screen_inventory.json 없음 — 전체 도메인 처리')
        print('  힌트: POC_DOMAINS=product 를 project.env에 추가하거나 첫 실행 후 재시도')
if poc_domains:
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

## ✋ STEP 4 — 사용자 도메인 검토 (필수 체크포인트)

> **POC 모드 (POC_SCREENS 설정 시)**: 도메인 목록을 출력하되 사람 확인 없이 자동 진행한다.

```bash
!python3 -c "
import json, os
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
poc_mode    = env.get('POC_MODE','false').lower() == 'true'
poc_screens = [s.strip() for s in env.get('POC_SCREENS','').split(',') if s.strip()]

plan = json.load(open('docs/05_설계서/_domain_plan.json', encoding='utf-8'))
poc_flag = plan.get('_poc',{}).get('enabled', False)

print(f'프로젝트: {plan[\"project\"]}')
if poc_flag:
    print(f'🧪 POC 필터 적용됨 (POC_SCREENS={poc_screens})')
print()
print('처리 대상 도메인:')
for i, d in enumerate(plan['domains'], 1):
    inf = f'INF-{d[\"inf\"][\"start\"]:03d}~{d[\"inf\"][\"end\"]:03d}'
    sch = f'SCH-{d[\"sch\"][\"start\"]:03d}~{d[\"sch\"][\"end\"]:03d}'
    uis = f'UIS-F-{d[\"uis\"][\"start\"]:03d}~{d[\"uis\"][\"end\"]:03d}'
    print(f'  {i}. {d[\"name\"]:15} {d[\"description\"][:30]:30} {inf} {sch} {uis}')
print(f'\n총 {len(plan[\"domains\"])}개 도메인')

if poc_mode and poc_screens:
    print()
    print('🧪 POC 모드 — STEP 4 자동 확인. STEP 5로 진행합니다.')
else:
    print()
    print('수정 없으면 \"계속\", 수정 필요하면 변경 내용을 입력하세요.')
"
```

**일반 모드**: 수정 없으면 "계속", 수정 필요하면 변경 내용 입력 받아 `_domain_plan.json` 수정 후 진행.  
**POC 모드**: 위 스크립트가 자동 진행 메시지를 출력한 직후 STEP 5로 이동.  
**확인(또는 자동 진행) 전 STEP 5 절대 진행 금지.**

---

## STEP 5 — router_inventory + call chain 사전 계산

> INF 생성은 STEP 7(api_hints 기반)에서 수행한다. 이 단계는 **pre-compute 전용**:  
> 컨트롤러 파일 목록 + 서비스/DAO/쿼리 call chain을 미리 계산해 STEP 6(UIS) · STEP 7(INF) 양측이 공유한다.

### STEP 5-0: POC_SCREENS 사전 슬라이스 (POC_SCREENS 설정 시만)

POC_SCREENS가 비어있지 않으면 화면 인벤토리를 먼저 생성하고 슬라이스를 적용한다.  
지정 화면이 호출하는 API URL만 router_inventory에 남긴다.

```bash
!python3 -c "
import os, sys, subprocess
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
poc_mode    = env.get('POC_MODE','false').lower() == 'true'
poc_screens = env.get('POC_SCREENS','').strip()
if not poc_mode or not poc_screens:
    print('POC_SCREENS 비활성화 — STEP 5-0 건너뜀')
else:
    plugin = env.get('PLUGIN_PATH','')
    inv_script   = os.path.join(plugin, 'scripts', 'screen_inventory.py') if plugin else ''
    slice_script = os.path.join(plugin, 'scripts', 'poc_slice.py')        if plugin else ''
    if not (os.path.exists(inv_script) and os.path.exists(slice_script)):
        print('[WARN] screen_inventory.py 또는 poc_slice.py 없음 — POC_SCREENS slice 스킵')
    else:
        # 1) screen_inventory 먼저 생성 (UA 그래프 자동 감지)
        subprocess.run([sys.executable, inv_script, '.'], check=False)
        # 2) POC slice 적용
        subprocess.run([sys.executable, slice_script, '.'], check=False)
"
```

> 결과:
> - `_tmp/screen_inventory.json`: 지정 화면만 남김 (.full.json 백업)
> - `_tmp/poc_target_urls.json`: 화면들이 호출하는 API URL 목록
> 
> 이후 router_inventory 생성 단계에서 위 URL을 호출하는 컨트롤러만 남는다.

### STEP 5-1: INF 분석 그래프 결정

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
import json, os, math, re

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

    # POC 모드 필터 (3종)
    poc_mode = env.get('POC_MODE','false').lower() == 'true'

    # ── (1) POC_SCREENS 기반 URL 매칭 필터 (최우선) ──
    # poc_slice.py가 미리 _tmp/poc_target_urls.json 을 생성했으면 그 URL을 호출하는 컨트롤러만 유지
    poc_url_file = '_tmp/poc_target_urls.json'
    if poc_mode and os.path.exists(poc_url_file):
        poc_data = json.load(open(poc_url_file, encoding='utf-8'))
        target_urls = set(poc_data.get('targetUrls', []))
        if target_urls:
            # resolve_call_chain.extract_defined_urls 사용 — Java Spring + Python FastAPI 통합 처리
            import sys as _sys
            plugin = env.get('PLUGIN_PATH','')
            if plugin and os.path.join(plugin, 'scripts') not in _sys.path:
                _sys.path.insert(0, os.path.join(plugin, 'scripts'))
            try:
                from resolve_call_chain import extract_defined_urls as _edu
            except ImportError:
                _edu = None
            matched_files = []
            for fp in files:
                abs_fp = fp if os.path.isabs(fp) else os.path.join(os.getcwd(), fp)
                if not os.path.exists(abs_fp):
                    continue
                if _edu:
                    full_urls = set(_edu(abs_fp))
                else:
                    # fallback: Java-only inline regex (이전 동작 보존)
                    import re as _re
                    try:
                        body = open(abs_fp, encoding='utf-8', errors='ignore').read()
                    except Exception:
                        continue
                    _URL_RE = _re.compile(r"""@(?:Get|Post|Put|Delete|Patch|Request)Mapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]+)['"]""")
                    defined = _URL_RE.findall(body)
                    pfx_m = _re.search(r"@RequestMapping\s*\(\s*['\"](/[^'\"]+)['\"]", body)
                    pfx = pfx_m.group(1).rstrip('/') if pfx_m else ''
                    full_urls = set()
                    for u in defined:
                        f = (pfx + '/' + u.strip('/')) if pfx else u
                        full_urls.add(f if f.startswith('/') else '/'+f)
                if any(any(t == fu or t.startswith(fu) or fu.startswith(t) for fu in full_urls) for t in target_urls):
                    matched_files.append(fp)
            if matched_files:
                if len(matched_files) < len(files):
                    print(f'  [{d[\"name\"]}] POC_SCREENS URL 매칭: {len(files)}개 → {len(matched_files)}개 컨트롤러')
                files = matched_files

    # ── (2) POC_FILE_LIMIT (보조) ──
    poc_limit = int(env.get('POC_FILE_LIMIT','0') or 0) if poc_mode else 0
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

> 📌 **부가 산출물**: `resolve_call_chain.py`는 `router_inventory` 처리 시 `_tmp/sch_draft/{도메인}/{테이블}.json`도 함께 생성한다.  
> SQL 텍스트에서 추출한 도메인별 테이블·컬럼·근거 파일·INF 범위 매핑이 들어 있으며, STEP 8의 `ddd-db-agent` 1차 입력으로 사용된다.  
> 같은 DAO/Mapper/SQL을 SCH 단계에서 다시 Read하지 않도록 하는 토큰 절약 캐시 역할.

> 📌 `router_inventory_with_chain.json` 생성 완료 — STEP 6(UIS)·STEP 7(INF) 양측이 이 파일을 입력으로 사용한다.  
> **INF 실제 생성은 STEP 7 (api_hints 기반)에서 수행한다.** 이 단계에서는 에이전트 호출 없음.

---

### STEP 5-B: BAT 생성 (배치 후보 파일 처리)

`_tmp/batch_inventory.json`에 배치 후보가 있는 경우만 실행한다.  
**배치 여부 최종 판단은 ddd-batch-agent가 소스를 직접 읽어 수행한다 — "배치 아님" 반환 가능.**

```bash
!python3 -c "
import json, os
path = '_tmp/batch_inventory.json'
if not os.path.exists(path):
    print('batch_inventory.json 없음 — STEP 5-B 건너뜀')
else:
    groups = json.load(open(path, encoding='utf-8'))
    total = sum(len(g) for g in groups)
    if total == 0:
        print('배치 후보 없음 — STEP 5-B 건너뜀')
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
    프로젝트 Profile: .speclinker/profile.yaml (있으면 batch.runner/scheduler로 배치 종류 인식)

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

## STEP 6 — Phase B-1: UIS 생성 (Screen-first)

> **Screen-first (D8/D12 결정)**: 화면 설계서(spec.md)를 먼저 생성하고, spec.md의 `api_hints`를 기반으로  
> STEP 7에서 INF를 생성한다. INF 번호 배정은 STEP 7 — UIS 생성 시에는 API URL만 기록하면 된다.

### STEP 6-0: UI 분석 그래프 결정

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

### STEP 6-0.5: 캡처 가능 여부 확인 + bootstrap 자동 실행

`PREVIEW_BASE_URL`과 `PREVIEW_STORAGE_STATE`(storageState) 상태를 확인하고,  
필요 시 bootstrap을 **이 단계에서 자동으로 실행**한다.

| 단계 | 역할 | 항상 실행? |
|------|------|---------|
| STEP 6-2 [A] 런타임 캡처 | DOM 구조·위젯 위치·스크린샷 → §0/§2/§4/§8 | storageState 있을 때만 |
| STEP 6-3 [B] generate_uis_spec.py | widgets.json → spec.md 시각 초안 | widgets.json 있는 화면만 |
| STEP 6-4 [C] ddd-ui-agent | 소스 파일 → §5 인터랙션 + _inf_required.json | **항상** |

```bash
!python3 -c "
import os
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
base_url   = env.get('PREVIEW_BASE_URL', '')
storage    = env.get('PREVIEW_STORAGE_STATE', '.preview-storage.json')
abs_storage = storage if os.path.isabs(storage) else os.path.join(os.getcwd(), storage)
has_base    = bool(base_url)
has_storage = os.path.exists(abs_storage)

print(f'PREVIEW_BASE_URL : {base_url if base_url else \"미설정\"}')
print(f'storageState     : {abs_storage}  ({\"존재\" if has_storage else \"없음\"})')

if not has_base:
    print()
    print('[캡처 스킵] PREVIEW_BASE_URL 미설정')
    print('  → project.env에 PREVIEW_BASE_URL=http://... 추가 후 재실행하면 캡처 활성화')
elif has_storage:
    print()
    print('[캡처 준비 완료] STEP 6-2에서 자동 캡처 실행')
else:
    print()
    print('[bootstrap 필요] storageState 없음 → STEP 6-2 전에 bootstrap 실행 필요')
    print('NEED_BOOTSTRAP=true')
"
```

**위 출력에 `NEED_BOOTSTRAP=true`가 있으면 즉시 아래를 실행한다:**

```bash
# PLUGIN_PATH를 project.env에서 읽어 bootstrap 실행
!python3 -c "
import os, subprocess, sys
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH', '')
script = os.path.join(plugin, 'scripts', 'runtime_capture.js') if plugin else ''
if not script or not os.path.exists(script):
    print('runtime_capture.js를 찾을 수 없습니다. PLUGIN_PATH를 확인하세요.')
    sys.exit(1)
print(f'bootstrap 실행: node {script} --bootstrap .')
" && node "$(python3 -c "import os; env=dict(l.strip().split('=',1) for l in open('project.env') if '=' in l and not l.startswith('#')); print(os.path.join(env.get('PLUGIN_PATH',''), 'scripts', 'runtime_capture.js'))")" --bootstrap "."
```

> **사용자 액션 필요 (1회):**  
> 위 명령이 실행되면 Chrome 창이 자동으로 열립니다.  
> 1. 열린 Chrome에서 로그인 (2FA·SSO·CAPTCHA 포함)  
> 2. 메인 화면 확인 후 **이 터미널에서 Enter**  
> → `.preview-storage.json` 저장 완료 → STEP 6-2 자동 캡처로 진행

bootstrap 완료 후 storageState 재확인:

```bash
!python3 -c "
import os
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
storage = env.get('PREVIEW_STORAGE_STATE', '.preview-storage.json')
abs_storage = storage if os.path.isabs(storage) else os.path.join(os.getcwd(), storage)
if os.path.exists(abs_storage):
    print(f'[OK] storageState 확인: {abs_storage}')
    print('[캡처 준비 완료] STEP 6-2 진행')
else:
    print('[WARN] storageState 생성 안 됨 — bootstrap이 완료됐는지 확인')
"
```

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

### STEP 6-2: [A] 런타임 캡처 (storageState 있을 때만)

storageState가 있으면 `runtime_capture.js --inspect`를 실행한다.  
**없으면 이 단계를 스킵하고 STEP 6-3으로 바로 이동한다.**

preview.png + 탭별 위젯 JSON을 **한 번의 실행**으로 모든 화면에 생성한다.

```bash
# Linux/macOS:
!node "$PLUGIN_PATH/scripts/runtime_capture.js" --inspect "$(pwd)" 2>&1 | tail -50
```

```powershell
# Windows:
!node "$env:PLUGIN_PATH\scripts\runtime_capture.js" --inspect "$pwd" 2>&1 | Select-Object -Last 50
```

> `--inspect`가 각 화면 디렉토리(`docs/05_설계서/{domain}/UI/{화면ID}/`)에 생성하는 파일:
> - `preview.png` — 전체 화면 스크린샷
> - `preview_tab{N}_{탭명}.png` + `preview_tab{N}_{탭명}_widgets.json` — 탭별 위젯 목록
> - `network_requests.json` — XHR/fetch 인터셉트 기록

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

**5순위 — 다탭 SI 어드민 attach 캡처 (선택, Phase 6.2·6.4)**

복잡한 jwork·다탭 화면(예: 상품등록 8탭)은 자동 1순위로 못 잡힐 수 있다. 이 경우 사용자가 Chrome `--remote-debugging-port=9222` 로 로그인까지 마친 상태에서 `scripts/capture.js`를 attach 모드로 호출한다. 메뉴 자동 진입 + 트리거 버튼 클릭 + 다탭 순회 + auto-annotate + widgets.json(DOM 메타 11종 + api_hints + condition_hints) dump를 일괄 처리한다. 이어서 `scripts/generate_uis_spec.py`가 widgets.json + INF 디렉토리를 cross-link 해서 §4 풀자동 / §5 INF 매핑 / §8 조건 신호까지 spec.md 본문을 자동 작성한다.

```bash
# 1) Chrome 디버깅 모드로 띄우고 로그인까지 사용자가 직접
#    Start-Process chrome -ArgumentList '--remote-debugging-port=9222','--user-data-dir=C:/tmp/chrome-attach'
# 2) 화면별 attach 캡처 (사용자 명시 호출)
!node "%PLUGIN_PATH%\scripts\capture.js" --out=docs/05_설계서/{domain}/UI/{화면ID} ^
       --frame-url={routeKeyword} --tabs=auto --auto-annotate
# 3) spec.md 자동 생성 (widgets.json → §4/§5/§8 자동) + INF gaps.json 출력
!python3 "%PLUGIN_PATH%\scripts\generate_uis_spec.py" ^
       docs/05_설계서/{domain}/UI/{화면ID} ^
       --uis-id=UIS-F-{NNN} --screen-id={화면ID} --screen-name={화면명} ^
       --route={route} --domain={domain}
```

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

## STEP 7 — Phase B-2: INF 생성 (api_hints 기반)

> **Screen-first INF**: UIS spec.md의 `api_hints`(화면이 실제 호출하는 URL)에서 INF를 생성한다.  
> 화면에 연결되지 않은 컨트롤러(API-residual)는 마지막에 `used_by_screens: []`로 처리한다.

### STEP 7-0: api_hints 집계 + call chain 매핑

`_tmp/uis_api_hints.json`과 `_tmp/router_inventory_with_chain.json`을 cross-match 한다:

```bash
!python3 -c "
import os, json, re

hints = json.load(open('_tmp/uis_api_hints.json', encoding='utf-8')) if os.path.exists('_tmp/uis_api_hints.json') else []
if not hints:
    print('[WARN] uis_api_hints.json 없음 또는 빈 파일 — STEP 6-4 재실행 필요')
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

```
도메인 목록을 3개씩 묶어 배치 단위로 반복:
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

## STEP 9 — Phase-C: 색인 + FUNC 생성 + FUNC_MAP

모든 Phase-B 완료 후 스크립트 + 에이전트를 순서대로 실행한다.

**9-0. 통합 인덱스 빌드 (rd/srs/rtm 공유용 — LLM 호출 없음)** — `scripts/build_funcs_index.py` 실행:

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

생성된 `_tmp/funcs_index.json`은 9-2(rd-agent), 9-3(srs-agent), 9-4(rtm-agent) 세 에이전트가 공유한다.  
**동일한 spec.md/INF/*.md를 3번 cat하지 않도록 각 에이전트는 이 인덱스를 1차 입력으로 사용한다.**

**9-0-1. SI 트레이싱 그래프 빌드 (LLM 호출 없음)** — `scripts/build_si_graph.py` 실행:

```bash
!python3 -c "
import os, sys, subprocess
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'build_si_graph.py') if plugin else ''
if script and os.path.exists(script):
    subprocess.run([sys.executable, script, '.'], check=False)
else:
    print('build_si_graph.py 없음 — PLUGIN_PATH 확인')
"
```

INF/UIS/SCH 파일을 스캔하여 스펙 노드 + `traces_to` 엣지 생성 →  
`.understand-anything/si-graph.json` (대시보드 SI 탭에서 스펙↔코드 매핑 시각화).

---

**9-1. 전체 색인 생성 (스크립트, LLM 호출 없음)** — `scripts/merge_index.py` 실행:

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

**9-2. FUNC 생성** — `agents/rd-agent.md`를 서브에이전트로 실행 (RECON 모드, **Sonnet**):

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

    Screen-first 신호 활용 (funcs_index.json 내):
    - screens 섹션: 각 UIS-F-XXX의 screen_name·route·api_hints 목록
    - infs 섹션: 각 INF의 used_by_screens 필드 (어느 화면이 이 INF를 호출하는지)
    - 화면 단위로 FUNC를 구성한다 (화면 1개 = 1~3 FUNC 목표).
      예: UIS-F-001 주문목록 → FUNC-order-001(주문 목록 조회), FUNC-order-002(주문 상태 필터)
```

**9-3. SRS 생성** — `agents/srs-agent.md`를 서브에이전트로 실행 (RECON 모드, **Sonnet**):

> **Phase 7.7 변경**: SRS-F를 도메인 단위가 아닌 **화면(UIS) 단위 use-case**로 생성한다.  
> 화면 1개 = SRS-F 1개가 원칙. 복잡한 다탭 화면은 최대 2~3개로 분리 허용.

```
Agent 도구 호출:
  subagent_type: "speclinker:srs-agent"
  model: "sonnet"      ← RECON 다운그레이드 (사실 집계 위주, Reflexion은 자체 검증)
  description: "RECON: SRS_v1.0.md 생성 (화면별 use-case)"
  prompt: |
    RECON 모드 — Screen-first SRS.
    `_tmp/funcs_index.json` 을 1차 입력으로 사용한다.

    SRS-F 생성 단위: **각 화면(UIS-F-XXX) = use-case 1개** (도메인 집계 아님).
    화면 순서대로 SRS-F-NNN을 배정한다.

    각 SRS-F의 필수 항목:
    - 화면명 + route (UIS spec.md 참조)
    - 전제조건: 로그인 여부, 권한, 이전 화면 등
    - 기본흐름: 화면 진입 → API 호출(api_hints 목록) → 결과 렌더링
    - 예외흐름: API 오류, 권한 없음, 데이터 없음
    - §5 인터페이스: api_hints 기반 INF-XXX 링크 (used_by_screens 역참조로 확정)
    - FUNC-ID 역방향 연결

    Reflexion 자기검증 루프(최대 2회).
    출력:
    - `docs/03_기능명세서/SRS_v1.0.md`
      (색인표: `| SRS-F-XXX | 화면명 | UIS-ID | 호출 INF | FUNC-ID |`)
    - `docs/03_기능명세서/domains/SRS_{도메인}.md` × 도메인 수
      (각 도메인 파일에는 해당 도메인 화면들의 SRS-F만 포함)
```

**9-4. FUNC_MAP 생성** — `agents/rtm-agent.md`를 서브에이전트로 실행 (RECON 모드, **Opus 유지**):

> **Phase 7.7 변경**: FUNC_MAP을 **화면(UIS) → SRS → INF → SCH** 4단 체인 매트릭스로 생성한다.  
> INF의 `used_by_screens` 필드를 역참조하여 화면↔INF 연결을 사실 기반으로 확정한다.

```
Agent 도구 호출:
  subagent_type: "speclinker:rtm-agent"
  ← model 미지정 (frontmatter의 opus 유지 — Constitutional 6원칙 검증 필요)
  description: "RECON: FUNC_MAP.md 생성 (화면→SRS→INF→SCH 매트릭스)"
  prompt: |
    RECON 모드 — Screen-first FUNC_MAP.
    `_tmp/funcs_index.json` 을 1차 입력으로 사용한다.

    FUNC_MAP 행 단위: **화면 1개 = 1행** (도메인 집계 아님).
    컬럼 구성:
    | UIS-ID | 화면명 | Route | SRS-F | FUNC-ID | 호출 INF 목록 | 연관 SCH |

    데이터 소스 우선순위:
    1. INF 파일의 `used_by_screens` 필드 → 화면↔INF 연결 (사실 기반, 최우선)
    2. UIS spec.md의 `api_hints` → INF가 없는 URL 보완
    3. SRS_v1.0.md의 SRS-F↔UIS-ID 매핑 → SRS 컬럼
    4. INF↔SCH 연결은 INF 파일의 `related_sch` 또는 테이블명 기반 추론

    linked-req-cache.json 생성 후 ua_req_bridge.js를 실행하라.
    출력: `docs/00_FUNC/FUNC_MAP.md`
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

## STEP 10 — IA 맵 생성

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

## STEP 11 — si-graph 갱신 확인

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
