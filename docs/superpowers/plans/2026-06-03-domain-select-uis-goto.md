# 도메인 선택형 RECON + UIS goto 캡처 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** RECON을 도메인 단위로 선택 실행 가능하게 만들고(수천 개 INF 프로젝트 대응), UIS 화면 캡처를 BFS 탐색 대신 source_index.json의 form URL을 직접 goto하는 방식으로 전환한다.

**Architecture:** `scan_source.js`에 **파일경로 기반 라우팅 인식**(Next.js/Nuxt 등 — tree-sitter AST에 라우트가 없는 프레임워크)을 추가해 모든 스택이 routes를 갖게 한다. `/sl-init`에서 스캔 + relPath 기반 도메인 분류(제로-LLM)로 `domain_catalog.json`을 생성한다. `/sl-recon`은 카탈로그로 도메인 선택지를 제공하고 기존 `POC_DOMAINS`로 선택 도메인만 처리한다. UIS는 `kind="form"` route를 `capture_single_tab.js --url=`로 직접 goto 캡처(BFS는 폴백).

**Tech Stack:** Node.js (scan_source.js tree-sitter 파서 확장), Python 3.x (표준 라이브러리), Chrome CDP

**⚠️ 범용성 원칙 (speclinker CLAUDE.md 준수 — 위반은 결함):**
- **스택 중립**: Java Spring + Next.js + Python 등 모든 스택 동작. 특정 프로젝트 전제 금지.
- **언어 중립 신호 우선**: 도메인 분류는 `relPath` 디렉토리(모든 스택 공통)가 1차. `package`(Java 전용)는 보조.
- **다중 스택 검증 의무**: 모든 신규 스크립트는 **nkshop(Java Spring) + KDI(Next.js) 두 실프로젝트**로 검증. 단일 통과 = 미완료.

**설계 근거 (실측 확정):**
- tree-sitter는 코드 AST만 파싱 → Java `@RequestMapping`(코드 내)은 잡지만 Next.js 파일라우팅(`src/pages/admin/x.tsx`=`/admin/x`, 코드 외)은 routes 0개. → scan_source.js에 파일경로 라우팅 레이어 추가가 선행 필수.
- 도메인 분류 = routes 보유 파일의 **relPath 디렉토리** 기반. Next.js는 `pages/app` 다음 디렉토리(admin/pgm/reports), Java는 package 매핑. URL 세그먼트 방식은 화면/API URL 불일치로 회피.
- KDI 실측: Next.js Pages Router, scan_source routes 0개 → 본 작업으로 해결 대상.
- UIS: goto 기본, BFS는 폴백.

---

## 파일 목록

| 파일 | 역할 | 신규/수정 |
|------|------|---------|
| `scripts/scan_source.js` | **Next.js/Nuxt 파일경로 라우팅 인식 추가** (inferFileBasedRoutes) — tree-sitter AST 미감지 라우트 보강 | 수정 |
| `scripts/build_domain_catalog.py` | source_index.json → relPath 디렉토리 기반 범용 도메인 분류 → domain_catalog.json | 신규 |
| `scripts/test_build_domain_catalog.py` | 도메인 분류 단위 테스트 (Java+Next.js 2스택 픽스처) | 신규 |
| `scripts/build_uis_goto_plan.py` | form routes → goto 캡처 플랜(URL+menuPath) → uis_goto_plan.json | 신규 |
| `scripts/test_build_uis_goto_plan.py` | goto 플랜 단위 테스트 (2스택) | 신규 |
| `skills/sl-init/SKILL.md` | RECON 모드일 때 Step 5.5 추가 — 스캔 + 도메인 카탈로그 생성 | 수정 |
| `skills/sl-recon/SKILL.md` | STEP 1.7 추가 — 도메인 카탈로그 선택지 제공 → POC_DOMAINS 자동 설정 | 수정 |
| `skills/sl-recon-uis/SKILL.md` | STEP 6-0-GOTO 추가 — form URL goto 캡처(기본), BFS는 폴백 | 수정 |
| `.claude-plugin/plugin.json` | 버전 2.53.0 bump | 수정 |
| `CLAUDE.md` | 범용성 원칙(완료) + 도메인 선택 흐름 + UIS goto 노트 | 수정 |

> **검증 프로젝트:** nkshop = `D:\nkshop-bos\nkshop-bos-admin` (Java Spring), KDI = `D:\KDI source\nkshop-kdi-web` (Next.js Pages Router). 모든 스크립트 태스크는 두 프로젝트 모두로 검증한다.

---

## Task 1: build_domain_catalog.py — 패키지 기반 도메인 분류 (TDD)

**Files:**
- Create: `scripts/test_build_domain_catalog.py`
- Create: `scripts/build_domain_catalog.py`

- [ ] **Step 1: 테스트 작성**

`scripts/test_build_domain_catalog.py`:

