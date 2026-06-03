import sys, os, json, tempfile, unittest
sys.path.insert(0, os.path.dirname(__file__))


# ─────────────────────────────────────────────────────────────
# 범용 도메인 분류: relPath 디렉토리(모든 스택 공통)를 1차 신호로 사용.
# Java Spring + Next.js 두 스택 모두 검증.
# 알고리즘: 라우트 보유 파일의 디렉토리 LCP 제거 → 첫 의미 세그먼트 = 도메인.
#           과반(>50%) 차지하는 거대 모듈은 1단계 하강.
# ─────────────────────────────────────────────────────────────


class TestDirParts(unittest.TestCase):
    def test_strips_filename_and_normalizes(self):
        from build_domain_catalog import dir_parts
        self.assertEqual(
            dir_parts('src\\main\\java\\Foo.java'),
            ['src', 'main', 'java'])

    def test_forward_slash(self):
        from build_domain_catalog import dir_parts
        self.assertEqual(dir_parts('src/pages/admin/x.tsx'),
                         ['src', 'pages', 'admin'])


class TestLongestCommonPrefix(unittest.TestCase):
    def test_common(self):
        from build_domain_catalog import longest_common_prefix
        seqs = [['a', 'b', 'c'], ['a', 'b', 'd'], ['a', 'b', 'e']]
        self.assertEqual(longest_common_prefix(seqs), ['a', 'b'])

    def test_diverge_at_root(self):
        from build_domain_catalog import longest_common_prefix
        seqs = [['a', 'x'], ['b', 'y']]
        self.assertEqual(longest_common_prefix(seqs), [])

    def test_single(self):
        from build_domain_catalog import longest_common_prefix
        self.assertEqual(longest_common_prefix([['a', 'b', 'c']]), ['a', 'b', 'c'])

    def test_empty(self):
        from build_domain_catalog import longest_common_prefix
        self.assertEqual(longest_common_prefix([]), [])


class TestDomainOf(unittest.TestCase):
    def test_first_meaningful_after_lcp(self):
        from build_domain_catalog import domain_of
        # parts after lcp removed: ['admin','product','prdreg','controller']
        d = domain_of(['admin', 'product', 'prdreg', 'controller'], skip=0)
        self.assertEqual(d, 'admin')

    def test_skip_one_for_module_descent(self):
        from build_domain_catalog import domain_of
        d = domain_of(['admin', 'product', 'prdreg', 'controller'], skip=1)
        self.assertEqual(d, 'product')

    def test_skips_layer_keyword(self):
        from build_domain_catalog import domain_of
        # 'controller' is layer → first meaningful is 'order'
        d = domain_of(['controller', 'order'], skip=0)
        self.assertEqual(d, 'order')

    def test_root_when_no_meaningful(self):
        from build_domain_catalog import domain_of
        self.assertEqual(domain_of(['controller'], skip=0), '(root)')

    def test_root_when_skip_exceeds(self):
        from build_domain_catalog import domain_of
        self.assertEqual(domain_of(['admin'], skip=1), '(root)')


class TestStackDetection(unittest.TestCase):
    def test_detects_nextjs_by_marker(self):
        from build_domain_catalog import detect_stack
        files = [{'relPath': 'src/pages/admin/x.tsx', 'routes': [{'kind': 'form', 'path': '/admin/x'}]}]
        self.assertEqual(detect_stack(files), 'nextjs')

    def test_detects_java_by_package(self):
        from build_domain_catalog import detect_stack
        files = [{'relPath': 'src/main/java/com/co/order/OrderController.java',
                  'package': 'com.co.order.controller',
                  'routes': [{'kind': 'form', 'path': '/order/list'}]}]
        self.assertEqual(detect_stack(files), 'java')


class TestBuildCatalogNextjs(unittest.TestCase):
    def _idx(self):
        # Next.js: scan_source가 inferFileBasedRoutes로 routes를 채운 상태
        def f(rel, path, kind='form'):
            return {'type': 'controller', 'package': '', 'relPath': rel,
                    'routes': [{'method': 'ANY', 'path': path, 'handlerMethod': '', 'kind': kind}]}
        return {'contextPath': None, 'files': [
            f('src/pages/admin/admin-01.tsx', '/admin/admin-01'),
            f('src/pages/admin/admin-02.tsx', '/admin/admin-02'),
            f('src/pages/reports/report-01.tsx', '/reports/report-01'),
            f('src/pages/api/auth.ts', '/api/auth', 'api'),
            # 라우트 없는 컴포넌트는 엔트리 아님
            {'type': 'other', 'package': '', 'relPath': 'src/components/Button.tsx', 'routes': []},
        ]}

    def test_stack_nextjs(self):
        from build_domain_catalog import build_catalog
        self.assertEqual(build_catalog(self._idx())['stack'], 'nextjs')

    def test_domains_are_pages_subdirs(self):
        from build_domain_catalog import build_catalog
        names = {d['name'] for d in build_catalog(self._idx())['domains']}
        self.assertIn('admin', names)
        self.assertIn('reports', names)
        self.assertIn('api', names)
        self.assertNotIn('components', names)  # 라우트 없음 → 제외

    def test_admin_counts(self):
        from build_domain_catalog import build_catalog
        cat = build_catalog(self._idx())
        admin = next(d for d in cat['domains'] if d['name'] == 'admin')
        self.assertEqual(admin['forms'], 2)
        self.assertEqual(admin['files'], 2)


