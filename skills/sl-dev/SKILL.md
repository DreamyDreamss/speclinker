---
name: sl-dev
description: DDD 설계서(GENESIS) 또는 FUNC_MAP(RECON) 기반으로 소스코드와 단위테스트를 자동 생성. MODE에 따라 linked_req(GENESIS)/linked_func(RECON) 주석 삽입. /sl-dev, /sl-dev --review, /sl-dev --pr, /sl-dev --ua-update 형식으로 호출.
triggers:
  - /sl-dev
---

# /sl-dev — 코드 자동 생성

## 호출 형식

| 형식 | 용도 |
|------|------|
| `/sl-dev` | 설계서 → 소스코드 + 단위테스트 생성 |
| `/sl-dev --review` | 변경 코드 자동 리뷰 |
| `/sl-dev --pr` | GitHub PR 자동 생성 (오픈망) |
| `/sl-dev --ua-update` | UA 지식 그래프 갱신 |
| `/sl-dev --sync` | linked_req/linked_func 스캔 → si-graph 갱신만 실행 |

## 실행 전 확인

```python
!python3 -c "
import os
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
mode = env.get('MODE','GENESIS')
print(f'MODE={mode}')
if mode == 'GENESIS':
    missing = [f for f in ['docs/05_설계서/API_Design.md','docs/05_설계서/DB_Schema.md'] if not os.path.exists(f)]
    if missing: print('[오류] 설계서 없음 — /sl-genesis 먼저 실행:', missing)
    else: print('[OK] GENESIS 설계서 확인')
elif mode == 'RECON':
    missing = [f for f in ['docs/00_FUNC/FUNC_MAP.md'] if not os.path.exists(f)]
    if missing: print('[오류] FUNC_MAP 없음 — /sl-recon 먼저 실행:', missing)
    else: print('[OK] RECON FUNC_MAP 확인')
"
```

## 기본 실행 (`/sl-dev`)

dev-agent에 위임한다:

> dev-agent에게:
> - project.env를 읽어 MODE를 확인하라
> - **GENESIS**: docs/05_설계서/의 API_Design.md + DB_Schema.md + RTM을 읽고 REQ-ID별 소스코드를 생성하라. 모든 파일 상단에 `linked_req: REQ-F-XXX` 주석을 삽입하라.
> - **RECON**: docs/00_FUNC/FUNC_MAP.md + FUNC_v1.0.md를 읽고 FUNC-ID별 소스코드를 생성하라. 모든 파일 상단에 `linked_func: FUNC-{domain}-{NNN}` 주석을 삽입하라. 기존 소스에 없는 기능 위주로 생성한다.
> - 생성 완료 후 req_scan.py + ua_req_bridge.js를 실행하라.

## 코드 리뷰 (`/sl-dev --review`)

생성된 코드를 자동으로 검토한다:
- 보안 취약점 (SQL Injection, XSS, 인증 누락)
- linked_req / linked_func 주석 누락 확인
- 설계서와 코드 일치 여부
- 결과를 `06_소스코드/reviews/review_{날짜}.md`에 저장

## PR 생성 (`/sl-dev --pr`)

```python
!python3 -c "
import os
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
print('NETWORK=' + env.get('NETWORK','closed'))
"
```

NETWORK=open인 경우: GitHub MCP를 통해 PR을 자동 생성한다. PR 설명에 linked_req/linked_func 목록을 포함한다.

NETWORK=closed인 경우: PR 생성 지침을 안내하고 수동으로 진행하도록 안내한다.

## UA 그래프 갱신 (`/sl-dev --ua-update` 또는 `--sync`)

linked_req + linked_func 스캔 후 si-graph 갱신:

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

## 완료 후 처리

**GENESIS:** RTM 상태 `🔄 진행중` → `🧪 테스트중` 변경  
**RECON:** FUNC_MAP.md 상태 업데이트 (구현 완료 표시)

다음 단계: `/sl-test` 실행
