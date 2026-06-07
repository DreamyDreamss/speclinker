---
name: sl-recon
description: RECON 모드 전용 — 기존 소스코드를 UA로 역분석하여 ASIS/SAD/SRS 산출물을 생성. 코드는 있지만 설계서가 없을 때 실행.
triggers:
  - /sl-recon
---

# /sl-recon — 코드 역분석

기존 소스코드에서 설계 산출물(INF/SCH/UIS/FUNC)을 역방향으로 추출합니다.

## 실행 전 확인

```bash
!cat project.env
```

`project.env`가 없으면 `/sl-init`을 먼저 실행하도록 안내한다.

---

## STEP 0 — MCP 연결 상태 확인

`project.env`의 MCP 플래그(`true`=사용 의도)를 읽어 **매번 재시도**한다.  
결과는 `_tmp/mcp_status.json`에만 저장하고 **`project.env`는 절대 수정하지 않는다.**

> **설계 원칙**: `project.env` MCP 플래그 = 사용자 설정(의도).  
> 런타임 결과로 덮어쓰면 자격증명 채운 뒤 재실행해도 영원히 false로 고정됨.  
> 따라서 매 실행마다 `true`인 항목은 항상 재시도한다.

```bash
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
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
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
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
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
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
    print(f'  대상 도메인 (DOMAINS): {poc_domains if poc_domains else \"plan 전체\"}')
    print(f'  UA 분석 스킵: {poc_skip_ua}')
    print(f'  도메인별 파일 제한: {poc_limit if poc_limit else \"제한 없음\"}')
    print('━' * 50)
else:
    print('일반 모드 — 전체 소스 분석')
"
```

---

## STEP 1 — 소스 구조 스캔 (scan_source.js)

> **POC 가드**: `POC_SKIP_UA=true`이면 이 단계를 스킵하고 기존 `_tmp/source_index.json` 재사용.

> 📌 **v2.39**: UA 4-에이전트 파이프라인 → `scan_source.js` 어노테이션 기반 스캔으로 교체.  
> LLM 호출 없음, 토큰 비용 없음. Controller/Service/DAO/Batch 타입 + form/api route kind 자동 분류.

```bash
!python -c "
import os, sys, subprocess, json

try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except: pass

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))

skip = env.get('POC_SKIP_UA', 'false').lower() == 'true'
if skip:
    idx_path = '_tmp/source_index.json'
    if os.path.exists(idx_path):
        data = json.load(open(idx_path, encoding='utf-8'))
        print('POC_SKIP_UA=true — STEP 1 스킵 (기존 source_index 재사용)')
        print('  파일:', len(data.get('files', [])), '개')
        skip = True
    else:
        print('POC_SKIP_UA=true이지만 source_index.json 없음 → STEP 1 강제 실행')
        skip = False

if not skip:
    plugin = env.get('PLUGIN_PATH', '')
    script = os.path.join(plugin, 'scripts', 'scan_source.js') if plugin else ''
    if not (script and os.path.exists(script)):
        print('[ERROR] scan_source.js 없음 (PLUGIN_PATH 확인)'); sys.exit(1)

    r = subprocess.run(
        ['node', script, '--workspace=.'],
        capture_output=True, text=True, encoding='utf-8', errors='replace'
    )
    if r.stdout: print(r.stdout)
    if r.returncode != 0:
        print('[ERROR]', (r.stderr or '')[:500]); sys.exit(1)

    idx_path = '_tmp/source_index.json'
    if os.path.exists(idx_path):
        data = json.load(open(idx_path, encoding='utf-8'))
        files = data.get('files', [])
        stats = data.get('typeStats', {})
        print()
        print('=== 소스 스캔 완료 ===')
        print(f'  전체 파일: {len(files)}개')
        for t, cnt in sorted(stats.items()):
            print(f'  {t}: {cnt}개')
        print('_tmp/source_index.json 저장됨')
"
```

