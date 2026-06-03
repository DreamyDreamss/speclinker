# Speclinker Docsify Viewer + IA Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** speclinker RECON 산출물을 브라우저로 탐색하는 Docsify 기반 웹 뷰어를 구현하고, 수백 개의 스펙을 메뉴 계층(IA 트리) 또는 도메인 기준으로 드릴다운할 수 있게 한다.

**Architecture:** Python 사이드카(`gen_docsify.py`)가 INF/UIS/SCH 파일의 frontmatter를 스캔해 `spec_index.json`을 생성한다. Docsify 커스텀 플러그인(`docsify-sl.js`)이 런타임에 이 인덱스를 읽어 대시보드·도메인 탭·IA 트리를 렌더링한다. 기존 `.md` 파일은 무수정이며 Docsify가 그대로 HTML로 변환한다.

**Tech Stack:** Python 3.x (표준 라이브러리만, PyYAML 불필요), Docsify 4.x (CDN), Vanilla JS, CSS Custom Properties

---

## 파일 목록

| 파일 | 역할 | 신규/수정 |
|------|------|---------|
| `scripts/gen_docsify.py` | frontmatter 파서 + INF/UIS 스캐너 + spec_index.json 생성 | 신규 |
| `scripts/test_gen_docsify.py` | gen_docsify.py 단위 테스트 | 신규 |
| `docs/viewer/index.html` | Docsify SPA 진입점 | 신규 |
| `docs/viewer/sl-theme.css` | 골드 다크 CSS 변수 + 컴포넌트 스타일 | 신규 |
| `docs/viewer/docsify-sl.js` | 커스텀 플러그인 — 사이드바·대시보드·INF/UIS·Quick Nav·크로스링크·IA 트리 | 신규 |
| `agents/ddd-ui-agent.md` | `menu-path:` frontmatter 필드 추가 + 추론 로직 | 수정 |
| `skills/sl-ia/SKILL.md` | `/sl-ia` 스킬 (IA_MAP.md 생성 + UIS menu-path 일괄 보완) | 신규 |
| `CLAUDE.md` | `/sl-ia` 라우팅 + `/sl-viewer` 설명 업데이트 | 수정 |
| `.claude-plugin/plugin.json` | `sl-ia` 스킬 등록, 버전 2.52.0 bump | 수정 |
| `skills/sl-viewer/SKILL.md` | Docsify 방식으로 교체 | 수정 |

---

## Task 1: gen_docsify.py — 파서 유틸리티 (TDD)

**Files:**
- Create: `scripts/test_gen_docsify.py`
- Create: `scripts/gen_docsify.py` (파서 유틸 함수만)

- [ ] **Step 1: 테스트 파일 작성**

`scripts/test_gen_docsify.py`:

```python
import sys, os, json, tempfile, unittest
sys.path.insert(0, os.path.dirname(__file__))

# --- 샘플 픽스처 ---
INF_SAMPLE = """\
---
inf-id: INF-ORD-011
method: POST
path: /app/order/ivr/processS
domain: order
domain-code: ORD
req-f: [TBD]
tables:
  - ORD_MST
  - ADDR_MST
---

# INF-ORD-011

## 요청

| 파라미터 | 타입 | 필수 |
|---------|------|------|
| ORD_ID | String | [TBD] |
"""

UIS_SAMPLE = """\
---
화면ID: OrderListPage
화면명: 주문 목록 화면
라우트: /order/list
도메인: order
UIS-ID: UIS-F-031
menu-path:
  - 주문관리
  - 주문조회
apis:
  - INF-ORD-011   # 주문 목록 조회
  - INF-ORD-012
related-screens:
  - UIS-F-032
---

# UIS-F-031
"""


class TestGetFmBlock(unittest.TestCase):
    def test_extracts_block(self):
        from gen_docsify import _get_fm_block
        block = _get_fm_block(INF_SAMPLE)
        self.assertIn('inf-id: INF-ORD-011', block)

    def test_returns_empty_for_no_frontmatter(self):
        from gen_docsify import _get_fm_block
        self.assertEqual(_get_fm_block('# Title\nContent'), '')


class TestParseFrontmatter(unittest.TestCase):
    def test_parses_basic_keys(self):
        from gen_docsify import parse_frontmatter
        fm = parse_frontmatter(INF_SAMPLE)
        self.assertEqual(fm['inf-id'], 'INF-ORD-011')
        self.assertEqual(fm['method'], 'POST')

    def test_parses_path_with_slashes(self):
        from gen_docsify import parse_frontmatter
        fm = parse_frontmatter(INF_SAMPLE)
        self.assertEqual(fm['path'], '/app/order/ivr/processS')

    def test_returns_empty_when_no_frontmatter(self):
        from gen_docsify import parse_frontmatter
        self.assertEqual(parse_frontmatter('# Title'), {})

    def test_parses_korean_keys(self):
        from gen_docsify import parse_frontmatter
        fm = parse_frontmatter(UIS_SAMPLE)
        self.assertEqual(fm['UIS-ID'], 'UIS-F-031')
        self.assertEqual(fm['도메인'], 'order')


class TestExtractListField(unittest.TestCase):
    def test_extracts_apis(self):
        from gen_docsify import _get_fm_block, _extract_list_field
        fb = _get_fm_block(UIS_SAMPLE)
        self.assertEqual(_extract_list_field(fb, 'apis'), ['INF-ORD-011', 'INF-ORD-012'])

    def test_extracts_menu_path(self):
        from gen_docsify import _get_fm_block, _extract_list_field
        fb = _get_fm_block(UIS_SAMPLE)
        self.assertEqual(_extract_list_field(fb, 'menu-path'), ['주문관리', '주문조회'])

    def test_strips_inline_comments(self):
        from gen_docsify import _extract_list_field
        fb = 'apis:\n  - INF-ORD-011   # 주문 처리\n  - INF-ORD-012\n'
        self.assertEqual(_extract_list_field(fb, 'apis'), ['INF-ORD-011', 'INF-ORD-012'])

    def test_returns_empty_when_key_missing(self):
        from gen_docsify import _extract_list_field
        self.assertEqual(_extract_list_field('domain: order', 'menu-path'), [])

    def test_stops_at_next_key(self):
        from gen_docsify import _extract_list_field
        fb = 'apis:\n  - INF-ORD-011\ndomain: order\n'
        self.assertEqual(_extract_list_field(fb, 'apis'), ['INF-ORD-011'])


class TestCountTbd(unittest.TestCase):
    def test_counts_in_body(self):
        from gen_docsify import count_tbd
        # INF_SAMPLE body에 [TBD] 1개 (테이블 셀)
        self.assertEqual(count_tbd(INF_SAMPLE), 1)

    def test_ignores_frontmatter_tbd(self):
        from gen_docsify import count_tbd
        content = '---\nreq-f: [TBD]\nsrs-f: [TBD]\n---\n# Title'
        self.assertEqual(count_tbd(content), 0)

    def test_counts_multiple_in_body(self):
        from gen_docsify import count_tbd
        content = '---\nid: X\n---\n[TBD] and [TBD] and [TBD]'
        self.assertEqual(count_tbd(content), 3)


class TestBuildIaTree(unittest.TestCase):
    def test_builds_nested_tree(self):
        from gen_docsify import build_ia_tree
        uis = [
            {'id': 'UIS-F-031', 'name': '주문 목록', 'menu_path': ['주문관리', '주문조회'], 'apis': [], 'domain': 'order'},
            {'id': 'UIS-F-032', 'name': '주문 상세', 'menu_path': ['주문관리', '주문상세'], 'apis': [], 'domain': 'order'},
        ]
        tree = build_ia_tree(uis)
        self.assertIn('주문관리', tree)
        screens = tree['주문관리']['주문조회']['__screens__']
        self.assertEqual(screens[0]['id'], 'UIS-F-031')

    def test_puts_empty_menu_path_in_domain_bucket(self):
        from gen_docsify import build_ia_tree
        uis = [{'id': 'UIS-F-099', 'name': '미분류', 'menu_path': [], 'apis': [], 'domain': 'order'}]
        tree = build_ia_tree(uis)
        self.assertIn('[order]', tree)

    def test_tbd_menu_path_goes_to_domain_bucket(self):
        from gen_docsify import build_ia_tree
        uis = [{'id': 'UIS-F-100', 'name': '미분류2', 'menu_path': ['[TBD]'], 'apis': [], 'domain': 'product'}]
        tree = build_ia_tree(uis)
        self.assertIn('[product]', tree)


class TestLoadSprintStatus(unittest.TestCase):
    def test_returns_empty_when_file_missing(self):
        from gen_docsify import load_sprint_status
        self.assertEqual(load_sprint_status('/nonexistent/path'), {})

    def test_parses_done_counts(self):
        from gen_docsify import load_sprint_status
        yaml_content = (
            "order:\n"
            "  FUNC-order-001:\n    status: done\n"
            "  FUNC-order-002:\n    status: review\n"
            "  FUNC-order-003:\n    status: done\n"
            "product:\n"
            "  FUNC-product-001:\n    status: backlog\n"
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            os.makedirs(os.path.join(tmpdir, '.speclinker'))
            path = os.path.join(tmpdir, '.speclinker', 'sprint-status.yaml')
            open(path, 'w', encoding='utf-8').write(yaml_content)
            stats = load_sprint_status(tmpdir)
        self.assertEqual(stats['order']['done'], 2)
        self.assertEqual(stats['order']['total'], 3)
        self.assertEqual(stats['product']['done'], 0)


class TestGenerateIndex(unittest.TestCase):
    def _make_inf(self, tmpdir, domain, inf_id, method='GET', path='/test'):
        d = os.path.join(tmpdir, 'docs', '05_설계서', 'INF', domain)
        os.makedirs(d, exist_ok=True)
        c = (f'---\ninf-id: {inf_id}\nmethod: {method}\npath: {path}\n'
             f'domain: {domain}\ndomain-code: {domain[:3].upper()}\n---\n# {inf_id}\n')
        open(os.path.join(d, f'{inf_id}.md'), 'w', encoding='utf-8').write(c)

    def _make_uis(self, tmpdir, domain, uis_id, menu_path=None):
        d = os.path.join(tmpdir, 'docs', '05_설계서', 'UIS', uis_id)
        os.makedirs(d, exist_ok=True)
        mp = 'menu-path:\n' + ''.join(f'  - {p}\n' for p in (menu_path or []))
        c = (f'---\n화면명: {uis_id}\n라우트: /test\n도메인: {domain}\n'
             f'UIS-ID: {uis_id}\n{mp}---\n# {uis_id}\n')
        open(os.path.join(d, 'spec.md'), 'w', encoding='utf-8').write(c)

    def test_generates_valid_index(self):
        from gen_docsify import generate_index
        with tempfile.TemporaryDirectory() as tmpdir:
            self._make_inf(tmpdir, 'order', 'INF-ORD-001', 'POST', '/order/save')
            self._make_inf(tmpdir, 'order', 'INF-ORD-002', 'GET', '/order/list')
            self._make_uis(tmpdir, 'order', 'UIS-F-001', ['주문관리', '주문조회'])
            out = os.path.join(tmpdir, 'docs', 'viewer', 'spec_index.json')
            idx = generate_index(tmpdir, out)
        self.assertEqual(idx['totals']['inf'], 2)
        self.assertEqual(idx['totals']['uis'], 1)
        self.assertEqual(idx['domains']['order']['inf'], 2)
        self.assertIn('주문관리', idx['ia_tree'])
        self.assertTrue(os.path.isfile(out))

    def test_output_is_valid_json(self):
        from gen_docsify import generate_index
        with tempfile.TemporaryDirectory() as tmpdir:
            self._make_inf(tmpdir, 'product', 'INF-PRD-001')
            out = os.path.join(tmpdir, 'docs', 'viewer', 'spec_index.json')
            generate_index(tmpdir, out)
            loaded = json.loads(open(out, encoding='utf-8').read())
        self.assertIn('generated_at', loaded)
        self.assertIn('totals', loaded)
        self.assertEqual(len(loaded['infs']), 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
cd D:\gen-harness\plugins\speclinker\scripts
python -m pytest test_gen_docsify.py -v 2>&1 | head -20
```