class TestBuildCatalogJavaMultiModule(unittest.TestCase):
    def _idx(self):
        # 멀티모듈: admin이 과반 → 하강하여 product/order로 세분.
        # scm은 소수 → scm 유지.
        def f(rel, path, pkg, kind='form'):
            return {'type': 'controller', 'package': pkg, 'relPath': rel,
                    'routes': [{'method': 'ANY', 'path': path, 'handlerMethod': '', 'kind': kind}]}
        base = 'src/main/java/com/co/bos'
        files = []
        # admin.product x3, admin.order x2 (admin 5개)
        files.append(f(base + '/admin/product/prdreg/controller/P1.java', '/admin/product/p1', 'com.co.bos.admin.product.prdreg.controller'))
        files.append(f(base + '/admin/product/popup/controller/P2.java', '/admin/product/p2', 'com.co.bos.admin.product.popup.controller'))
        files.append(f(base + '/admin/product/list/controller/P3.java', '/admin/product/p3', 'com.co.bos.admin.product.list.controller'))
        files.append(f(base + '/admin/order/claim/controller/O1.java', '/admin/order/o1', 'com.co.bos.admin.order.claim.controller'))
        files.append(f(base + '/admin/order/pay/controller/O2.java', '/admin/order/o2', 'com.co.bos.admin.order.pay.controller'))
        # scm.acc x1 (scm 1개 — 과반 아님)
        files.append(f(base + '/scm/acc/controller/A1.java', '/scm/acc/a1', 'com.co.bos.scm.acc.controller'))
        return {'contextPath': '/app', 'files': files}

    def test_stack_java(self):
        from build_domain_catalog import build_catalog
        self.assertEqual(build_catalog(self._idx())['stack'], 'java')

    def test_admin_descends_to_product_order(self):
        from build_domain_catalog import build_catalog
        names = {d['name'] for d in build_catalog(self._idx())['domains']}
        # admin은 6개 중 5개로 과반(>50%) → 하강 → product, order
        self.assertIn('product', names)
        self.assertIn('order', names)
        self.assertNotIn('admin', names)  # 하강되어 admin 단일 도메인 사라짐

    def test_scm_stays(self):
        from build_domain_catalog import build_catalog
        names = {d['name'] for d in build_catalog(self._idx())['domains']}
        self.assertIn('scm', names)  # 과반 아님 → 유지

    def test_product_file_count(self):
        from build_domain_catalog import build_catalog
        cat = build_catalog(self._idx())
        product = next(d for d in cat['domains'] if d['name'] == 'product')
        self.assertEqual(product['files'], 3)


class TestNoDominant(unittest.TestCase):
    def test_balanced_modules_not_descended(self):
        from build_domain_catalog import build_catalog
        # admin 2, scm 2 → 과반 없음 → 둘 다 유지
        def f(rel, pkg):
            return {'type': 'controller', 'package': pkg, 'relPath': rel,
                    'routes': [{'kind': 'form', 'path': '/x'}]}
        base = 'src/main/java/com/co/bos'
        idx = {'files': [
            f(base + '/admin/product/controller/A.java', 'com.co.bos.admin.product.controller'),
            f(base + '/admin/order/controller/B.java', 'com.co.bos.admin.order.controller'),
            f(base + '/scm/acc/controller/C.java', 'com.co.bos.scm.acc.controller'),
            f(base + '/scm/as/controller/D.java', 'com.co.bos.scm.as.controller'),
        ]}
        names = {d['name'] for d in build_catalog(idx)['domains']}
        self.assertEqual(names, {'admin', 'scm'})


class TestGenerateCatalogFile(unittest.TestCase):
    def test_writes_json_nextjs(self):
        from build_domain_catalog import generate_catalog
        idx = {'contextPath': None, 'files': [
            {'type': 'controller', 'package': '', 'relPath': 'src/pages/cost/cost-01.tsx',
             'routes': [{'kind': 'form', 'path': '/cost/cost-01'}]},
        ]}
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, 'source_index.json')
            out = os.path.join(tmp, 'domain_catalog.json')
            json.dump(idx, open(src, 'w', encoding='utf-8'))
            cat = generate_catalog(src, out)
            self.assertTrue(os.path.isfile(out))
            self.assertEqual(cat['stack'], 'nextjs')
            self.assertEqual(cat['domains'][0]['name'], 'cost')

    def test_empty_when_no_routes(self):
        from build_domain_catalog import generate_catalog
        idx = {'files': [{'type': 'other', 'package': '', 'relPath': 'src/x.ts', 'routes': []}]}
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, 'source_index.json')
            out = os.path.join(tmp, 'domain_catalog.json')
            json.dump(idx, open(src, 'w', encoding='utf-8'))
            cat = generate_catalog(src, out)
            self.assertEqual(cat['domains'], [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