### STEP 1 출력 예시 — `_tmp/source_index.json`

> tree-sitter 파서 사용 시 (Java `@RestController`, Python FastAPI, NestJS `@Controller`) 아래 구조로 출력된다.  
> regex fallback도 동일 스키마를 반환하므로 후속 단계에서 구분 불필요.

```json
{
  "scannedAt": "2026-06-01T09:00:00.000Z",
  "workspace": "/home/user/nkshop-bos-admin",
  "contextPath": "/adm",
  "langStats": { "java": 142, "typescript": 4, "python": 0 },
  "typeStats": { "controller": 18, "service": 34, "dao": 41, "batch": 5, "other": 44 },
  "files": [
    {
      "filePath": "/home/user/nkshop-bos-admin/src/main/java/com/nkshop/controller/order/OrderController.java",
      "relPath": "src/main/java/com/nkshop/controller/order/OrderController.java",
      "sourceLabel": "src",
      "lang": "java",
      "package": "com.nkshop.controller.order",
      "className": "OrderController",
      "type": "controller",
      "annotations": ["@Controller", "@RequestMapping"],
      "routes": [
        { "method": "GET",  "path": "/adm/order/list",       "handlerMethod": "orderList",   "kind": "form" },
        { "method": "POST", "path": "/adm/order/listAjax",   "handlerMethod": "listAjax",    "kind": "api"  },
        { "method": "POST", "path": "/adm/order/saveStatus", "handlerMethod": "saveStatus",  "kind": "api"  }
      ],
      "imports": [
        "com.nkshop.service.order.OrderService",
        "org.springframework.web.bind.annotation.RequestMapping"
      ],
      "injected": ["OrderService"]
    },
    {
      "filePath": "/home/user/nkshop-bos-admin/src/main/java/com/nkshop/service/order/OrderService.java",
      "relPath": "src/main/java/com/nkshop/service/order/OrderService.java",
      "sourceLabel": "src",
      "lang": "java",
      "package": "com.nkshop.service.order",
      "className": "OrderService",
      "type": "service",
      "annotations": ["@Service"],
      "routes": [],
      "imports": ["com.nkshop.dao.order.OrderMapper"],
      "injected": ["OrderMapper"]
    },
    {
      "filePath": "/home/user/nkshop-bos-admin/src/main/java/com/nkshop/dao/order/OrderMapper.java",
      "relPath": "src/main/java/com/nkshop/dao/order/OrderMapper.java",
      "sourceLabel": "src",
      "lang": "java",
      "package": "com.nkshop.dao.order",
      "className": "OrderMapper",
      "type": "dao",
      "annotations": ["@Mapper"],
      "routes": [],
      "imports": [],
      "injected": []
    }
  ]
}
```

**핵심 필드 설명:**

| 필드 | 설명 |
|------|------|
| `contextPath` | web.xml·application.properties 등에서 자동 감지된 서블릿 컨텍스트 경로. 전체 route에 prepend됨 |
| `type` | `controller` / `service` / `dao` / `batch` / `other` — 어노테이션 + 파일명 패턴으로 결정 |
| `routes[].kind` | `form` = ModelAndView 뷰 반환, `api` = JSON 응답 (`@ResponseBody` 또는 메서드 바디 시그널 탐지) |
| `routes[].path` | contextPath + classMapping + methodMapping 결합 후 `/+` 정규화 완료 |
| `injected` | `@Autowired` 필드 + 생성자 파라미터 타입 — STEP 2 도메인 의존성 분석에 사용 |

---

## STEP 1.7 — 처리 도메인 선택 (카탈로그 기반)

> `_tmp/domain_catalog.json`(sl-init Step 5.5 또는 아래에서 생성)을 읽어 도메인 목록을 제시한다.
> 수천 개 INF 프로젝트에서 전체를 한 번에 처리하지 않고 도메인 단위로 선택 처리하기 위함이다.
> 도메인 분류는 relPath 디렉토리 기반(스택 무관 — Java/Next.js 동일).

