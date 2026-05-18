---
name: sl-rtm
description: RTM(요구사항 추적 매트릭스) 독립 운용 — 커버리지 재계산, 갭 리포트, Confluence 게시. GENESIS 모드에서 동작. RECON은 /sl-rtm --func 사용.
triggers:
  - /sl-rtm
---

# /sl-rtm — RTM / FUNC_MAP 운용

요구사항 추적 매트릭스 또는 FUNC_MAP을 독립적으로 갱신하고 관리합니다.

## 호출 형식

| 형식 | 용도 |
|------|------|
| `/sl-rtm` | RTM 커버리지 재계산 + si-graph 갱신 |
| `/sl-rtm --func` | FUNC_MAP 커버리지 재계산 (RECON 모드) |
| `/sl-rtm --gap` | 미연결 REQ-ID / FUNC-ID 갭 리포트 |
| `/sl-rtm --publish` | Confluence에 RTM/FUNC_MAP 게시 (오픈망) |

---

## 기본 실행 (`/sl-rtm`)

linked_req + linked_func 스캔 → si-graph 갱신 → 커버리지 출력

```python
!python3 -c "
import os, sys, subprocess
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'req_scan.py') if plugin else ''
if script and os.path.exists(script):
    r = subprocess.run([sys.executable, script, '.'], capture_output=True, text=True)
    print(r.stdout)
else:
    print('req_scan.py 없음 — PLUGIN_PATH 확인')
"
!node -e "
const p=require('path'),f=require('fs');
const env=Object.fromEntries(f.readFileSync('project.env','utf-8').split(/\\r?\\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const[k,...v]=l.split('=');return[k.trim(),v.join('=').trim()]}));
const bridge=p.join(env.PLUGIN_PATH||'','scripts','ua_req_bridge.js');
f.existsSync(bridge)?require('child_process').execSync('node '+JSON.stringify(bridge)+' .',{stdio:'inherit'}):console.log('ua_req_bridge.js 없음');
"
```

커버리지 요약:

```python
!python3 -c "
import os, json, re
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
mode = env.get('MODE','GENESIS')

if mode == 'GENESIS':
    rtm_path = 'docs/02_추적표/RTM_v1.0.md'
    if not os.path.exists(rtm_path):
        print('RTM 없음 — /sl-genesis 먼저 실행하세요')
    else:
        content = open(rtm_path, encoding='utf-8').read()
        req_ids = set(re.findall(r'REQ-[FC]-\d+', content))
        done = content.count('✅')
        print(f'RTM 커버리지: {done}/{len(req_ids)} REQ-ID ({int(done/len(req_ids)*100) if req_ids else 0}%)')

elif mode == 'RECON':
    func_map = 'docs/00_FUNC/FUNC_MAP.md'
    if not os.path.exists(func_map):
        print('FUNC_MAP 없음 — /sl-recon 먼저 실행하세요')
    else:
        content = open(func_map, encoding='utf-8').read()
        func_ids = set(re.findall(r'FUNC-[\w]+-\d+', content))
        cache_path = '.understand-anything/linked-func-cache.json'
        linked = set()
        if os.path.exists(cache_path):
            cache = json.load(open(cache_path, encoding='utf-8'))
            for ids in cache.values():
                linked.update(ids)
        covered = len(func_ids & linked)
        print(f'FUNC 커버리지: {covered}/{len(func_ids)} FUNC-ID ({int(covered/len(func_ids)*100) if func_ids else 0}%)')
"
```

---

## FUNC_MAP 커버리지 (`/sl-rtm --func`)

RECON 프로젝트 전용. FUNC_MAP.md를 기준으로 구현 커버리지를 분석한다.

```python
!python3 -c "
import os, json, re
cache_path = '.understand-anything/linked-func-cache.json'
func_map_path = 'docs/00_FUNC/FUNC_MAP.md'

if not os.path.exists(func_map_path):
    print('FUNC_MAP.md 없음')
else:
    content = open(func_map_path, encoding='utf-8').read()
    func_ids = set(re.findall(r'FUNC-[\w]+-\d+', content))
    
    linked: set[str] = set()
    if os.path.exists(cache_path):
        cache = json.load(open(cache_path, encoding='utf-8'))
        for ids in cache.values():
            linked.update(ids)
    
    covered   = func_ids & linked
    uncovered = func_ids - linked
    
    print(f'전체 FUNC-ID: {len(func_ids)}개')
    print(f'구현 완료:    {len(covered)}개 ({int(len(covered)/len(func_ids)*100) if func_ids else 0}%)')
    print(f'미구현:       {len(uncovered)}개')
    if uncovered:
        print('\\n미구현 목록:')
        for fid in sorted(uncovered):
            print(f'  - {fid}')
"
```

---

## 갭 리포트 (`/sl-rtm --gap`)

```python
!python3 -c "
import os, json, re

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
mode = env.get('MODE','GENESIS')

if mode == 'GENESIS':
    req_cache = '.understand-anything/linked-req-cache.json'
    rtm_path  = 'docs/02_추적표/RTM_v1.0.md'
    if not os.path.exists(req_cache) or not os.path.exists(rtm_path):
        print('req-cache 또는 RTM 없음 — /sl-rtm 먼저 실행하세요')
    else:
        # linked-req-cache.json 형식: {파일경로: [REQ-ID, ...]}
        cache = json.load(open(req_cache, encoding='utf-8'))
        linked = set()
        for ids in cache.values():
            linked.update(ids)
        rtm_ids = set(re.findall(r'REQ-[FC]-\d+', open(rtm_path, encoding='utf-8').read()))
        unlinked = sorted(rtm_ids - linked)
        print(f'코드 미연결 REQ-ID: {len(unlinked)}건')
        for rid in unlinked:
            print(f'  - {rid}')

elif mode == 'RECON':
    func_cache = '.understand-anything/linked-func-cache.json'
    func_map   = 'docs/00_FUNC/FUNC_MAP.md'
    if not os.path.exists(func_cache) or not os.path.exists(func_map):
        print('func-cache 또는 FUNC_MAP 없음 — /sl-rtm --func 먼저 실행하세요')
    else:
        cache = json.load(open(func_cache, encoding='utf-8'))
        linked = set()
        for ids in cache.values():
            linked.update(ids)
        all_ids = set(re.findall(r'FUNC-[\w]+-\d+', open(func_map, encoding='utf-8').read()))
        unlinked = sorted(all_ids - linked)
        print(f'코드 미연결 FUNC-ID: {len(unlinked)}건')
        for fid in unlinked:
            print(f'  - {fid}')
"
```

---

## Confluence 게시 (`/sl-rtm --publish`)

```python
!python3 -c "
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
print('NETWORK=' + env.get('NETWORK','closed'))
"
```

`NETWORK=open`인 경우 Confluence MCP로 RTM 또는 FUNC_MAP을 게시한다.

`NETWORK=closed`인 경우 파일 경로와 수동 업로드 방법을 안내한다.