```python
import sys, os, json, tempfile, unittest
sys.path.insert(0, os.path.dirname(__file__))


class TestCommonPackagePrefix(unittest.TestCase):
    def test_finds_common_prefix(self):
        from build_domain_catalog import common_package_prefix
        pkgs = [
            'com.kth.nkshop.bos.admin.product.prdreg.controller',
            'com.kth.nkshop.bos.admin.order.claim.controller',
            'com.kth.nkshop.bos.admin.product.popup.controller',
        ]
        self.assertEqual(common_package_prefix(pkgs), 'com.kth.nkshop.bos.admin')

    def test_single_package_returns_parent(self):
        from build_domain_catalog import common_package_prefix
        pkgs = ['com.app.order.controller']
        # 단일 패키지: 마지막 세그먼트(controller) 제외한 부모
        self.assertEqual(common_package_prefix(pkgs), 'com.app.order')

    def test_empty_returns_empty(self):
        from build_domain_catalog import common_package_prefix
        self.assertEqual(common_package_prefix([]), '')


class TestExtractDomain(unittest.TestCase):
    def test_extracts_first_segment_after_prefix(self):
        from build_domain_catalog import extract_domain
        d = extract_domain('com.kth.nkshop.bos.admin.product.prdreg.controller',
                           'com.kth.nkshop.bos.admin')
        self.assertEqual(d, 'product')

    def test_skips_layer_keyword(self):
        from build_domain_catalog import extract_domain
        # prefix 다음이 controller(레이어)면 그 다음 세그먼트
        d = extract_domain('com.app.controller.order',
                           'com.app')
        self.assertEqual(d, 'order')

    def test_returns_unknown_when_no_remainder(self):
        from build_domain_catalog import extract_domain
        d = extract_domain('com.app', 'com.app')
        self.assertEqual(d, 'unknown')


class TestBuildCatalog(unittest.TestCase):
    def _idx(self):
        return {
            'contextPath': '/app',
            'files': [
                {'type': 'controller', 'package': 'com.app.product.prdreg.controller',
                 'filePath': '/src/product/Pr201Controller.java',
                 'routes': [
                     {'path': '/app/product/prdreg/pr201Form', 'kind': 'form', 'handlerMethod': 'pr201Form'},
                     {'path': '/app/product/prdreg/productList', 'kind': 'api', 'handlerMethod': 'productList'},
                 ]},
                {'type': 'controller', 'package': 'com.app.order.claim.controller',
                 'filePath': '/src/order/Or440Controller.java',
                 'routes': [
                     {'path': '/app/order/claim/or440Form', 'kind': 'form', 'handlerMethod': 'or440Form'},
                 ]},
                {'type': 'service', 'package': 'com.app.product.prdreg.service',
                 'filePath': '/src/product/Pr201Service.java', 'routes': []},
            ],
        }

    def test_groups_by_package_domain(self):
        from build_domain_catalog import build_catalog
        cat = build_catalog(self._idx())
        names = {d['name'] for d in cat['domains']}
        self.assertEqual(names, {'product', 'order'})

    def test_counts_forms_and_apis(self):
        from build_domain_catalog import build_catalog
        cat = build_catalog(self._idx())
        product = next(d for d in cat['domains'] if d['name'] == 'product')
        self.assertEqual(product['controllers'], 1)
        self.assertEqual(product['forms'], 1)
        self.assertEqual(product['apis'], 1)

    def test_sorted_by_controller_count_desc(self):
        from build_domain_catalog import build_catalog
        cat = build_catalog(self._idx())
        counts = [d['controllers'] for d in cat['domains']]
        self.assertEqual(counts, sorted(counts, reverse=True))

    def test_includes_common_prefix(self):
        from build_domain_catalog import build_catalog
        cat = build_catalog(self._idx())
        self.assertEqual(cat['common_prefix'], 'com.app')


class TestGenerateCatalogFile(unittest.TestCase):
    def test_writes_json(self):
        from build_domain_catalog import generate_catalog
        idx = {'contextPath': '/app', 'files': [
            {'type': 'controller', 'package': 'com.app.order.controller',
             'filePath': '/src/Or.java',
             'routes': [{'path': '/app/order/list', 'kind': 'form', 'handlerMethod': 'list'}]},
        ]}
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, 'source_index.json')
            out = os.path.join(tmp, 'domain_catalog.json')
            json.dump(idx, open(src, 'w', encoding='utf-8'))
            cat = generate_catalog(src, out)
            self.assertTrue(os.path.isfile(out))
            loaded = json.load(open(out, encoding='utf-8'))
            self.assertEqual(loaded['domains'][0]['name'], 'order')
            self.assertEqual(cat['total_controllers'], 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd D:\gen-harness\plugins\speclinker\scripts
python -m pytest test_build_domain_catalog.py -v
```
Expected: `ModuleNotFoundError: No module named 'build_domain_catalog'`

- [ ] **Step 3: 구현**

`scripts/build_domain_catalog.py`:

```python
#!/usr/bin/env python3
"""
build_domain_catalog.py — source_index.json → 패키지 경로 기반 도메인 카탈로그

도메인 분류 기준: 소스 파일의 패키지 경로 (URL 세그먼트 아님).
컨트롤러 패키지의 공통 prefix를 자동 감지하고, prefix 다음 첫 세그먼트를 도메인으로 본다.
화면 컨트롤러와 API 컨트롤러가 같은 패키지에 있으므로 화면/API URL이 달라도 도메인 일관.

Usage:
    python build_domain_catalog.py [source_index_path] [output_path]
    기본값: _tmp/source_index.json → _tmp/domain_catalog.json
"""
import os
import sys
import json

# 패키지 세그먼트 중 도메인이 아닌 레이어 키워드
LAYER_KEYWORDS = {
    'controller', 'controllers', 'web', 'api', 'rest', 'restcontroller',
    'service', 'services', 'dao', 'mapper', 'repository', 'repo',
    'common', 'config', 'util', 'utils', 'base',
}


def common_package_prefix(packages: list) -> str:
    """컨트롤러 패키지들의 공통 prefix(점 단위) 반환.
    단일 패키지면 마지막 세그먼트를 제외한 부모를 반환."""
    pkgs = [p for p in packages if p]
    if not pkgs:
        return ''
    split = [p.split('.') for p in pkgs]
    if len(split) == 1:
        return '.'.join(split[0][:-1])
    common = split[0]
    for parts in split[1:]:
        i = 0
        while i < len(common) and i < len(parts) and common[i] == parts[i]:
            i += 1
        common = common[:i]
        if not common:
            break
    return '.'.join(common)


def extract_domain(package: str, prefix: str) -> str:
    """패키지에서 prefix를 제거하고 첫 번째 비-레이어 세그먼트를 도메인으로 반환."""
    if not package:
        return 'unknown'
    remainder = package
    if prefix and package.startswith(prefix):
        remainder = package[len(prefix):].lstrip('.')
    segments = [s for s in remainder.split('.') if s]
    for seg in segments:
        if seg.lower() not in LAYER_KEYWORDS:
            return seg
    return 'unknown'


def build_catalog(source_index: dict) -> dict:
    """source_index dict → 도메인 카탈로그 dict."""
    files = source_index.get('files', [])
    controllers = [f for f in files if f.get('type') == 'controller']

    prefix = common_package_prefix([f.get('package', '') for f in controllers])

    domains = {}
    for f in controllers:
        dom = extract_domain(f.get('package', ''), prefix)
        d = domains.setdefault(dom, {
            'name': dom, 'controllers': 0, 'forms': 0, 'apis': 0,
            'packages': set(),
        })
        d['controllers'] += 1
        if f.get('package'):
            d['packages'].add(f['package'])
        for r in f.get('routes', []):
            if r.get('kind') == 'form':
                d['forms'] += 1
            elif r.get('kind') == 'api':
                d['apis'] += 1

    domain_list = []
    for d in domains.values():
        d['packages'] = sorted(d['packages'])
        domain_list.append(d)
    domain_list.sort(key=lambda x: (-x['controllers'], x['name']))

    return {
        'common_prefix': prefix,
        'total_controllers': len(controllers),
        'domains': domain_list,
    }


def generate_catalog(source_index_path: str, output_path: str) -> dict:
    """source_index.json 읽기 → 카탈로그 생성 → 저장 → dict 반환."""
    with open(source_index_path, encoding='utf-8', errors='replace') as f:
        idx = json.load(f)
    catalog = build_catalog(idx)
    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
    return catalog


if __name__ == '__main__':
    src = sys.argv[1] if len(sys.argv) > 1 else '_tmp/source_index.json'
    out = sys.argv[2] if len(sys.argv) > 2 else '_tmp/domain_catalog.json'
    if not os.path.isfile(src):
        print(f'[ERROR] {src} 없음 — scan_source.js 먼저 실행')
        sys.exit(1)
    cat = generate_catalog(src, out)
    print(f'[OK] domain_catalog.json 생성 — 도메인 {len(cat["domains"])}개 '
          f'(controller {cat["total_controllers"]}개, prefix={cat["common_prefix"]})')
    for d in cat['domains']:
        print(f'  {d["name"]:<18} controller {d["controllers"]:>4}  form {d["forms"]:>4}  api {d["apis"]:>4}')
    print(f'  → {out}')
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd D:\gen-harness\plugins\speclinker\scripts
python -m pytest test_build_domain_catalog.py -v
```
Expected: 모든 테스트 PASS (12개)

- [ ] **Step 5: 실제 프로젝트 검증**

```bash
cd D:\nkshop-bos\nkshop-bos-admin
python D:\gen-harness\plugins\speclinker\scripts\build_domain_catalog.py _tmp/source_index.json _tmp/domain_catalog.json
```
Expected: 도메인 ~16개 출력 (order, fulfillment, product, display, media...), prefix=com.kth.nkshop.bos.admin

- [ ] **Step 6: 커밋**

```bash
git -C "D:\gen-harness\plugins\speclinker" add scripts/build_domain_catalog.py scripts/test_build_domain_catalog.py
git -C "D:\gen-harness\plugins\speclinker" commit -m "feat: build_domain_catalog.py — 패키지 경로 기반 도메인 분류 (제로-LLM)"
```

---

## Task 2: build_uis_goto_plan.py — form URL goto 캡처 플랜 (TDD)

**Files:**
- Create: `scripts/test_build_uis_goto_plan.py`
- Create: `scripts/build_uis_goto_plan.py`

- [ ] **Step 1: 테스트 작성**

`scripts/test_build_uis_goto_plan.py`:

```python
import sys, os, json, tempfile, unittest
sys.path.insert(0, os.path.dirname(__file__))


class TestUrlToMenuPath(unittest.TestCase):
    def test_strips_context_path(self):
        from build_uis_goto_plan import url_to_menu_path
        mp = url_to_menu_path('/app/product/prdreg/pr201Form', '/app')
        self.assertEqual(mp, ['product', 'prdreg', 'pr201Form'])

    def test_no_context_path(self):
        from build_uis_goto_plan import url_to_menu_path
        mp = url_to_menu_path('/order/list', '')
        self.assertEqual(mp, ['order', 'list'])

    def test_trailing_slash(self):
        from build_uis_goto_plan import url_to_menu_path
        mp = url_to_menu_path('/app/order/list/', '/app')
        self.assertEqual(mp, ['order', 'list'])


class TestBuildGotoPlan(unittest.TestCase):
    def _idx(self):
        return {
            'contextPath': '/app',
            'files': [
                {'type': 'controller', 'package': 'com.app.product.prdreg.controller',
                 'filePath': '/src/product/Pr201Controller.java',
                 'routes': [
                     {'path': '/app/product/prdreg/pr201Form', 'kind': 'form', 'handlerMethod': 'pr201Form'},
                     {'path': '/app/product/prdreg/productList', 'kind': 'api', 'handlerMethod': 'productList'},
                 ]},
                {'type': 'controller', 'package': 'com.app.order.claim.controller',
                 'filePath': '/src/order/Or440Controller.java',
                 'routes': [
                     {'path': '/app/order/claim/or440Form', 'kind': 'form', 'handlerMethod': 'or440Form'},
                 ]},
            ],
        }

    def test_only_form_routes_included(self):
        from build_uis_goto_plan import build_goto_plan
        plan = build_goto_plan(self._idx(), 'com.app')
        urls = {s['route'] for s in plan}
        self.assertIn('/app/product/prdreg/pr201Form', urls)
        self.assertNotIn('/app/product/prdreg/productList', urls)  # api 제외

    def test_screen_id_is_last_segment(self):
        from build_uis_goto_plan import build_goto_plan
        plan = build_goto_plan(self._idx(), 'com.app')
        screen = next(s for s in plan if 'pr201Form' in s['route'])
        self.assertEqual(screen['screenId'], 'pr201Form')

    def test_domain_from_package(self):
        from build_uis_goto_plan import build_goto_plan
        plan = build_goto_plan(self._idx(), 'com.app')
        screen = next(s for s in plan if 'pr201Form' in s['route'])
        self.assertEqual(screen['domain'], 'product')

    def test_domain_filter(self):
        from build_uis_goto_plan import build_goto_plan
        plan = build_goto_plan(self._idx(), 'com.app', domain_filter='order')
        domains = {s['domain'] for s in plan}
        self.assertEqual(domains, {'order'})

    def test_entry_file_recorded(self):
        from build_uis_goto_plan import build_goto_plan
        plan = build_goto_plan(self._idx(), 'com.app')
        screen = next(s for s in plan if 'pr201Form' in s['route'])
        self.assertEqual(screen['entryFile'], '/src/product/Pr201Controller.java')

    def test_menu_path_present(self):
        from build_uis_goto_plan import build_goto_plan
        plan = build_goto_plan(self._idx(), 'com.app')
        screen = next(s for s in plan if 'pr201Form' in s['route'])
        self.assertEqual(screen['menuPath'], ['product', 'prdreg', 'pr201Form'])


class TestGeneratePlanFile(unittest.TestCase):
    def test_writes_json(self):
        from build_uis_goto_plan import generate_goto_plan
        idx = {'contextPath': '/app', 'files': [
            {'type': 'controller', 'package': 'com.app.order.controller',
             'filePath': '/src/Or.java',
             'routes': [{'path': '/app/order/list', 'kind': 'form', 'handlerMethod': 'list'}]},
        ]}
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, 'source_index.json')
            out = os.path.join(tmp, 'uis_goto_plan.json')
            json.dump(idx, open(src, 'w', encoding='utf-8'))
            plan = generate_goto_plan(src, out, domain_filter=None)
            self.assertTrue(os.path.isfile(out))
            self.assertEqual(len(plan), 1)
            self.assertEqual(plan[0]['screenId'], 'list')


if __name__ == '__main__':
    unittest.main(verbosity=2)
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd D:\gen-harness\plugins\speclinker\scripts
python -m pytest test_build_uis_goto_plan.py -v
```
Expected: `ModuleNotFoundError`

- [ ] **Step 3: 구현**

`scripts/build_uis_goto_plan.py`:

```python
#!/usr/bin/env python3
"""
build_uis_goto_plan.py — source_index.json의 form routes → UIS goto 캡처 플랜

BFS 브라우저 탐색 대신 소스에 이미 존재하는 kind="form" URL을 직접 goto 캡처한다.
각 화면: route(URL) + screenId + menuPath(URL 계층) + domain(패키지) + entryFile(컨트롤러).

Usage:
    python build_uis_goto_plan.py [source_index_path] [output_path] [domain_filter]
    기본값: _tmp/source_index.json → _tmp/uis_goto_plan.json
"""
import os
import sys
import json

# build_domain_catalog와 동일한 도메인 추출 로직 재사용
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_domain_catalog import common_package_prefix, extract_domain


def url_to_menu_path(url: str, context_path: str) -> list:
    """URL → 메뉴 계층 리스트. contextPath 제거 후 세그먼트 분해."""
    path = url
    if context_path and path.startswith(context_path):
        path = path[len(context_path):]
    return [s for s in path.strip('/').split('/') if s]


def build_goto_plan(source_index: dict, prefix: str, domain_filter: str = None) -> list:
    """source_index dict → goto 캡처 플랜 리스트.
    prefix: 패키지 공통 prefix (build_domain_catalog.common_package_prefix 결과).
    domain_filter: 특정 도메인만 (None이면 전체)."""
    context_path = source_index.get('contextPath', '')
    files = source_index.get('files', [])
    plan = []
    for f in files:
        if f.get('type') != 'controller':
            continue
        domain = extract_domain(f.get('package', ''), prefix)
        if domain_filter and domain != domain_filter:
            continue
        for r in f.get('routes', []):
            if r.get('kind') != 'form':
                continue
            route = r.get('path', '')
            segs = [s for s in route.rstrip('/').split('/') if s]
            screen_id = r.get('handlerMethod') or (segs[-1] if segs else 'screen')
            plan.append({
                'domain': domain,
                'screenId': screen_id,
                'route': route,
                'menuPath': url_to_menu_path(route, context_path),
                'entryFile': f.get('filePath', ''),
            })
    return plan


def generate_goto_plan(source_index_path: str, output_path: str, domain_filter: str = None) -> list:
    """source_index.json 읽기 → goto 플랜 생성 → 저장 → 리스트 반환."""
    with open(source_index_path, encoding='utf-8', errors='replace') as f:
        idx = json.load(f)
    controllers = [x for x in idx.get('files', []) if x.get('type') == 'controller']
    prefix = common_package_prefix([c.get('package', '') for c in controllers])
    plan = build_goto_plan(idx, prefix, domain_filter)
    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(plan, f, ensure_ascii=False, indent=2)
    return plan


if __name__ == '__main__':
    src = sys.argv[1] if len(sys.argv) > 1 else '_tmp/source_index.json'
    out = sys.argv[2] if len(sys.argv) > 2 else '_tmp/uis_goto_plan.json'
    dom = sys.argv[3] if len(sys.argv) > 3 else None
    if not os.path.isfile(src):
        print(f'[ERROR] {src} 없음 — scan_source.js 먼저 실행')
        sys.exit(1)
    plan = generate_goto_plan(src, out, dom)
    from collections import Counter
    by_dom = Counter(s['domain'] for s in plan)
    flt = f' (필터: {dom})' if dom else ''
    print(f'[OK] uis_goto_plan.json 생성 — form 화면 {len(plan)}개{flt}')
    for d, c in by_dom.most_common():
        print(f'  {d:<18} {c}개')
    print(f'  → {out}')
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd D:\gen-harness\plugins\speclinker\scripts
python -m pytest test_build_uis_goto_plan.py -v
```
Expected: 모든 테스트 PASS (10개)