**카탈로그 로드/생성 + 도메인 목록 출력:**

```bash
!python -c "
import os, sys, subprocess, json
try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except: pass

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
cat_path = '_tmp/domain_catalog.json'

# 카탈로그 없으면 즉석 생성 (sl-init Step 5.5를 건너뛴 경우)
if not os.path.exists(cat_path):
    catpy = os.path.join(plugin, 'scripts', 'build_domain_catalog.py') if plugin else ''
    if catpy and os.path.exists(catpy) and os.path.exists('_tmp/source_index.json'):
        subprocess.run([sys.executable, catpy, '_tmp/source_index.json', cat_path],
                       capture_output=True, text=True)

if not os.path.exists(cat_path):
    print('[WARN] domain_catalog.json 없음 — 전체 도메인 처리로 진행')
    sys.exit(0)

cat = json.load(open(cat_path, encoding='utf-8'))
domains = cat.get('domains', [])
poc_domains = [d.strip() for d in env.get('POC_DOMAINS','').split(',') if d.strip()]

print('=' * 64)
print('처리할 도메인을 선택하세요 (relPath 기반 분류, stack=' + cat.get('stack','?') + ')')
print('=' * 64)
print('  공통 prefix: ' + cat.get('common_prefix',''))
print()
print('  #  도메인'.ljust(26) + 'files   form    api')
print('  ' + '-' * 50)
for i, d in enumerate(domains, 1):
    mark = ' *' if d['name'] in poc_domains else '  '
    print(mark + str(i).rjust(2) + '. ' + d['name'].ljust(18)
          + str(d.get('files',0)).rjust(6) + '  ' + str(d.get('forms',0)).rjust(5)
          + '  ' + str(d.get('apis',0)).rjust(5))
print()
total_f = sum(d.get('files',0) for d in domains)
total_form = sum(d.get('forms',0) for d in domains)
print('  전체: 도메인 ' + str(len(domains)) + '개 / 엔트리 ' + str(total_f)
      + '개 / form 화면 ' + str(total_form) + '개')
print()
if poc_domains:
    print('  현재 POC_DOMAINS = ' + str(poc_domains) + ' (* 표시)')
print()
print('[선택 방법]')
print('  특정 도메인: \"product, order\" (쉼표 구분)')
print('  전체 처리:   \"전체\"')
"
```

**사용자 선택 처리:**

사용자가 도메인명(쉼표 구분) 또는 "전체"를 입력하면 `project.env`의 `POC_MODE`/`POC_DOMAINS`를 갱신한다 (Edit 도구):

- 특정 도메인 선택 시: `POC_MODE=true`, `POC_DOMAINS={선택값}` 으로 수정
- "전체" 선택 시: `POC_MODE=false` 로 두고 진행

> POC_DOMAINS를 설정하면 기존 STEP 2-2(도메인 필터), STEP 4(INF 생성)가 자동으로 선택 도메인만 처리한다.
> **단, domain_catalog의 도메인명(relPath 기반)과 _domain_plan.json의 도메인명(spec-agent 생성)이 다를 수 있다.**
> STEP 3 도메인 검토에서 최종 확인한다.

> **확인 전 STEP 1.5 진행 금지.**

---

## STEP 1.5 — 프로젝트 Profile 생성·로드

`.speclinker/profile.yaml`이 있으면 그대로 로드, 없으면 `profile-agent`를 호출해 초안 생성.  
**Profile은 영구 저장**이고 confirm 되지 않은 상태에서는 사용자에게 검수를 요청한다.

```bash
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
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
    source_index: _tmp/source_index.json
    기존 profile.yaml: 없음 (또는 --reprofile 옵션으로 갱신 요청)

    참고 schema: 플러그인 templates/profile_schema.yaml

    완료 후:
    - .speclinker/profile.yaml 생성
    - 사용자 confirm 요청 메시지 출력
    - confirmed_by/confirmed_at 은 빈 문자열로 둘 것 (사람이 채움)
```