Expected: `ModuleNotFoundError: No module named 'gen_docsify'`

- [ ] **Step 3: gen_docsify.py 파서 유틸 함수 구현**

`scripts/gen_docsify.py`:

```python
#!/usr/bin/env python3
"""
gen_docsify.py — speclinker 산출물 스캔 → spec_index.json 생성

Usage:
    python gen_docsify.py [spec_root]
    spec_root: project.env가 있는 프로젝트 루트. 기본값: 현재 디렉터리
"""
import os
import re
import json
import sys
from datetime import datetime


# ─────────────────── 파서 유틸리티 ───────────────────

def _get_fm_block(content: str) -> str:
    """--- ... --- frontmatter 블록 문자열 반환. 없으면 빈 문자열."""
    m = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    return m.group(1) if m else ''


def parse_frontmatter(content: str) -> dict:
    """마크다운 YAML frontmatter를 {key: value} dict로 파싱.
    들여쓰기 없는 'key: value' 라인만 처리. 리스트 필드는 _extract_list_field 사용."""
    fm = {}
    for line in _get_fm_block(content).splitlines():
        if ':' in line and not line.startswith(' ') and not line.startswith('-'):
            k, _, v = line.partition(':')
            k, v = k.strip(), v.strip()
            if k:
                fm[k] = v
    return fm


def _extract_list_field(fm_block: str, key: str) -> list:
    """frontmatter 블록에서 YAML 리스트 필드 추출.
    'apis:\\n  - INF-ORD-011  # comment' → ['INF-ORD-011']"""
    result, in_list = [], False
    for line in fm_block.splitlines():
        if re.match(rf'^{re.escape(key)}:\s*$', line.rstrip()):
            in_list = True
            continue
        if in_list:
            stripped = line.strip()
            if stripped.startswith('- '):
                val = stripped[2:].split('#')[0].strip()
                if val:
                    result.append(val)
            elif stripped and not line.startswith(' '):
                break
    return result


def count_tbd(content: str) -> int:
    """frontmatter 이후 본문의 [TBD] 개수 반환."""
    body = re.sub(r'^---\n.*?\n---\n?', '', content, count=1, flags=re.DOTALL)
    return len(re.findall(r'\[TBD\]', body))


# ─────────────────── 스캐너 ───────────────────

def scan_infs(spec_root: str) -> list:
    """docs/05_설계서/INF/{domain}/INF-*.md 전수 스캔."""
    infs = []
    inf_root = os.path.join(spec_root, 'docs', '05_설계서', 'INF')
    if not os.path.isdir(inf_root):
        return infs
    for domain_dir in sorted(os.listdir(inf_root)):
        domain_path = os.path.join(inf_root, domain_dir)
        if not os.path.isdir(domain_path):
            continue
        for fname in sorted(os.listdir(domain_path)):
            if not (fname.endswith('.md') and fname.startswith('INF-')):
                continue
            fpath = os.path.join(domain_path, fname)
            try:
                content = open(fpath, encoding='utf-8', errors='replace').read()
            except OSError:
                continue
            fm = parse_frontmatter(content)
            infs.append({
                'id': fm.get('inf-id', fname.replace('.md', '')),
                'method': fm.get('method', ''),
                'path': fm.get('path', ''),
                'domain': fm.get('domain', domain_dir),
                'domain_code': fm.get('domain-code', ''),
                'tbd_count': count_tbd(content),
                'file': os.path.relpath(fpath, spec_root).replace('\\', '/'),
            })
    return infs


def scan_uis(spec_root: str) -> list:
    """docs/05_설계서/UIS/{screen}/spec.md 전수 스캔."""
    uis = []
    uis_root = os.path.join(spec_root, 'docs', '05_설계서', 'UIS')
    if not os.path.isdir(uis_root):
        return uis
    for entry in sorted(os.listdir(uis_root)):
        spec_path = os.path.join(uis_root, entry, 'spec.md')
        if not os.path.isfile(spec_path):
            continue
        try:
            content = open(spec_path, encoding='utf-8', errors='replace').read()
        except OSError:
            continue
        fm = parse_frontmatter(content)
        fb = _get_fm_block(content)
        uis.append({
            'id': fm.get('UIS-ID', entry),
            'name': fm.get('화면명', ''),
            'route': fm.get('라우트', ''),
            'domain': fm.get('도메인', ''),
            'menu_path': _extract_list_field(fb, 'menu-path'),
            'apis': _extract_list_field(fb, 'apis'),
            'has_preview': os.path.isfile(os.path.join(uis_root, entry, 'preview.png')),
            'file': os.path.relpath(spec_path, spec_root).replace('\\', '/'),
        })
    return uis


def load_sprint_status(spec_root: str) -> dict:
    """sprint-status.yaml에서 도메인별 done/total 집계 (PyYAML 없이)."""
    path = os.path.join(spec_root, '.speclinker', 'sprint-status.yaml')
    if not os.path.isfile(path):
        return {}
    try:
        content = open(path, encoding='utf-8', errors='replace').read()
    except OSError:
        return {}
    stats, current = {}, None
    for line in content.splitlines():
        # 최상위 키 = 도메인 (들여쓰기 없음, 값 없음)
        m = re.match(r'^([a-zA-Z][a-zA-Z0-9_-]*):\s*$', line)
        if m:
            current = m.group(1)
            stats.setdefault(current, {'done': 0, 'total': 0})
        sm = re.search(r'\bstatus:\s*(done|review|in-progress|backlog|ready(?:-for-dev)?)\b', line)
        if sm and current:
            stats[current]['total'] += 1
            if sm.group(1) == 'done':
                stats[current]['done'] += 1
    return stats


def build_ia_tree(uis: list) -> dict:
    """menu_path 기반 IA 트리 생성.
    결과: {'주문관리': {'주문조회': {'__screens__': [{'id':..., 'name':..., 'apis':[]}]}}}
    menu_path 없거나 [TBD]인 UIS는 '[{domain}]' 버킷에 분류."""
    tree: dict = {}
    for ui in uis:
        path = [p for p in ui.get('menu_path', []) if p and p != '[TBD]']
        domain = ui.get('domain', 'unknown')
        screen = {'id': ui['id'], 'name': ui['name'], 'apis': ui.get('apis', [])}
        if not path:
            tree.setdefault(f'[{domain}]', {}).setdefault('__screens__', []).append(screen)
            continue
        node = tree
        for i, segment in enumerate(path):
            if i == len(path) - 1:
                node.setdefault(segment, {}).setdefault('__screens__', []).append(screen)
            else:
                node = node.setdefault(segment, {})
    return tree


# ─────────────────── 메인 ───────────────────

def generate_index(spec_root: str, output_path: str) -> dict:
    """전체 스캔 실행 → spec_index.json 저장 → index dict 반환."""
    infs = scan_infs(spec_root)
    uis = scan_uis(spec_root)
    sprint = load_sprint_status(spec_root)

    domains: dict = {}
    for inf in infs:
        d = inf['domain']
        domains.setdefault(d, {'inf': 0, 'uis': 0, 'sch': 0, 'bat': 0, 'tbd_total': 0})
        domains[d]['inf'] += 1
        domains[d]['tbd_total'] += inf['tbd_count']
    for ui in uis:
        d = ui.get('domain', '')
        if d:
            domains.setdefault(d, {'inf': 0, 'uis': 0, 'sch': 0, 'bat': 0, 'tbd_total': 0})
            domains[d]['uis'] += 1
    for d, s in sprint.items():
        if d in domains:
            domains[d]['sprint_done'] = s['done']
            domains[d]['sprint_total'] = s['total']

    index = {
        'generated_at': datetime.now().isoformat(timespec='seconds'),
        'totals': {'inf': len(infs), 'uis': len(uis), 'sch': 0, 'bat': 0},
        'domains': domains,
        'infs': infs,
        'uis': uis,
        'ia_tree': build_ia_tree(uis),
    }

    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    print(f'[OK] spec_index.json 생성 완료')
    print(f'     INF {len(infs)}개 | UIS {len(uis)}개 | 도메인 {len(domains)}개')
    print(f'     → {output_path}')
    return index


if __name__ == '__main__':
    root = sys.argv[1] if len(sys.argv) > 1 else '.'
    out = os.path.join(root, 'docs', 'viewer', 'spec_index.json')
    generate_index(root, out)
```