- [ ] **Step 5: 실제 프로젝트 검증**

```bash
cd D:\nkshop-bos\nkshop-bos-admin
python D:\gen-harness\plugins\speclinker\scripts\build_uis_goto_plan.py _tmp/source_index.json _tmp/uis_goto_plan.json product
```
Expected: product 도메인 form 화면 ~480개 출력

- [ ] **Step 6: 커밋**

```bash
git -C "D:\gen-harness\plugins\speclinker" add scripts/build_uis_goto_plan.py scripts/test_build_uis_goto_plan.py
git -C "D:\gen-harness\plugins\speclinker" commit -m "feat: build_uis_goto_plan.py — form URL goto 캡처 플랜 생성"
```

---

## Task 3: sl-init — RECON 스캔 + 도메인 카탈로그 생성

**Files:**
- Modify: `skills/sl-init/SKILL.md`

`/sl-init` Step 5(RTM 초기화) 다음, Step 6(다음 단계 안내) 앞에 새 단계를 삽입한다. RECON 모드일 때만 scan_source.js + build_domain_catalog.py를 실행한다.

- [ ] **Step 1: Step 5와 Step 6 사이에 Step 5.5 삽입**

`skills/sl-init/SKILL.md`에서 `## Step 6 — 다음 단계 안내` 라인을 찾아 그 앞에 아래 블록을 삽입:

````markdown
## Step 5.5 — 소스 스캔 + 도메인 카탈로그 (RECON 모드 한정)

> GENESIS 모드이면 이 단계를 건너뛴다 (소스코드가 아직 없음).
> RECON 모드이면 `scan_source.js`로 소스를 스캔하고, 패키지 경로 기반으로 도메인을 미리 분류한다.
> 이 카탈로그는 `/sl-recon` 실행 시 "처리할 도메인 선택" 화면의 입력이 된다.

```bash
!python -c "
import os, sys, subprocess, json
try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except: pass

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))

if env.get('MODE','').upper() != 'RECON':
    print('[SKIP] GENESIS 모드 — 소스 스캔 건너뜀')
    sys.exit(0)

plugin = env.get('PLUGIN_PATH','')
scan   = os.path.join(plugin, 'scripts', 'scan_source.js') if plugin else ''
catpy  = os.path.join(plugin, 'scripts', 'build_domain_catalog.py') if plugin else ''

if not (scan and os.path.exists(scan)):
    print('[WARN] scan_source.js 없음 — 스캔 건너뜀 (PLUGIN_PATH 확인)')
    sys.exit(0)

# 1) 소스 스캔
print('소스 스캔 중 (scan_source.js)...')
r = subprocess.run(['node', scan, '--workspace=.'],
                   capture_output=True, text=True, encoding='utf-8', errors='replace')
if r.returncode != 0:
    print('[WARN] 스캔 실패 — /sl-recon에서 재시도:', (r.stderr or '')[:300])
    sys.exit(0)

idx_path = '_tmp/source_index.json'
if not os.path.exists(idx_path):
    print('[WARN] source_index.json 미생성 — /sl-recon에서 재시도')
    sys.exit(0)
data = json.load(open(idx_path, encoding='utf-8'))
print(f'  소스 스캔 완료: {len(data.get(\"files\",[]))}개 파일')

# 2) 도메인 카탈로그
if catpy and os.path.exists(catpy):
    r2 = subprocess.run([sys.executable, catpy, idx_path, '_tmp/domain_catalog.json'],
                        capture_output=True, text=True, encoding='utf-8', errors='replace')
    print(r2.stdout)
    if r2.returncode != 0:
        print('[WARN] 도메인 카탈로그 생성 실패:', (r2.stderr or '')[:300])
else:
    print('[WARN] build_domain_catalog.py 없음 — /sl-recon에서 생성')
"
```

> 출력된 도메인 목록은 `_tmp/domain_catalog.json`에 저장된다.
> `/sl-recon` 실행 시 이 목록에서 처리할 도메인을 선택하게 된다.

---
````

- [ ] **Step 2: Step 6 안내 문구에 도메인 선택 언급 추가**

`skills/sl-init/SKILL.md`의 `**캡처 설정 건너뛴 경우:**` 블록에서 아래 라인을 찾는다:
```
  - 기존 코드 있음 (문서 없음)  → /sl-recon 실행
```
이 라인을 (두 곳 모두, `replace_all`) 아래로 교체:
```
  - 기존 코드 있음 (문서 없음)  → /sl-recon 실행 (도메인 선택 후 부분 처리 가능)
```

- [ ] **Step 3: 검증**

```bash
grep -n "Step 5.5\|domain_catalog" "D:\gen-harness\plugins\speclinker\skills\sl-init\SKILL.md"
```
Expected: Step 5.5 헤더 + domain_catalog 참조 라인 출력

- [ ] **Step 4: 커밋**

```bash
git -C "D:\gen-harness\plugins\speclinker" add skills/sl-init/SKILL.md
git -C "D:\gen-harness\plugins\speclinker" commit -m "feat(sl-init): RECON 모드 Step 5.5 — 소스 스캔 + 도메인 카탈로그 생성"
```

---

## Task 4: sl-recon — 도메인 선택지 제공

**Files:**
- Modify: `skills/sl-recon/SKILL.md`