profile-agent 완료 후 **사용자에게 confirm 요청**을 명확히 보여준다. confirm 전까지 경고만 출력하고 다음 STEP 진행은 허용한다.

---

## STEP 2 — Phase-A: SAD + 도메인 목록 확정

### STEP 2-0: 소스 인덱스 압축 (spec-agent 입력용)

`source_index.json`에서 도메인 분류에 필요한 패키지 구조·타입 통계만 추출해  
`_tmp/kg_summary.json`을 생성한다 (spec-agent 입력 형식 호환 유지).

```bash
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import json, os

idx = json.load(open('_tmp/source_index.json', encoding='utf-8'))
files = idx.get('files', [])

# 패키지 상위 경로 추출 (도메인 경계 힌트)
pkg_set = set()
for f in files:
    pkg = f.get('package', '')
    if pkg:
        parts = pkg.rsplit('.', 1)
        pkg_set.add(parts[0] if len(parts) > 1 else pkg)
packages = sorted(pkg_set)[:60]

# 타입별 파일 샘플 (최대 30개)
by_type = {}
for t in ('controller', 'service', 'dao', 'batch', 'other'):
    by_type[t] = [
        {'filePath': f['relPath'], 'package': f.get('package',''), 'className': f.get('className','')}
        for f in files if f.get('type') == t
    ][:30]

summary = {
    'project':   {'name': os.path.basename(os.getcwd())},
    'langStats': idx.get('langStats', {}),
    'typeStats': idx.get('typeStats', {}),
    'packages':  packages,
    'byType':    by_type,
}

os.makedirs('_tmp', exist_ok=True)
json.dump(summary, open('_tmp/kg_summary.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(f'압축 완료: {len(files)}파일 → 도메인 분류용 요약 (packages {len(packages)}개, byType 샘플 포함)')
"
```

### STEP 2-1: spec-agent로 도메인 확정

`agents/spec-agent.md`를 서브에이전트로 실행한다.  
**RECON 모드에서는 `model: claude-sonnet-4-6` 으로 호출한다** (Opus 다운그레이드 — 도메인 분류는 단순 분류 작업).

**spec-agent 실행 전 — 기존 screens[] 백업 (재실행 시 BFS 결과 소실 방지)**

```bash
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import json, os

plan_path = 'docs/05_설계서/_domain_plan.json'
if os.path.exists(plan_path):
    plan = json.load(open(plan_path, encoding='utf-8'))
    screens_backup = {
        d['name']: d.get('screens', [])
        for d in plan.get('domains', [])
        if d.get('screens')
    }
    if screens_backup:
        os.makedirs('_tmp', exist_ok=True)
        json.dump(screens_backup, open('_tmp/_screens_backup.json', 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=2)
        total = sum(len(v) for v in screens_backup.values())
        print(f'[백업] 기존 screens[] 보존: {len(screens_backup)}개 도메인, {total}개 화면')
    else:
        print('[백업] 기존 screens[] 없음 — 백업 불필요')
"
```

```
Agent 도구 호출:
  subagent_type: "speclinker:spec-agent"
  model: "sonnet"
  description: "Phase-A: 도메인 확정 + SAD 생성"
  prompt: |
    Phase-A 실행:
    `_tmp/kg_summary.json`(소스 스캔 요약 — 패키지 구조·타입별 파일 목록)을 분석하여
    SAD(`docs/04_아키텍처설계서/SAD_v1.0.md`)와 도메인 계획(`docs/05_설계서/_domain_plan.json`)을 생성하라.
    도메인 수는 4~8개, 각 도메인에 2~4자 영문 대문자 code(예: BRD, ORD, PRD)와 rootPaths를 배정하라.
    ID 범위 사전 배정 불필요 — 실제 생성 시 도메인별 디렉토리 스캔으로 자동 채번한다.
    rootPaths는 byType.controller[].filePath의 공통 상위 경로로 추론하라.
    ⚠️ knowledge-graph.json은 없으므로 읽지 말 것 — kg_summary.json만 사용한다.
```