- [ ] **Step 4: 테스트 실행 — 전체 통과 확인**

```bash
cd D:\gen-harness\plugins\speclinker\scripts
python -m pytest test_gen_docsify.py -v
```

Expected 출력 (예시):
```
test_gen_docsify.py::TestGetFmBlock::test_extracts_block PASSED
test_gen_docsify.py::TestParseFrontmatter::test_parses_basic_keys PASSED
...
23 passed in 0.XXs
```

- [ ] **Step 5: 커밋**

```bash
git -C "D:\gen-harness\plugins\speclinker" add scripts/gen_docsify.py scripts/test_gen_docsify.py
git -C "D:\gen-harness\plugins\speclinker" commit -m "feat: gen_docsify.py — INF/UIS 스캐너 + spec_index.json 생성"
```

---

## Task 2: index.html + sl-theme.css — Docsify 진입점

**Files:**
- Create: `docs/viewer/index.html`
- Create: `docs/viewer/sl-theme.css`

- [ ] **Step 1: index.html 작성**

`docs/viewer/index.html`:

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>⚡ Speclinker Viewer</title>
  <link rel="stylesheet" href="//cdn.jsdelivr.net/npm/docsify@4/lib/themes/dark.css">
  <link rel="stylesheet" href="sl-theme.css">
</head>
<body>
  <div id="app"></div>
  <script>
    window.$docsify = {
      el: '#app',
      name: '⚡ Speclinker',
      repo: '',
      loadSidebar: false,
      loadNavbar: false,
      auto2top: true,
      noEmoji: true,
      search: {
        placeholder: 'INF ID, 경로, 화면명...',
        noData: '검색 결과 없음',
        depth: 3,
      },
    };
  </script>
  <!-- docsify-sl.js 먼저 (플러그인 등록 후 Docsify 초기화) -->
  <script src="docsify-sl.js"></script>
  <script src="//cdn.jsdelivr.net/npm/docsify@4/lib/docsify.min.js"></script>
  <script src="//cdn.jsdelivr.net/npm/docsify/lib/plugins/search.min.js"></script>
</body>
</html>
```

- [ ] **Step 2: sl-theme.css 작성**

`docs/viewer/sl-theme.css`:

```css
/* Speclinker Gold Dark Theme */
:root {
  --bg-primary: #0d1117;
  --bg-secondary: #161b22;
  --bg-tertiary: #21262d;
  --border: #30363d;
  --accent: #d4a574;
  --accent-dim: rgba(212,165,116,0.12);
  --text-primary: #c9d1d9;
  --text-muted: #8b949e;
  --method-get: #1f6feb;
  --method-post: #238636;
  --method-put: #9e6a03;
  --method-delete: #da3633;
  --status-done: #3fb950;
  --status-review: #f0883e;
  --status-prog: #58a6ff;
}

