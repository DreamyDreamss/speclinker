import sys, os, json, tempfile, unittest
sys.path.insert(0, os.path.dirname(__file__))

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

    def test_handles_crlf_line_endings(self):
        from gen_docsify import _get_fm_block
        crlf_content = "---\r\ninf-id: INF-ORD-011\r\nmethod: POST\r\n---\r\n# Title"
        block = _get_fm_block(crlf_content)
        self.assertIn('inf-id: INF-ORD-011', block)


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
        self.assertEqual(count_tbd(INF_SAMPLE), 1)

    def test_ignores_frontmatter_tbd(self):
        from gen_docsify import count_tbd
        content = '---\nreq-f: [TBD]\nsrs-f: [TBD]\n---\n# Title'
        self.assertEqual(count_tbd(content), 0)

    def test_counts_multiple_in_body(self):
        from gen_docsify import count_tbd
        content = '---\nid: X\n---\n[TBD] and [TBD] and [TBD]'
        self.assertEqual(count_tbd(content), 3)

    def test_handles_crlf_content(self):
        from gen_docsify import count_tbd
        content = "---\r\nreq-f: [TBD]\r\n---\r\n## Section\r\n[TBD] here\r\n"
        self.assertEqual(count_tbd(content), 1)


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