```bash
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');import json; d=json.load(open('docs/05_설계서/_domain_plan.json')); [print(f'  도메인: {x[\"name\"]}') for x in d['domains']]; print(f'총 {len(d[\"domains\"])}개 도메인')"
```

**spec-agent 실행 후 — 백업된 screens[] 복원 (재실행 시 BFS 결과 보호)**

```bash
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import json, os

backup_path = '_tmp/_screens_backup.json'
plan_path   = 'docs/05_설계서/_domain_plan.json'
if not os.path.exists(backup_path):
    print('[복원] 백업 없음 — 건너뜀')
else:
    screens_backup = json.load(open(backup_path, encoding='utf-8'))
    plan = json.load(open(plan_path, encoding='utf-8'))
    restored = 0
    for d in plan.get('domains', []):
        name = d['name']
        if name in screens_backup and screens_backup[name]:
            d['screens'] = screens_backup[name]
            restored += 1
    json.dump(plan, open(plan_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'[복원] screens[] 복원: {restored}개 도메인 (spec-agent 재실행으로 인한 소실 방지)')
"
```

### STEP 2-2: POC 도메인 필터 자동 적용 (POC_DOMAINS 설정 시)

```bash
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import json, os
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
poc_mode    = env.get('POC_MODE', 'false').lower() == 'true'
poc_domains = [d.strip() for d in env.get('POC_DOMAINS','').split(',') if d.strip()]
if not poc_mode:
    print('POC 도메인 필터 비활성화 — 전체 도메인 처리')
elif not poc_domains:
    print('POC_MODE=true이나 POC_DOMAINS 미설정 — 전체 도메인 처리')
    print('  힌트: POC_DOMAINS=product,order 를 project.env에 추가')
else:
    plan_path = 'docs/05_설계서/_domain_plan.json'
    plan = json.load(open(plan_path, encoding='utf-8'))
    full = plan['domains']
    kept = [d for d in full if d['name'] in poc_domains]
    skipped = [d['name'] for d in full if d['name'] not in poc_domains]
    if not kept:
        print(f'⚠️  POC_DOMAINS={poc_domains} 와 일치하는 도메인 없음 — plan 전체 유지')
    else:
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

> **POC 모드 (POC_DOMAINS 설정 시)**: 도메인 목록을 출력하되 사람 확인 없이 자동 진행한다.

```bash
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import json, os
env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
poc_mode    = env.get('POC_MODE','false').lower() == 'true'
poc_domains = [d.strip() for d in env.get('POC_DOMAINS','').split(',') if d.strip()]

plan = json.load(open('docs/05_설계서/_domain_plan.json', encoding='utf-8'))
poc_flag = plan.get('_poc',{}).get('enabled', False)

print(f'프로젝트: {plan[\"project\"]}')
if poc_flag:
    print(f'🧪 POC 필터 적용됨 (POC_DOMAINS={poc_domains})')
print()
print('처리 대상 도메인:')
print()
for i, d in enumerate(plan['domains'], 1):
    code = d.get('code', '???')
    print(f'  {i}. {d[\"name\"]:15} [{code}]  {d[\"description\"][:40]}')
    print(f'       INF-{code}-001  SCH-{code}-001  UIS-{code}-001  ...')
print(f'\n총 {len(plan[\"domains\"])}개 도메인')

if poc_mode and poc_domains:
    print()
    print('POC 모드 — STEP 3 자동 확인. STEP 4로 진행합니다.')
else:
    print()
    print('코드명이 잘못됐으면 지금 수정하세요 (예: "방송관리 코드를 BCD로 변경")')
    print('수정 없으면 "계속"')
