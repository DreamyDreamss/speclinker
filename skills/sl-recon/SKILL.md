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
!python -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
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
!python -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
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
!python -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
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
!python -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
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
!python -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
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
!python -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
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
!python -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');import json; d=json.load(open('docs/05_설계서/_domain_plan.json')); [print(f'  도메인: {x[\"name\"]}') for x in d['domains']]; print(f'총 {len(d[\"domains\"])}개 도메인')"
```

**spec-agent 실행 후 — 백업된 screens[] 복원 (재실행 시 BFS 결과 보호)**

```bash
!python -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
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
!python -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
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
!python -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
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

## STEP 4 — INF 생성은 `/sl-recon-inf`로 분리됨

> 도메인 확정(STEP 3)이 끝났다. **INF 명세 생성은 `/sl-recon-inf`가 전담**한다
> (router_inventory census — call chain — dispatch — BAT). 소스에 엔드포인트가 추가/변경되면
> `/sl-recon-inf`만 단독 재실행해 INF 대상 census(`.speclinker/inf_targets.json`)와 INF 명세를 현행화한다.

```
/sl-recon-inf
```

> 단계 순서: `/sl-recon`(도메인 확정) — **`/sl-recon-inf`(INF)** — `/sl-recon-sch`(SCH) —
> `/sl-recon-uis`(화면) — `/sl-recon-doc`(FUNC/SRS). 각 단계는 독립 재실행 가능
> (SpecLens [🔄 재생성] 버튼은 스펙 1개 단위 재생성).

도메인 확정 체크포인트를 저장한다.

```bash
!python -c "import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');
import json, os, datetime
os.makedirs('_tmp', exist_ok=True)
json.dump({'phase':'recon-domain','completed_at':datetime.datetime.now().isoformat(),'status':'ok'},
          open('_tmp/recon_checkpoint.json','w'), ensure_ascii=False, indent=2)
print('도메인 확정 완료 — _tmp/recon_checkpoint.json')
print()
print('다음 커맨드: /sl-recon-inf  (INF 명세 생성)')
"
```