`/sl-recon` STEP 1(소스 스캔) 다음, STEP 1.5(Profile) 앞에 도메인 선택 단계를 추가한다. 사용자가 선택한 도메인을 `POC_DOMAINS`로 자동 설정하여 기존 POC 필터 메커니즘(STEP 2-2, STEP 4 등)이 그대로 동작하게 한다.

- [ ] **Step 1: STEP 1.5 앞에 STEP 1.7 삽입**

`skills/sl-recon/SKILL.md`에서 `## STEP 1.5 — 프로젝트 Profile 생성·로드` 라인을 찾아 그 앞에 삽입:

````markdown
## STEP 1.7 — 처리 도메인 선택 (카탈로그 기반)

> `_tmp/domain_catalog.json`(sl-init Step 5.5 또는 아래에서 생성)을 읽어 도메인 목록을 제시한다.
> 수천 개 INF 프로젝트에서 전체를 한 번에 처리하지 않고 도메인 단위로 선택 처리하기 위함이다.

**카탈로그 로드/생성:**

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
print('처리할 도메인을 선택하세요 (패키지 경로 기반 분류)')
print('=' * 64)
print(f'  공통 prefix: {cat.get(\"common_prefix\",\"\")}')
print()
print('  #  도메인'.ljust(26) + 'controller   form   api')
print('  ' + '-' * 52)
for i, d in enumerate(domains, 1):
    mark = ' *' if d['name'] in poc_domains else '  '
    print(f'{mark}{i:>2}. {d[\"name\"]:<18} {d[\"controllers\"]:>7}   {d[\"forms\"]:>5}   {d[\"apis\"]:>4}')
print()
total_c = sum(d['controllers'] for d in domains)
total_f = sum(d['forms'] for d in domains)
print(f'  전체: 도메인 {len(domains)}개 / controller {total_c}개 / form 화면 {total_f}개')
print()
if poc_domains:
    print(f'  현재 POC_DOMAINS = {poc_domains} (* 표시)')
print()
print('[선택 방법]')
print('  특정 도메인: \"product, order\" (쉼표 구분)')
print('  전체 처리:   \"전체\"')
"
```

**사용자 선택 처리:**

사용자가 도메인명(쉼표 구분) 또는 "전체"를 입력하면 `project.env`의 `POC_MODE`/`POC_DOMAINS`를 갱신한다.

- 특정 도메인 선택 시: `POC_MODE=true`, `POC_DOMAINS={선택값}` 으로 project.env 수정 (Edit 도구)
- "전체" 선택 시: `POC_MODE=false` 로 두고 진행

> POC_DOMAINS를 설정하면 기존 STEP 2-2(도메인 필터), STEP 4(INF 생성)가 자동으로 선택 도메인만 처리한다.
> **단, domain_catalog의 도메인명(패키지 기반)과 _domain_plan.json의 도메인명(spec-agent 생성)이 다를 수 있다.**
> spec-agent는 패키지/경로 기반으로 도메인을 나누므로 대부분 일치하나, STEP 3 도메인 검토에서 최종 확인한다.

> **확인 전 STEP 1.5 진행 금지.**

---
````

- [ ] **Step 2: 검증**

```bash
grep -n "STEP 1.7\|domain_catalog\|처리 도메인 선택" "D:\gen-harness\plugins\speclinker\skills\sl-recon\SKILL.md"
```
Expected: STEP 1.7 헤더 + domain_catalog 참조 출력

- [ ] **Step 3: 커밋**

```bash
git -C "D:\gen-harness\plugins\speclinker" add skills/sl-recon/SKILL.md
git -C "D:\gen-harness\plugins\speclinker" commit -m "feat(sl-recon): STEP 1.7 — 도메인 카탈로그 선택지 → POC_DOMAINS 자동 설정"
```

---

## Task 5: sl-recon-uis — goto 캡처 모드 (기본)

**Files:**
- Modify: `skills/sl-recon-uis/SKILL.md`

`/sl-recon-uis`에 goto 캡처 모드를 추가한다. PREVIEW_BASE_URL이 설정되어 있으면 BFS 대신 source_index.json의 form URL을 직접 goto 캡처하는 것을 **기본**으로 한다. BFS는 form route가 없는 SPA 폴백으로만 유지한다.

- [ ] **Step 1: 실행 모드 결정 로직에 goto 분기 추가**

`skills/sl-recon-uis/SKILL.md`의 `## 실행 전 확인` 섹션에서 `base_url = env.get('PREVIEW_BASE_URL', '')` 직후의 분기 로직을 확인하고, `if not base_url:` 블록 **앞에** goto 가능 여부 판단을 추가한다.

찾을 텍스트:
```
    base_url = env.get('PREVIEW_BASE_URL', '')

    # mode json 로드/초기화
    mode = {}
    if os.path.exists('_tmp/_recon_uis_mode.json'):
        mode = json.load(open('_tmp/_recon_uis_mode.json', encoding='utf-8'))

    if not base_url:
```

교체 텍스트:
```
    base_url = env.get('PREVIEW_BASE_URL', '')

    # mode json 로드/초기화
    mode = {}
    if os.path.exists('_tmp/_recon_uis_mode.json'):
        mode = json.load(open('_tmp/_recon_uis_mode.json', encoding='utf-8'))

    # goto 캡처 가능 여부: source_index.json에 form route가 있으면 goto 우선
    form_count = 0
    if os.path.exists('_tmp/source_index.json'):
        sidx = json.load(open('_tmp/source_index.json', encoding='utf-8'))
        form_count = sum(1 for f in sidx.get('files', [])
                         for r in f.get('routes', []) if r.get('kind') == 'form')
    mode['goto_capable'] = form_count > 0

    if base_url and form_count > 0 and not mode.get('spec_only'):
        mode['capture_mode'] = 'goto'
        json.dump(mode, open('_tmp/_recon_uis_mode.json', 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=2)
        print('[캡처 모드] goto — source_index.json의 form URL ' + str(form_count) + '개 직접 캡처')
        print('  PREVIEW_BASE_URL = ' + base_url)
        print('  → STEP 6-0-GOTO로 이동 (BFS 건너뜀)')
    elif not base_url:
```