"
```

**일반 모드**: 수정 없으면 "계속", 수정 필요하면 변경 내용 입력 받아 `_domain_plan.json` 수정 후 진행.  
**POC 모드**: 위 스크립트가 자동 진행 메시지를 출력한 직후 STEP 4로 이동.  
**확인(또는 자동 진행) 전 STEP 4 절대 진행 금지.**

---

## STEP 4 — router_inventory 생성 + INF 명세 작성

> `source_index.json`의 routes에서 `kind: "api"`만 INF 후보로 사용.  
> `kind: "form"` routes는 `_tmp/screen_inventory_static.json`으로 분리 → `/sl-recon-uis` static fallback.

### STEP 4-1: router_inventory 생성 (api routes only)

```bash
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
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
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
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
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
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
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
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
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
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

## STEP 5 — SCH 명세 생성 (ddd-db-agent)

> `resolve_call_chain.py`가 생성한 `_tmp/sch_draft/` + INF 파일의 `tables:` frontmatter를 기반으로  
> 도메인별 DB 스키마(SCH)를 생성한다.

```bash
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import json, os
plan = json.load(open('docs/05_설계서/_domain_plan.json'))
sch_draft_dir = '_tmp/sch_draft'
domains_with_draft = []
if os.path.exists(sch_draft_dir):
    for d in plan['domains']:
        domain_draft = os.path.join(sch_draft_dir, d['name'])
        if os.path.isdir(domain_draft):
            tables = os.listdir(domain_draft)
            domains_with_draft.append((d['name'], len(tables)))
if domains_with_draft:
    print('SCH 초안 (sch_draft):')
    for name, cnt in domains_with_draft:
        print(f'  {name}: 테이블 {cnt}개')
else:
    print('sch_draft 없음 — ddd-db-agent가 INF tables: frontmatter + SQL 직접 분석')
print()
print(f'처리 도메인: {len(plan[\"domains\"])}개')
"
```

### STEP 5-0: SCH 스킵 판정 (idempotency)

도메인별로 **기대 테이블(INF `tables:` 합집합) 대비 이미 생성된 SCH(frontmatter `table:`)**를 비교해, 누락 테이블이 없는 도메인은 스킵하고 **생성 대상만 `_tmp/sch_todo.json`에 기록**한다. (INF의 `group_already_done`과 동형 — recon 재실행 안전)

```bash
!python "{PLUGIN_PATH}/scripts/build_sch_todo.py" .
```

> 누락 테이블이 0인 도메인은 스킵된다(sch_todo.json에서 제외). 부분 생성 도메인은 `existing`을 넘겨 **누락분만** 생성한다.

### STEP 5-0.5: 쿼리 패턴 채굴 (zero-token — JIT 기계 레이어)

소스 SQL/XML에서 **관찰된 조인쌍 + 상시 필터 관례**(`scan_query_patterns.py`)와 **코드값 리터럴**(`scan_code_literals.py`)을
`docs/05_설계서/_machine/`(영속)에 추출한다. build_sch_static이 이를 읽어 SCH의 `### 관계`·`🔧 쿼리 작성 가이드`를 채우고,
AIDD/JIT는 이 JSON을 **마크다운 재파싱 없이 직접 소비**한다. (조인 정확성·상시필터 = 소스에만 존재하는 사실 → 카탈로그로는 불가)

```bash
!python "{PLUGIN_PATH}/scripts/scan_query_patterns.py" . --out docs/05_설계서/_machine/query_patterns.json
!python "{PLUGIN_PATH}/scripts/scan_code_literals.py" . --out docs/05_설계서/_machine/code_literals.json
```

> 레거시 DB는 FK 미선언이 흔해 `*_get_foreign_keys`가 비어 나온다 — 이때 **관찰 조인이 유일한 JOIN 근거**다.
> 무소스/무쿼리면 빈 JSON(graceful) — build_sch_static은 관찰 섹션을 생략한다.

### STEP 5-A: 정적 스켈레톤 생성 (build_sch_static.py — zero-token)