/* Docsify 기본 오버라이드 */
body { background: var(--bg-primary); color: var(--text-primary); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; }
.sidebar, .sidebar-toggle { display: none !important; }
.content { margin-left: 220px !important; background: var(--bg-primary); }
a { color: var(--accent); }
h2 { border-bottom: 1px solid var(--border); padding-bottom: 8px; }
table { border-collapse: collapse; width: 100%; }
th { background: var(--bg-secondary); color: var(--text-muted); font-size: 12px; padding: 6px 10px; border: 1px solid var(--border); }
td { padding: 6px 10px; border: 1px solid var(--border); font-size: 13px; }
tr:hover td { background: var(--bg-tertiary); }
code { background: var(--bg-secondary); color: #79c0ff; padding: 2px 5px; border-radius: 3px; font-size: 12px; }
pre { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; padding: 16px; overflow-x: auto; }
blockquote { border-left: 3px solid var(--border); color: var(--text-muted); padding-left: 12px; margin: 0 0 12px; }

/* 커스텀 사이드바 */
#sl-sidebar {
  position: fixed; top: 0; left: 0;
  width: 220px; height: 100vh;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column;
  overflow-y: auto; z-index: 100; font-size: 13px;
}
#sl-sidebar .sl-logo { color: var(--accent); font-weight: 700; font-size: 15px; padding: 16px; border-bottom: 1px solid var(--border); }
#sl-sidebar .sl-nav-link { display: block; padding: 7px 16px; color: var(--text-muted); text-decoration: none; cursor: pointer; }
#sl-sidebar .sl-nav-link:hover, #sl-sidebar .sl-nav-link.active { color: var(--accent); background: var(--accent-dim); }
#sl-sidebar .sl-section-label { padding: 8px 16px 4px; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); }
#sl-sidebar .sl-toggle { display: flex; gap: 4px; padding: 8px 16px; border-bottom: 1px solid var(--border); }
#sl-sidebar .sl-toggle button { flex: 1; padding: 4px 8px; font-size: 11px; border: 1px solid var(--border); border-radius: 4px; background: transparent; color: var(--text-muted); cursor: pointer; }
#sl-sidebar .sl-toggle button.active { background: var(--accent-dim); color: var(--accent); border-color: var(--accent); }
.sl-domain-item { display: flex; align-items: center; padding: 6px 16px; cursor: pointer; color: var(--text-muted); }
.sl-domain-item:hover { color: var(--text-primary); background: var(--bg-tertiary); }
.sl-domain-item.active { color: var(--accent); background: var(--accent-dim); }
.sl-ia-group { padding: 6px 16px; font-weight: 600; color: var(--text-primary); cursor: pointer; }
.sl-ia-group:hover { background: var(--bg-tertiary); }
.sl-ia-screen { font-size: 12px; cursor: pointer; color: var(--text-muted); }
.sl-ia-screen:hover { color: var(--text-primary); }

/* 메인 콘텐츠 */
#sl-main { margin-left: 220px; min-height: 100vh; }