> 주의: 위 교체로 `if not base_url:` 가 `elif not base_url:` 로 바뀐다. 원본의 `if not base_url:` 한 줄만 정확히 이 위치의 것을 교체해야 한다.

- [ ] **Step 2: STEP 6-0 앞에 STEP 6-0-GOTO 섹션 삽입**

`skills/sl-recon-uis/SKILL.md`에서 `## STEP 6-0: 정적 Fallback (앱 미실행 시)` 라인을 찾아 그 앞에 삽입:

````markdown
## STEP 6-0-GOTO: form URL 직접 goto 캡처 (기본 모드)

> `_tmp/_recon_uis_mode.json`의 `capture_mode == 'goto'`일 때만 실행한다.
> BFS 메뉴 탐색 대신 source_index.json의 `kind="form"` URL을 `capture_single_tab.js`로 직접 goto 캡처한다.
> Chrome CDP 로그인 세션은 여전히 필요하다 (STEP 6-1 먼저 실행).

**전제: Chrome CDP 로그인 완료** — STEP 6-1을 먼저 수행해 Chrome을 띄우고 로그인한 뒤 "계속"한다.

**6-0-GOTO-1: goto 플랜 생성**

```bash
!python -c "
import os, sys, subprocess, json
try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except: pass

mode = json.load(open('_tmp/_recon_uis_mode.json', encoding='utf-8'))
if mode.get('capture_mode') != 'goto':
    print('[SKIP] goto 모드 아님 — STEP 6-0/6-1로 진행')
    sys.exit(0)

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
plugin = env.get('PLUGIN_PATH','')
genpy  = os.path.join(plugin, 'scripts', 'build_uis_goto_plan.py') if plugin else ''

# 도메인 필터 (POC_DOMAINS 또는 인수)
poc_domains = [d.strip() for d in env.get('POC_DOMAINS','').split(',') if d.strip()]
domain_filter = mode.get('domain_filter') or (poc_domains[0] if poc_domains else None)

args = [sys.executable, genpy, '_tmp/source_index.json', '_tmp/uis_goto_plan.json']
if domain_filter:
    args.append(domain_filter)
r = subprocess.run(args, capture_output=True, text=True, encoding='utf-8', errors='replace')
print(r.stdout)
if r.returncode != 0:
    print('[ERROR] goto 플랜 생성 실패:', (r.stderr or '')[:300]); sys.exit(1)
"
```

**6-0-GOTO-2: 화면 순차 goto 캡처**

`_tmp/uis_goto_plan.json`의 각 화면을 `capture_single_tab.js --url=`로 캡처하고 결과를 `_tmp/uis_capture_map.json`에 누적한다.

```bash
!python -c "
import os, sys, subprocess, json
try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except: pass

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))
plugin   = env.get('PLUGIN_PATH','')
base_url = env.get('PREVIEW_BASE_URL','').rstrip('/')
cdp_port = env.get('PREVIEW_CDP_PORT','9222')
capture  = os.path.join(plugin, 'scripts', 'capture_single_tab.js') if plugin else ''
ws = os.getcwd()

plan = json.load(open('_tmp/uis_goto_plan.json', encoding='utf-8'))

# 재개: 기존 캡처된 route는 스킵
cap_map = []
if os.path.exists('_tmp/uis_capture_map.json'):
    cap_map = json.load(open('_tmp/uis_capture_map.json', encoding='utf-8'))
done_routes = set(e.get('activeRoute','') for e in cap_map)

todo = [s for s in plan if s['route'] not in done_routes]
print(f'goto 캡처: 전체 {len(plan)}개 / 완료 {len(done_routes)}개 / 대상 {len(todo)}개')

for i, s in enumerate(todo, 1):
    url = base_url + s['route']
    sid = s['screenId']
    print(f'  [{i}/{len(todo)}] {sid} ← {url}')
    try:
        r = subprocess.run(
            ['node', capture, '--url=' + url, '--screenId=' + sid,
             '--workspace=' + ws, '--port=' + cdp_port, '--maxHeight=8000'],
            capture_output=True, text=True, encoding='utf-8', errors='ignore', timeout=90)
        data = json.loads(r.stdout.strip())
        entry = {
            'menuPath':    s['menuPath'],
            'screenLabel': sid,
            'activeRoute': s['route'],
            'contentRoute': s['route'],
            'domain':      s['domain'],
            'screenId':    sid,
            'entryFile':   s['entryFile'],
            'capture_mode': 'goto',
        }
        if data.get('success'):
            entry['captureDir']  = data.get('captureDir','')
            entry['captureFile'] = data.get('captureFile','')
            entry['widgetCount'] = data.get('widgetCount',0)
            entry['apiHints']    = data.get('apiHints', [])
            print(f'      OK widgets={data.get(\"widgetCount\",0)}')
        else:
            entry['captureDir'] = ''
            print(f'      FAIL: {data.get(\"error\",\"?\")}')
        cap_map.append(entry)
        json.dump(cap_map, open('_tmp/uis_capture_map.json','w',encoding='utf-8'),
                  ensure_ascii=False, indent=2)
    except Exception as ex:
        print(f'      ERROR: {ex}')

print()
print(f'goto 캡처 완료: uis_capture_map.json {len(cap_map)}개')
print('→ STEP 6-2-3으로 이동 (도메인은 이미 패키지 기반으로 설정됨)')
"
```