사실(컬럼·타입·키·인덱스·FK·관찰조인·상시필터·mini-ERD·크로스링크·도메인개요·전역색인)을 **스크립트로** 생성한다. LLM 토큰 0.
의미 섹션(코드값·비즈니스 주의사항·컬럼 한글설명·상시필터 의미)은 `<!-- LLM-TODO -->` 마커로 남긴다.

```bash
!python "{PLUGIN_PATH}/scripts/build_sch_static.py" .
```

> **컬럼 타입 권위 순위**: DB 드라이버(project.env `DB_TYPE`/`DB_HOST`/…) > `CREATE TABLE`(*.sql) > ORM > sch_draft(이름만).
> 무DB·무DDL이면 컬럼명 스켈레톤 + 타입칸 `<!-- LLM-TODO -->`. 산출물: 개별 `SCH-{CODE}-NNN.md` + `DB_{도메인}.md` + `DB_Schema.md` + `_tmp/sch_enrich_todo.json`(의미보강 필요 도메인).
> 기존 SCH는 재생성하지 않고 채번을 이어간다(멱등). 3NF 검증 결과·통과 여부는 작성하지 않는다.

### STEP 5-B: 의미 enrichment 디스패치 (dispatch_sch_gen.py)

코드성 컬럼/INF 비즈규칙이 있어 보강이 필요한 도메인(`_tmp/sch_enrich_todo.json`)만,
`ddd-db-agent`(enrichment 모드)를 **서브프로세스로 병렬 호출**해 `<!-- LLM-TODO -->`만 채운다.
사실 섹션은 건드리지 않으며, 메인 컨텍스트에 SCH 본문이 쌓이지 않는다(컨텍스트 격리).

```bash
!python "{PLUGIN_PATH}/scripts/dispatch_sch_gen.py" .
```

> exit 0 = 완료(또는 enrichment 대상 없음 — 전부 정적으로 충분).
> exit 1이면 `_tmp/sch_dispatch_status.json`의 `failed` 확인 후 재실행 — 완료 도메인은 자동 스킵.

---

### STEP 5-1: INF → SCH 링크 패치 (link_inf_sch_new.py)

ddd-db-agent 완료 후, INF 파일의 `## 참조 테이블` 셀 `[TBD]`를 `[[SCH-{CODE}-NNN]]` 링크로 교체한다.  
LLM 재호출 없이 스크립트가 `{도메인}/SCH/SCH-*.md` frontmatter를 읽어 테이블명↔SCH-ID를 매칭 — 토큰 절약.  
**이 패치가 뷰어 INF→SCH 네비게이션(`goToId`/크로스링크)의 근거다.**

```bash
!python "{PLUGIN_PATH}/scripts/link_inf_sch_new.py" .
```

---

## STEP 6 — 완료 체크포인트 + 다음 단계 안내

INF/SCH 생성이 끝났습니다. 체크포인트를 저장하고 `/sl-recon-uis`로 이동합니다.

> UIS(화면 설계서)는 `/sl-recon-uis`가 전담합니다.  
> `PREVIEW_BASE_URL`이 설정되어 있으면 BFS 브라우저 탐색, 없으면 `screen_inventory_static.json` 기반 정적 분석으로 자동 분기합니다.

```bash
!python3 -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import json, os, datetime
os.makedirs('_tmp', exist_ok=True)
json.dump({
    'phase': 'recon-analysis',
    'completed_at': datetime.datetime.now().isoformat(),
    'status': 'ok'
}, open('_tmp/recon_checkpoint.json', 'w'), ensure_ascii=False, indent=2)
print('체크포인트 저장 완료 → _tmp/recon_checkpoint.json')
print()
print('다음 커맨드: /sl-recon-uis')
print('  PREVIEW_BASE_URL 설정됨 → BFS 브라우저 탐색 (정확)')
print('  PREVIEW_BASE_URL 없음   → screen_inventory_static.json 정적 fallback (자동)')
"
```
