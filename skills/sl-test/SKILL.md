---
name: sl-test
description: RTM/FUNC_MAP 기반 TC 자동 작성, 테스트 실행, TR 생성, Jira 버그 등록. /sl-test, /sl-test --bug, /sl-test --perf, /sl-test --report 형식으로 호출.
triggers:
  - /sl-test
---

# /sl-test — 테스트 자동화

## 호출 형식

| 형식 | 용도 |
|------|------|
| `/sl-test` | TC 작성 → 테스트 실행 → TR 생성 전체 파이프라인 |
| `/sl-test --bug` | 실패 TC → Jira Bug 이슈 자동 등록 |
| `/sl-test --perf` | 성능 테스트 (SRS 비기능 기준 검증) |
| `/sl-test --report` | TR을 Confluence에 게시 (오픈망) |

## 실행 전 확인

```python
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import os
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
fm = 'docs/00_FUNC/FUNC_MAP.md'
print(f'FUNC_MAP: {\"존재\" if os.path.exists(fm) else \"없음 — /sl-recon 먼저 실행\"}')
tc = 'docs/07_테스트케이스'
print(f'TC 디렉토리: {\"존재\" if os.path.isdir(tc) else \"없음 (신규 생성 예정)\"}')
"
```

## 기본 실행 (`/sl-test`)

test-agent에 위임한다:

> test-agent에게:
> - FUNC_MAP.md의 FUNC-ID 목록을 기반으로 TC를 작성하고, 테스트를 실행하여 TR을 생성하라. TC-ID는 `TC-FUNC-{domain}-{NNN}` 형식 사용.
> - 실패한 TC는 목록으로 정리하라.

테스트 실행 (언어 자동 감지):

```python
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import os, sys, subprocess
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
script = os.path.join(plugin, 'scripts', 'run_tests.py') if plugin else ''
if script and os.path.exists(script):
    r = subprocess.run([sys.executable, script, '.'])
    sys.exit(r.returncode)
else:
    print('run_tests.py 없음 — PLUGIN_PATH 확인')
"
```

## 버그 등록 (`/sl-test --bug`)

```python
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import os
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8') if '=' in l and not l.startswith('#'))
print('NETWORK=' + env.get('NETWORK','closed'))
"
```

NETWORK=open인 경우 Jira MCP를 통해 Bug 이슈를 자동 등록한다:
- 심각도: TR에서 Critical/High/Medium/Low 자동 분류
- 재현 절차: TC 단계를 그대로 사용

NETWORK=closed인 경우 `docs/08_테스트결과보고서/bugs_{날짜}.md`에 로컬 저장한다.

## 성능 테스트 (`/sl-test --perf`)

```python
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');print('비기능 요구사항 소스: docs/03_기능명세서/SRS_v1.0.md 비기능 섹션')"
```

SRS/기능명세서의 비기능 요구사항에서 성능 기준을 추출하여 테스트 시나리오를 작성한다:
- 응답시간 기준 / TPS(초당 처리량) 기준 / 동시 사용자 수 기준

결과를 `docs/08_테스트결과보고서/Perf_v1.0.md`에 저장한다.

## 보고서 게시 (`/sl-test --report`)

NETWORK=open인 경우 Confluence MCP를 통해 TR을 페이지로 자동 생성한다.

## 완료 후 처리

FUNC_MAP.md 테스트 결과 컬럼 업데이트  
다음 단계: 배포 또는 납품