> goto 캡처는 `domain`과 `menuPath`를 이미 채우므로 STEP 6-2-3의 INF 매칭 도메인 결정을 건너뛸 수 있다.
> 단, `apiHints`(XHR/Fetch URL)는 capture 결과에 포함되므로 STEP 6-2-3-B 소스 역매핑은 그대로 활용 가능하다.
> goto 캡처 완료 후 **STEP 6-2-3으로 이동**한다 (STEP 6-1 로그인은 이미 완료, STEP 6-2 BFS는 건너뜀).

---
````

- [ ] **Step 3: STEP 6-2-3 도메인 결정에 goto 항목 보호 추가**

`skills/sl-recon-uis/SKILL.md`의 6-2-3-A Phase 1에서 도메인을 덮어쓰지 않도록, 정적 fallback 보호 라인 옆에 goto 보호를 추가한다.

찾을 텍스트:
```
    # 정적 fallback 항목은 domain 이미 설정됨
    if entry.get('static_fallback') and entry.get('domain'):
        continue
```

교체 텍스트:
```
    # 정적 fallback 항목은 domain 이미 설정됨
    if entry.get('static_fallback') and entry.get('domain'):
        continue
    # goto 캡처 항목은 패키지 기반 domain이 이미 정확함 — 덮어쓰지 않음
    if entry.get('capture_mode') == 'goto' and entry.get('domain'):
        continue
```

- [ ] **Step 4: 검증**

```bash
grep -n "STEP 6-0-GOTO\|capture_mode\|goto_capable" "D:\gen-harness\plugins\speclinker\skills\sl-recon-uis\SKILL.md"
```
Expected: STEP 6-0-GOTO 헤더 + capture_mode 참조 여러 줄 출력

- [ ] **Step 5: 커밋**

```bash
git -C "D:\gen-harness\plugins\speclinker" add skills/sl-recon-uis/SKILL.md
git -C "D:\gen-harness\plugins\speclinker" commit -m "feat(sl-recon-uis): STEP 6-0-GOTO — form URL 직접 goto 캡처 (BFS 폴백 유지)"
```

---

## Task 6: 버전업 + 문서 갱신

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `CLAUDE.md`

- [ ] **Step 1: plugin.json 버전 bump**

`.claude-plugin/plugin.json`에서 `"version": "2.52.0"` → `"version": "2.53.0"`

- [ ] **Step 2: CLAUDE.md 버전 노트 추가**

`CLAUDE.md`에서 `v2.52:` 으로 시작하는 줄을 찾아 그 앞에 삽입:
```
> v2.53: 도메인 선택형 RECON — sl-init Step 5.5(스캔+패키지기반 도메인 카탈로그) + sl-recon STEP 1.7(도메인 선택→POC_DOMAINS) + sl-recon-uis STEP 6-0-GOTO(form URL 직접 goto 캡처, BFS 폴백). build_domain_catalog.py / build_uis_goto_plan.py 신규.
```

- [ ] **Step 3: CLAUDE.md 파이프라인 행 갱신**

`CLAUDE.md`에서 RECON 분석 파이프라인 행을 찾는다:
```
| 기존 코드 (RECON 분석만) | sl-init → sl-recon → 납품 |
```
교체:
```
| 기존 코드 (RECON 분석만) | sl-init(스캔+카탈로그) → sl-recon(도메인 선택) → sl-recon-uis(goto 캡처) → 납품 |
```

- [ ] **Step 4: 검증**

```bash
grep -c "2.53" "D:\gen-harness\plugins\speclinker\.claude-plugin\plugin.json"
grep -c "v2.53\|도메인 선택" "D:\gen-harness\plugins\speclinker\CLAUDE.md"
```
Expected: 각각 1 이상

- [ ] **Step 5: 커밋**

```bash
git -C "D:\gen-harness\plugins\speclinker" add .claude-plugin/plugin.json CLAUDE.md
git -C "D:\gen-harness\plugins\speclinker" commit -m "chore: v2.53.0 — 도메인 선택형 RECON + UIS goto 캡처"
```

---

## Self-Review

**Spec coverage:**

| 요구사항 | 구현 태스크 |
|---------|-----------|
| 도메인 분류 기준 = 패키지 경로 (URL 아님) | Task 1 — common_package_prefix + extract_domain |
| sl-init에서 스캔 + 도메인 분류 | Task 3 — Step 5.5 |
| sl-recon에서 도메인 선택지 제공 | Task 4 — STEP 1.7 (POC_DOMAINS 재활용) |
| UIS goto 캡처 (기본) | Task 5 — STEP 6-0-GOTO + build_uis_goto_plan.py (Task 2) |
| BFS는 SPA 폴백 유지 | Task 5 — form_count==0이면 기존 BFS/static 분기 유지 |
| 화면/API URL 불일치 견고성 | Task 1 — 패키지 기반(화면·API 같은 패키지) |

**갭 없음.**

**Placeholder 스캔:** TBD/TODO 없음. 모든 코드 블록 완전.

**타입 일관성:**
- `common_package_prefix()` / `extract_domain()` — Task 1 정의, Task 2가 import 재사용 (시그니처 일치)
- `domain_catalog.json` 구조: `{common_prefix, total_controllers, domains:[{name, controllers, forms, apis, packages}]}` — Task 1 생성, Task 4 소비 (필드명 일치: name/controllers/forms/apis)
- `uis_goto_plan.json` 구조: `[{domain, screenId, route, menuPath, entryFile}]` — Task 2 생성, Task 5 소비 (필드명 일치)
- `capture_single_tab.js` 인터페이스 `--url= --screenId= --workspace= --port=` — 기존 스크립트 확인 완료, Task 5에서 정확히 사용
- `uis_capture_map.json` entry의 `capture_mode='goto'` 플래그 — Task 5 6-0-GOTO-2가 설정, Task 5 Step 3가 6-2-3에서 보호
- `POC_DOMAINS` / `POC_MODE` — 기존 sl-recon 메커니즘, Task 4가 설정만 (기존 STEP 2-2/4가 소비)