/* 대시보드 */
.sl-dashboard { padding: 24px; }
.sl-summary-cards { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
.sl-summary-card { flex: 1; min-width: 100px; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 16px; text-align: center; }
.sl-card-num { font-size: 28px; font-weight: 700; }
.sl-card-label { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
.sl-domain-table { width: 100%; border-collapse: collapse; background: var(--bg-secondary); border-radius: 8px; overflow: hidden; }
.sl-progress-bar { background: var(--border); border-radius: 3px; height: 6px; overflow: hidden; min-width: 80px; }
.sl-progress-fill { height: 100%; border-radius: 3px; }

/* 도메인 탭 */
.sl-domain-header { padding: 20px 24px 0; border-bottom: 1px solid var(--border); }
.sl-tabs { display: flex; }
.sl-tab { padding: 8px 20px; border-bottom: 2px solid transparent; cursor: pointer; color: var(--text-muted); font-size: 13px; }
.sl-tab.active { color: var(--accent); border-bottom-color: var(--accent); }

/* INF 목록 */
.sl-inf-list { padding: 16px 24px; }
.sl-inf-card { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 6px; margin-bottom: 6px; cursor: pointer; background: var(--bg-secondary); transition: border-color 0.15s; }
.sl-inf-card:hover { border-color: var(--accent); }
.sl-method-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; color: #fff; min-width: 52px; text-align: center; }
.sl-inf-id { color: var(--text-muted); font-size: 11px; min-width: 110px; }
.sl-inf-path { color: var(--text-muted); font-family: monospace; font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* UIS 그리드 */
.sl-uis-grid { padding: 16px 24px; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.sl-uis-card { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; cursor: pointer; transition: border-color 0.15s; }
.sl-uis-card:hover { border-color: var(--accent); }
.sl-uis-preview { background: var(--bg-tertiary); height: 80px; display: flex; align-items: center; justify-content: center; color: var(--text-muted); font-size: 24px; overflow: hidden; }
.sl-uis-preview img { width: 100%; height: 80px; object-fit: cover; }
.sl-uis-info { padding: 10px 12px; }
.sl-uis-id { color: var(--text-muted); font-size: 11px; }
.sl-uis-name { color: var(--text-primary); font-size: 13px; font-weight: 600; margin: 2px 0; }
.sl-uis-route { color: var(--text-muted); font-family: monospace; font-size: 11px; }

/* Quick Nav */
#sl-quick-nav { position: fixed; right: 0; top: 0; width: 175px; height: 100vh; background: var(--bg-secondary); border-left: 1px solid var(--border); padding: 16px 12px; font-size: 12px; overflow-y: auto; z-index: 50; }
#sl-quick-nav .sl-qnav-title { color: var(--accent); font-weight: 600; margin-bottom: 10px; font-size: 12px; }
#sl-quick-nav a { display: block; color: var(--text-muted); text-decoration: none; padding: 3px 0; line-height: 1.4; }
#sl-quick-nav a:hover { color: var(--text-primary); }
#sl-quick-nav a.sl-hl { color: var(--accent); }
.content.has-qnav { margin-right: 175px !important; }

/* 크로스링크 */
.sl-xlink { color: var(--accent) !important; text-decoration: none !important; border-bottom: 1px dashed var(--accent); cursor: pointer; }
```

- [ ] **Step 3: 브라우저에서 기본 로드 확인**

```bash
cd D:\gen-harness\plugins\speclinker\docs\viewer
python -m http.server 5173
```

브라우저에서 `http://localhost:5173` 접속 — Docsify 기본 페이지 로드 확인 (아직 `docsify-sl.js` 없어서 404 오류 예상, 정상)

- [ ] **Step 4: 커밋**

```bash
git -C "D:\gen-harness\plugins\speclinker" add docs/viewer/index.html docs/viewer/sl-theme.css
git -C "D:\gen-harness\plugins\speclinker" commit -m "feat: Docsify viewer 진입점 — index.html + 골드 다크 테마"
```

---

## Task 3: docsify-sl.js — 초기화 + 사이드바 + 대시보드

**Files:**
- Create: `docs/viewer/docsify-sl.js`

- [ ] **Step 1: docsify-sl.js 작성 (초기화 + 사이드바 + 대시보드)**

`docs/viewer/docsify-sl.js`:

```javascript
/* docsify-sl.js — Speclinker Docsify 커스텀 플러그인 v1.0 */
(function () {
  'use strict';

  // ── 상태 ──────────────────────────────────────────────────
  let INDEX = null;
  let ACTIVE_DOMAIN = null;
  let ACTIVE_TAB = 'inf';
  let SIDEBAR_MODE = 'domain'; // 'domain' | 'ia'

  // ── 인덱스 로드 ────────────────────────────────────────────
  async function loadIndex() {
    try {
      const res = await fetch('spec_index.json?_=' + Date.now());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      INDEX = await res.json();
      renderSidebar();
      renderDashboard();
    } catch (e) {
      document.getElementById('sl-main').innerHTML =
        `<div style="padding:40px;color:var(--text-muted);text-align:center">
          <h3 style="color:var(--accent)">spec_index.json 없음</h3>
          <p>프로젝트 루트에서 다음을 실행하세요:</p>
          <code>python scripts/gen_docsify.py .</code>
          <p style="font-size:12px;margin-top:16px">오류: ${e.message}</p>
        </div>`;
    }
  }

  // ── 사이드바 ────────────────────────────────────────────────
  function renderSidebar() {
    const sidebar = document.getElementById('sl-sidebar');
    if (!sidebar) return;

    const listHtml = SIDEBAR_MODE === 'domain'
      ? renderDomainList()
      : renderIaTree();

    sidebar.innerHTML = `
      <div class="sl-logo">⚡ Speclinker</div>
      <div>
        <span class="sl-nav-link" onclick="SlViewer.showDashboard()">🏠 대시보드</span>
        <a class="sl-nav-link" href="#/docs/00_FUNC/FUNC_MAP">📋 FUNC_MAP</a>
        <span class="sl-nav-link" onclick="SlViewer.openSpec('.speclinker/sprint-status.yaml')">⚡ Sprint</span>
      </div>
      <div class="sl-toggle">
        <button class="${SIDEBAR_MODE === 'domain' ? 'active' : ''}"
                onclick="SlViewer.setSidebarMode('domain')">도메인</button>
        <button class="${SIDEBAR_MODE === 'ia' ? 'active' : ''}"
                onclick="SlViewer.setSidebarMode('ia')">IA 트리</button>
      </div>
      <div class="sl-section-label">${SIDEBAR_MODE === 'domain' ? '도메인' : '메뉴 계층'}</div>
      <div id="sl-sidebar-list">${listHtml}</div>`;
  }

  function renderDomainList() {
    if (!INDEX) return '<div style="padding:8px 16px;color:var(--text-muted);font-size:12px">로딩 중...</div>';
    return Object.entries(INDEX.domains).map(([name, info]) =>
      `<div class="sl-domain-item ${ACTIVE_DOMAIN === name ? 'active' : ''}"
            onclick="SlViewer.selectDomain('${name}')">
        <span style="flex:1">${name}</span>
        <span style="font-size:11px;color:var(--text-muted)">${info.inf || 0}</span>
      </div>`
    ).join('');
  }

  function renderIaTree() {
    if (!INDEX || !INDEX.ia_tree) return '<div style="padding:8px 16px;color:var(--text-muted);font-size:12px">메뉴 정보 없음</div>';
    return renderIaNode(INDEX.ia_tree, 0);
  }

  function renderIaNode(node, depth) {
    if (!node) return '';
    return Object.entries(node).map(([key, value]) => {
      if (key === '__screens__') return '';
      const indent = depth * 14 + 16;
      const screens = (value.__screens__ || []).map(s =>
        `<div class="sl-ia-screen" style="padding:3px ${indent + 12}px 3px ${indent + 20}px"
              onclick="SlViewer.navigateToScreen('${s.id}')">
          <span style="font-size:10px;color:var(--text-muted)">UIS</span> ${s.name || s.id}
         </div>`
      ).join('');
      const children = renderIaNode(
        Object.fromEntries(Object.entries(value).filter(([k]) => k !== '__screens__')),
        depth + 1
      );
      return `<div class="sl-ia-group" style="padding-left:${indent}px">▸ ${key}</div>
              ${screens}${children}`;
    }).join('');
  }

  // ── 대시보드 ────────────────────────────────────────────────
  function renderDashboard() {
    const main = document.getElementById('sl-main');
    if (!main || !INDEX) return;
    removeQuickNav();
    ACTIVE_DOMAIN = null;
    renderSidebar();

    const t = INDEX.totals;
    const cards = [
      { num: t.inf, label: 'INF', color: 'var(--status-prog)' },
      { num: t.uis, label: 'UIS', color: 'var(--accent)' },
      { num: t.sch, label: 'SCH', color: 'var(--status-done)' },
      { num: t.bat, label: 'BAT', color: 'var(--status-review)' },
    ].map(c => `
      <div class="sl-summary-card">
        <div class="sl-card-num" style="color:${c.color}">${c.num}</div>
        <div class="sl-card-label">${c.label}</div>
      </div>`).join('');

    const rows = Object.entries(INDEX.domains).map(([name, d]) => {
      const infTotal = d.inf || 0;
      const tbd = d.tbd_total || 0;
      const specPct = infTotal > 0 ? Math.round(((infTotal - Math.min(tbd, infTotal)) / infTotal) * 100) : 0;
      const spTotal = d.sprint_total || 0;
      const spPct = spTotal > 0 ? Math.round(((d.sprint_done || 0) / spTotal) * 100) : 0;
      const spColor = spPct >= 80 ? 'var(--status-done)' : spPct >= 40 ? 'var(--accent)' : 'var(--status-review)';
      return `
        <tr onclick="SlViewer.selectDomain('${name}')" style="cursor:pointer">
          <td style="color:var(--accent);font-weight:600">${name}</td>
          <td style="text-align:center;color:var(--status-prog)">${d.inf || 0}</td>
          <td style="text-align:center;color:var(--accent)">${d.uis || 0}</td>
          <td style="text-align:center;color:var(--status-done)">${d.sch || 0}</td>
          <td style="text-align:center;color:var(--status-review)">${d.bat || 0}</td>
          <td>
            <div style="display:flex;align-items:center;gap:6px">
              <div class="sl-progress-bar" style="flex:1">
                <div class="sl-progress-fill" style="width:${specPct}%;background:var(--status-prog)"></div>
              </div>
              <span style="font-size:11px;color:var(--text-muted);min-width:32px">${specPct}%</span>
            </div>
          </td>
          <td>
            <div style="display:flex;align-items:center;gap:6px">
              <div class="sl-progress-bar" style="flex:1">
                <div class="sl-progress-fill" style="width:${spPct}%;background:${spColor}"></div>
              </div>
              <span style="font-size:11px;color:var(--text-muted);min-width:32px">${spPct}%</span>
            </div>
          </td>
        </tr>`;
    }).join('');

    main.innerHTML = `
      <div class="sl-dashboard">
        <h2 style="color:var(--accent);margin-top:0">📊 Speclinker Dashboard</h2>
        <div class="sl-summary-cards">${cards}</div>
        <table class="sl-domain-table">
          <thead><tr>
            <th style="text-align:left">도메인</th>
            <th>INF</th><th>UIS</th><th>SCH</th><th>BAT</th>
            <th>스펙완성도</th><th>개발완료율</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:12px;font-size:11px;color:var(--text-muted)">
          생성: ${INDEX.generated_at} &nbsp;—&nbsp;
          <code>python scripts/gen_docsify.py .</code> 로 갱신
        </div>
      </div>`;
  }

  // ── INF / UIS 도메인 탭 뷰 ──────────────────────────────────
  function renderDomainView(domain, tab) {
    ACTIVE_DOMAIN = domain;
    ACTIVE_TAB = tab || 'inf';
    const main = document.getElementById('sl-main');
    if (!main || !INDEX) return;
    removeQuickNav();
    renderSidebar();

    const d = INDEX.domains[domain] || {};
    const tabs = ['inf', 'uis', 'sch', 'bat'].map(t =>
      `<div class="sl-tab ${ACTIVE_TAB === t ? 'active' : ''}"
            onclick="SlViewer.selectTab('${t}')">${t.toUpperCase()} ${d[t] || 0}</div>`
    ).join('');

    let body = '';
    if (ACTIVE_TAB === 'inf') {
      const infs = (INDEX.infs || []).filter(i => i.domain === domain);
      body = `<div class="sl-inf-list">${infs.map(renderInfCard).join('') || '<div style="padding:16px;color:var(--text-muted)">INF 파일 없음</div>'}</div>`;
    } else if (ACTIVE_TAB === 'uis') {
      const uis = (INDEX.uis || []).filter(u => u.domain === domain);
      body = `<div class="sl-uis-grid">${uis.map(renderUisCard).join('') || '<div style="padding:16px;color:var(--text-muted)">UIS 파일 없음</div>'}</div>`;
    } else {
      body = `<div style="padding:24px;color:var(--text-muted)">SCH/BAT 뷰 — 준비 중</div>`;
    }

    main.innerHTML = `
      <div class="sl-domain-header">
        <h3 style="color:var(--accent);margin:0 0 12px">${domain}</h3>
        <div class="sl-tabs">${tabs}</div>
      </div>
      ${body}`;
  }

  function renderInfCard(inf) {
    const colors = { GET: 'var(--method-get)', POST: 'var(--method-post)', PUT: 'var(--method-put)', DELETE: 'var(--method-delete)' };
    const bg = colors[inf.method] || '#555';
    return `
      <div class="sl-inf-card" onclick="SlViewer.openSpec('${inf.file}')">
        <span class="sl-method-badge" style="background:${bg}">${inf.method || '?'}</span>
        <span class="sl-inf-id">${inf.id}</span>
        <span class="sl-inf-path">${inf.path || ''}</span>
      </div>`;
  }

  function renderUisCard(ui) {
    const previewSrc = ui.file.replace('spec.md', 'preview.png');
    const preview = ui.has_preview
      ? `<img src="${previewSrc}" alt="preview" onerror="this.parentNode.innerHTML='🖥️'">`
      : '🖥️';
    return `
      <div class="sl-uis-card" onclick="SlViewer.openSpec('${ui.file}')">
        <div class="sl-uis-preview">${preview}</div>
        <div class="sl-uis-info">
          <div class="sl-uis-id">${ui.id}</div>
          <div class="sl-uis-name">${ui.name || '-'}</div>
          <div class="sl-uis-route">${ui.route || ''}</div>
        </div>
      </div>`;
  }

  // ── Quick Nav ────────────────────────────────────────────────
  function injectQuickNav() {
    removeQuickNav();
    const headings = document.querySelectorAll('.markdown-section h2, .markdown-section h3');
    if (headings.length < 2) return;

    const highlights = ['비즈니스 규칙', '트랜잭션 순서', '사이드이펙트'];
    const links = Array.from(headings).map(h => {
      const text = h.textContent.trim();
      const isHl = highlights.some(kw => text.includes(kw));
      const id = h.id || text;
      return `<a href="#${encodeURIComponent(id)}" class="${isHl ? 'sl-hl' : ''}"
                 onclick="document.getElementById('${id}')?.scrollIntoView({behavior:'smooth'});return false"
              >${text}</a>`;
    }).join('');

    const nav = document.createElement('div');
    nav.id = 'sl-quick-nav';
    nav.innerHTML = `<div class="sl-qnav-title">Quick Nav</div>${links}`;
    document.body.appendChild(nav);
    document.querySelector('.content')?.classList.add('has-qnav');
  }

  function removeQuickNav() {
    document.getElementById('sl-quick-nav')?.remove();
    document.querySelector('.content')?.classList.remove('has-qnav');
  }

  // ── 크로스링크 ────────────────────────────────────────────────
  function addCrosslinks() {
    const section = document.querySelector('.markdown-section');
    if (!section) return;
    const pattern = /\b(INF-[A-Z]+-\d+|UIS-F-\d+|SCH-[A-Z]+-\d+|FUNC-[a-z]+-\d+)\b/g;
    section.querySelectorAll('p, li, td').forEach(el => {
      if (el.querySelector('a, code, .sl-xlink')) return;
      const orig = el.innerHTML;
      const replaced = orig.replace(pattern, m =>
        `<span class="sl-xlink" onclick="SlViewer.goToId('${m}')" title="${m}로 이동">${m}</span>`
      );
      if (replaced !== orig) el.innerHTML = replaced;
    });
  }

  // ── 공개 API ──────────────────────────────────────────────────
  window.SlViewer = {
    showDashboard() { renderDashboard(); },
    selectDomain(domain) { renderDomainView(domain, 'inf'); },
    selectTab(tab) { renderDomainView(ACTIVE_DOMAIN, tab); },
    setSidebarMode(mode) { SIDEBAR_MODE = mode; renderSidebar(); },
    openSpec(filePath) { window.location.hash = '#/' + filePath; },
    navigateToScreen(uisId) {
      const ui = INDEX?.uis?.find(u => u.id === uisId);
      if (ui) this.openSpec(ui.file);
    },
    goToId(id) {
      const inf = INDEX?.infs?.find(i => i.id === id);
      if (inf) { this.openSpec(inf.file); return; }
      const ui = INDEX?.uis?.find(u => u.id === id);
      if (ui) { this.openSpec(ui.file); }
    },
  };

  // ── Docsify 플러그인 등록 ──────────────────────────────────────
  function SlPlugin(hook) {
    hook.mounted(function () {
      // 커스텀 사이드바 + 메인 영역 DOM 주입
      document.body.insertAdjacentHTML('afterbegin',
        '<div id="sl-sidebar"></div><div id="sl-main"></div>');
      loadIndex();
    });

    hook.doneEach(function () {
      // .md 파일을 Docsify가 렌더링한 직후 Quick Nav + 크로스링크 적용
      const hash = window.location.hash || '';
      if (hash.includes('/INF-') || hash.includes('/spec')) {
        setTimeout(() => { injectQuickNav(); addCrosslinks(); }, 150);
      }
    });
  }

  window.$docsify = window.$docsify || {};
  window.$docsify.plugins = (window.$docsify.plugins || []).concat([SlPlugin]);
})();
```

- [ ] **Step 2: spec_index.json 샘플 생성 (테스트용)**

speclinker 플러그인 루트에서:

```bash
cd D:\gen-harness\plugins\speclinker
python scripts/gen_docsify.py .
```

Expected:
```
[OK] spec_index.json 생성 완료
     INF 0개 | UIS 0개 | 도메인 0개
     → docs/viewer/spec_index.json
```

(실제 INF/UIS 없어도 파일 생성 확인)

- [ ] **Step 3: 브라우저에서 대시보드 확인**

```bash
cd D:\gen-harness\plugins\speclinker\docs\viewer
python -m http.server 5173
```

`http://localhost:5173` 접속 후:
- 왼쪽 골드 사이드바 표시 확인
- "📊 Speclinker Dashboard" 헤더 표시 확인
- "spec_index.json 없음" 오류가 아닌 빈 대시보드 표시 확인

- [ ] **Step 4: 커밋**

```bash
git -C "D:\gen-harness\plugins\speclinker" add docs/viewer/docsify-sl.js docs/viewer/spec_index.json
git -C "D:\gen-harness\plugins\speclinker" commit -m "feat: docsify-sl.js — 사이드바 + 대시보드 + INF/UIS 탭 뷰 구현"
```

---

## Task 4: ddd-ui-agent.md — menu-path frontmatter 추가

**Files:**
- Modify: `agents/ddd-ui-agent.md`

- [ ] **Step 1: frontmatter 템플릿에 menu-path 필드 추가**

`agents/ddd-ui-agent.md`에서 아래 텍스트를 찾아 교체:

찾는 텍스트 (라인 ~379):
```
---
화면ID: {화면ID}
화면명: {화면명}
라우트: {route}
도메인: {domain}
REQ-F: {[TBD] | REQ-F-XXX}
UIS-ID: UIS-F-{uisId:03d}
apis:
```

교체 텍스트:
```
---
화면ID: {화면ID}
화면명: {화면명}
라우트: {route}
도메인: {domain}
REQ-F: {[TBD] | REQ-F-XXX}
UIS-ID: UIS-F-{uisId:03d}
menu-path:
  - {메뉴 1단계}   # 예: 주문관리. 추론 불가 시 [TBD]
  - {메뉴 2단계}   # 예: 주문조회. 1단계만 있으면 이 줄 제거
apis:
```

- [ ] **Step 2: Phase 3 (라우터 파싱) 후에 menu-path 추론 지시 추가**

`agents/ddd-ui-agent.md`에서 Phase 6 화면명 결정 섹션을 찾아 그 앞에 삽입:

찾는 텍스트: `## Phase 6`

삽입 내용 (Phase 6 바로 위에 삽입):

```markdown
---

## Phase 5.5: menu-path 추론

`spec.md` frontmatter의 `menu-path` 필드를 아래 우선순위로 채운다:

1. **메뉴 설정 파일 우선**: `menu.js`, `router.js`, `routes.js`, `navigation.js` 등에서 `title` / `label` / `meta.title` 필드 확인 → `라우트:`와 매핑
2. **URL 계층 분해**: `/order/list` → `['주문관리', '주문 목록']` (영문 세그먼트를 한국어로 번역)  
   - `order` → `주문관리`, `product` → `상품관리`, `user` → `회원관리`, `delivery` → `배송관리`  
   - URL 세그먼트에서 추론 불가하면 `[TBD]` 기입
3. **TabMode**: 부모 화면의 menu-path를 그대로 상속

> 확신하기 어려우면 `[TBD]` 기입. 잘못된 메뉴명보다 [TBD]가 낫다.
```

- [ ] **Step 3: Self-Critique 항목 추가**

파일 끝의 Self-Critique 체크리스트에 추가:

찾는 텍스트:
```
[ ] frontmatter `related-screens:` 필드가 있는가?
```

그 아래에 추가:
```
[ ] frontmatter `menu-path:` 필드가 있는가?
    → Phase 5.5 추론 결과. 추론 불가이면 `[TBD]` 기입 (빈 배열 금지)
```

- [ ] **Step 4: 변경 확인 후 커밋**

```bash
grep -n "menu-path" "D:\gen-harness\plugins\speclinker\agents\ddd-ui-agent.md"
```

Expected: `menu-path:` 관련 라인 3~4개 출력

```bash
git -C "D:\gen-harness\plugins\speclinker" add agents/ddd-ui-agent.md
git -C "D:\gen-harness\plugins\speclinker" commit -m "feat(ddd-ui-agent): menu-path frontmatter 추가 — IA 트리 빌드 재료"
```

---

## Task 5: skills/sl-ia/SKILL.md — IA 문서 생성 스킬

**Files:**
- Create: `skills/sl-ia/SKILL.md`

- [ ] **Step 1: 디렉터리 생성 후 SKILL.md 작성**

```bash
mkdir "D:\gen-harness\plugins\speclinker\skills\sl-ia"
```

`skills/sl-ia/SKILL.md`:

```markdown
---
name: sl-ia
description: RECON 산출물 기반 IA(Information Architecture) 문서 자동 생성 + UIS menu-path 일괄 보완
argument-hint: [도메인명 | --update-only]
---

# /sl-ia — IA 문서 생성

route 파일 분석 + 기존 UIS spec.md를 기반으로 메뉴 계층 문서(`IA_MAP.md`)를 생성하고,
UIS `spec.md`의 `menu-path:` 필드를 일괄 보완한다.

**생성 결과:**
- `docs/00_IA/IA_MAP.md` — 메뉴 트리 → 화면 → INF 링크 테이블
- 기존 UIS `spec.md`의 `menu-path:` 업데이트

---

## 전제 조건 확인

```bash
!python -c "
import os, sys
try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except: pass
uis_root = 'docs/05_설계서/UIS'
if not os.path.isdir(uis_root):
    print('[FAIL] docs/05_설계서/UIS/ 없음 → /sl-recon-uis 먼저 실행')
    sys.exit(1)
count = sum(1 for e in os.listdir(uis_root) if os.path.isfile(os.path.join(uis_root, e, 'spec.md')))
print(f'[OK] UIS spec.md {count}개 발견')
"
```

---

## STEP 1 — route 파일 스캔

다음 파일 패턴을 순서대로 탐색:
1. `src/**/router*.{js,ts}`, `src/**/routes*.{js,ts}` — SPA 라우터
2. `src/**/menu*.{js,ts,json}`, `src/**/navigation*.{js,ts}` — 메뉴 설정
3. `src/**/pages/**/*.{vue,tsx,jsx}` + Next.js `app/**/page.tsx` — 파일 기반 라우팅
4. `**/*.xml` with `<url-mapping>` or `@RequestMapping` in `**/*Controller.java` — Spring MVC

발견한 파일에서 **경로 → 메뉴명 매핑**을 추출한다:
- `{ path: '/order/list', name: '주문 목록', meta: { title: '주문 목록' } }` → `order > 주문 목록`
- `<url-pattern>/order/list</url-pattern>` + JSP title 태그 → `order > 주문 목록`

추출 결과를 임시 dict로 보관: `{ '/order/list': ['주문관리', '주문 목록'] }`

> 메뉴명을 찾지 못한 경로: URL 세그먼트를 한국어로 번역해 추론 (order→주문관리 등).
> 완전히 불명확한 경우 `[TBD]`.

---

## STEP 2 — UIS spec.md menu-path 업데이트

`docs/05_설계서/UIS/` 하위 모든 `spec.md`를 순서대로 처리:

1. `라우트:` frontmatter 값 읽기
2. STEP 1 dict에서 해당 경로의 menu-path 조회
3. 기존 `menu-path:` 필드가 `[TBD]`이거나 없으면 → 추론값으로 교체
4. 이미 값이 있으면 → 변경하지 않음 (수동 입력 보호)

각 파일 업데이트 후 "UIS-F-031: [주문관리, 주문조회] 업데이트" 형식으로 로그 출력.

---

## STEP 3 — IA_MAP.md 생성

```bash
!python -c "
import os, sys, re
try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except: pass

def get_fm(content):
    import re
    m = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    return m.group(1) if m else ''

def extract_list(block, key):
    result, in_list = [], False
    for line in block.splitlines():
        if re.match(rf'^{re.escape(key)}:\s*$', line.rstrip()):
            in_list = True
            continue
        if in_list:
            s = line.strip()
            if s.startswith('- '):
                val = s[2:].split('#')[0].strip()
                if val: result.append(val)
            elif s and not line.startswith(' '): break
    return result

def simple_parse(block, key):
    for line in block.splitlines():
        if ':' in line and not line.startswith(' '):
            k, _, v = line.partition(':')
            if k.strip() == key: return v.strip()
    return ''

uis_root = 'docs/05_설계서/UIS'
rows = []
for entry in sorted(os.listdir(uis_root)):
    spec = os.path.join(uis_root, entry, 'spec.md')
    if not os.path.isfile(spec): continue
    c = open(spec, encoding='utf-8', errors='replace').read()
    fb = get_fm(c)
    uis_id = simple_parse(fb, 'UIS-ID') or entry
    name = simple_parse(fb, '화면명') or '-'
    route = simple_parse(fb, '라우트') or '-'
    mp = extract_list(fb, 'menu-path')
    apis = extract_list(fb, 'apis')
    menu_str = ' > '.join(mp) if mp and mp[0] != '[TBD]' else '[미분류]'
    api_str = ', '.join(apis[:3]) + ('...' if len(apis) > 3 else '') if apis else '-'
    rows.append(f'| {menu_str} | {uis_id} | {name} | {api_str} | {route} |')

os.makedirs('docs/00_IA', exist_ok=True)
out = ['# IA_MAP\n',
       '| 메뉴 경로 | 화면ID | 화면명 | INF | 라우트 |',
       '|---------|-------|------|-----|------|'] + rows
open('docs/00_IA/IA_MAP.md', 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print(f'[OK] IA_MAP.md 생성 — {len(rows)}개 화면')
print('     → docs/00_IA/IA_MAP.md')
"
```

---

## STEP 4 — spec_index.json 갱신

```bash
!python {PLUGIN_PATH}/scripts/gen_docsify.py .
```

뷰어를 이미 열어 두었다면 브라우저 새로고침으로 IA 트리 반영 확인.

---

## 완료 보고

- `docs/00_IA/IA_MAP.md` 생성 완료
- 업데이트된 UIS `spec.md` 목록 출력
- `spec_index.json` 갱신 완료
- `/sl-viewer`로 IA 트리 모드에서 결과 확인 안내
```

- [ ] **Step 2: 커밋**

```bash
git -C "D:\gen-harness\plugins\speclinker" add skills/sl-ia/SKILL.md
git -C "D:\gen-harness\plugins\speclinker" commit -m "feat: /sl-ia 스킬 — IA_MAP.md 생성 + UIS menu-path 일괄 보완"
```

---

## Task 6: 플러그인 등록 마무리

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.claude-plugin/plugin.json`
- Modify: `skills/sl-viewer/SKILL.md`

- [ ] **Step 1: CLAUDE.md — /sl-ia 라우팅 추가**

`CLAUDE.md`에서 `/sl-drift` 행을 찾아 그 아래에 추가:

찾는 텍스트:
```
| `/sl-drift [도메인] [--since Nd]` | `skills/sl-drift/SKILL.md` | git 저장소, docs/05_설계서/ INF | SDD 유지 |
```

그 다음 줄에 추가:
```
| `/sl-ia [도메인\|--update-only]` | `skills/sl-ia/SKILL.md` | docs/05_설계서/UIS/ spec.md 존재 | RECON 후 |
```

- [ ] **Step 2: CLAUDE.md — sl-viewer 설명 업데이트**

상황별 파이프라인 SDD 전체 파이프라인 행을 찾아 교체:

찾는 텍스트:
```
| **SDD 전체 파이프라인** | sl-recon → **sl-context** → sl-sprint → sl-plan → sl-analyze → sl-change → sl-check → **sl-dev** → sl-review → sl-test |
```

교체 텍스트:
```
| **SDD 전체 파이프라인** | sl-recon → **sl-ia** → **sl-context** → sl-sprint → sl-plan → sl-analyze → sl-change → sl-check → **sl-dev** → sl-review → sl-test |
```

- [ ] **Step 3: CLAUDE.md — 버전 노트 추가**

`v2.51:` 으로 시작하는 줄을 찾아 그 앞에 추가:

```
> v2.52: Docsify 웹 뷰어 구현 — gen_docsify.py(스캔→spec_index.json) + docsify-sl.js(대시보드·INF/UIS 탭·Quick Nav·크로스링크·IA 트리) + /sl-ia(IA_MAP.md 자동생성+menu-path 보완). sl-viewer Obsidian→Docsify 교체.
```

- [ ] **Step 4: plugin.json — sl-ia 등록 + 버전 bump**

`plugin.json`에서:

1. `"./skills/sl-quick"` 행 다음에 추가:
```json
    "./skills/sl-ia"
```

2. `"version": "2.51.0"` → `"version": "2.52.0"` 으로 변경

- [ ] **Step 5: sl-viewer/SKILL.md — Docsify 방식으로 교체**

`skills/sl-viewer/SKILL.md`의 전체 내용을 아래로 교체:

```markdown
---
name: sl-viewer
description: speclinker 산출물 Docsify 웹 뷰어 실행 (대시보드·INF/UIS·IA 트리)
argument-hint: [port]
---

# /sl-viewer — 스펙 웹 뷰어 실행

speclinker RECON 산출물을 브라우저에서 탐색하는 Docsify 뷰어를 시작한다.

> 구 Obsidian 기반 뷰어(`gen_obsidian_index.py`)는 deprecated — 이 스킬로 대체됨.

---

## STEP 1 — spec_index.json 갱신

```bash
!python {PLUGIN_PATH}/scripts/gen_docsify.py .
```

---

## STEP 2 — 뷰어 서버 시작

```bash
!python -m http.server {port|5173} --directory {PLUGIN_PATH}/docs/viewer
```

또는 프로젝트별 뷰어가 있으면:

```bash
!python -m http.server {port|5173} --directory docs/viewer
```

---

## 사용 방법

브라우저에서 `http://localhost:5173` 접속:

- **대시보드**: 도메인별 INF/UIS 수 + 스펙완성도/개발완료율
- **도메인 탭**: 사이드바에서 도메인 선택 → INF/UIS/SCH/BAT 탭 전환
- **INF 상세**: INF 카드 클릭 → Docsify 렌더링 + 우측 Quick Nav
- **IA 트리**: 사이드바 [IA 트리] 버튼 → 메뉴 계층으로 화면 탐색

**spec_index.json 최신화**: 새 INF/UIS 생성 후 STEP 1 재실행 → 브라우저 새로고침.
```

- [ ] **Step 6: 최종 확인 후 커밋**

```bash
grep -c "sl-ia" "D:\gen-harness\plugins\speclinker\.claude-plugin\plugin.json"
grep -c "sl-ia" "D:\gen-harness\plugins\speclinker\CLAUDE.md"
```

Expected: 각각 `1`

```bash
git -C "D:\gen-harness\plugins\speclinker" add CLAUDE.md .claude-plugin/plugin.json skills/sl-viewer/SKILL.md
git -C "D:\gen-harness\plugins\speclinker" commit -m "feat: v2.52.0 — sl-ia 등록 + sl-viewer Docsify 교체 + CLAUDE.md 업데이트"
```

---

## Self-Review

**Spec coverage 체크:**

| 설계 섹션 | 구현 태스크 |
|-----------|-----------|
| §1 레이아웃 (하이브리드 C) | Task 3 — 사이드바 + 도메인 탭 |
| §2 테마 골드 다크 | Task 2 — sl-theme.css CSS 변수 |
| §3 대시보드 (요약 + 매트릭스) | Task 3 — renderDashboard() |
| §4 INF 렌더링 (카드 + Quick Nav) | Task 3 — renderInfCard(), Task 3 — injectQuickNav() |
| §5 UIS 렌더링 (카드 + preview) | Task 3 — renderUisCard() |
| §6 크로스링크 | Task 3 — addCrosslinks() |
| §7 검색 | Task 2 — Docsify 내장 search 플러그인 로드 |
| §8 IA 네비게이션 | Task 3 — renderIaTree(), Task 4 — menu-path 필드 |
| §9 /sl-ia 스킬 | Task 5 |
| §10 gen_docsify.py 파싱 계약 | Task 1 |
| §11 뷰어 실행 통합 | Task 6 — sl-viewer 교체 |
| §12 파일 목록 | 전체 태스크 커버 |

**갭 없음** — 모든 설계 요구사항이 태스크에 매핑됨.

**Placeholder 스캔:** TBD/TODO 없음.

**타입 일관성:**
- `INDEX.infs[].domain` ↔ `INDEX.domains` 키 — 동일 소스 (`scan_infs`의 `fm.get('domain', domain_dir)`)
- `SlViewer.openSpec(filePath)` ↔ `inf.file` / `ui.file` — `os.path.relpath(…).replace('\\', '/')` 형식 일치
- `build_ia_tree` `__screens__` 키 ↔ `renderIaNode`의 `value.__screens__` — 일치
