import sys, os, json, tempfile, unittest
sys.path.insert(0, os.path.dirname(__file__))


# ─────────────────────────────────────────────────────────────
# UIS goto 플랜: kind=form route를 직접 goto 캡처할 화면 목록으로 변환.
# 도메인은 build_domain_catalog.assign_file_domains 재사용 (범용, 2스택).
# ─────────────────────────────────────────────────────────────


class TestMenuPathFromRoute(unittest.TestCase):
    def test_strips_context_path(self):
        from build_uis_goto_plan import menu_path_from_route
        self.assertEqual(menu_path_from_route('/app/product/prdreg/pr201Form', '/app'),
                         ['product', 'prdreg', 'pr201Form'])

    def test_no_context_path(self):
        from build_uis_goto_plan import menu_path_from_route
        self.assertEqual(menu_path_from_route('/admin/admin-01', None),
                         ['admin', 'admin-01'])

    def test_trailing_slash(self):
        from build_uis_goto_plan import menu_path_from_route
        self.assertEqual(menu_path_from_route('/order/list/', '/app'),
                         ['order', 'list'])


class TestBuildGotoPlanJava(unittest.TestCase):
    def _idx(self):
        def f(rel, path, kind, pkg):
            return {'type': 'controller', 'package': pkg, 'relPath': rel,
                    'routes': [{'method': 'ANY', 'path': path, 'handlerMethod': '', 'kind': kind}]}
        base = 'src/main/java/com/co/bos'
        return {'contextPath': '/app', 'files': [
            f(base + '/admin/product/controller/P.java', '/app/product/pr201Form', 'form', 'com.co.bos.admin.product.controller'),
            f(base + '/admin/product/controller/A.java', '/app/product/productList', 'api', 'com.co.bos.admin.product.controller'),
            f(base + '/admin/order/controller/O.java', '/app/order/or440Form', 'form', 'com.co.bos.admin.order.controller'),
        ]}

    def test_only_form_routes(self):
        from build_uis_goto_plan import build_goto_plan
        plan = build_goto_plan(self._idx())
        routes = {s['route'] for s in plan}
        self.assertIn('/app/product/pr201Form', routes)
        self.assertNotIn('/app/product/productList', routes)  # api 제외

    def test_screen_id_from_handler_or_last_seg(self):
        from build_uis_goto_plan import build_goto_plan
        plan = build_goto_plan(self._idx())
        s = next(s for s in plan if 'pr201Form' in s['route'])
        self.assertEqual(s['screenId'], 'pr201Form')

    def test_domain_assigned(self):
        from build_uis_goto_plan import build_goto_plan
        plan = build_goto_plan(self._idx())
        s = next(s for s in plan if 'pr201Form' in s['route'])
        # 도메인은 relPath 기반 (admin 흡수 → product). 단일 admin이 과반이지만
        # product/order로 분기되므로 product.
        self.assertEqual(s['domain'], 'product')

    def test_entry_file(self):
        from build_uis_goto_plan import build_goto_plan
        plan = build_goto_plan(self._idx())
        s = next(s for s in plan if 'pr201Form' in s['route'])
        self.assertTrue(s['entryFile'].endswith('P.java'))

    def test_domain_filter(self):
        from build_uis_goto_plan import build_goto_plan
        plan = build_goto_plan(self._idx(), domain_filter='order')
        self.assertTrue(all(s['domain'] == 'order' for s in plan))
        self.assertEqual(len(plan), 1)


class TestBuildGotoPlanNextjs(unittest.TestCase):
    def _idx(self):
        def f(rel, path, kind='form'):
            return {'type': 'controller', 'package': '', 'relPath': rel,
                    'routes': [{'method': 'ANY', 'path': path, 'handlerMethod': '', 'kind': kind}]}
        return {'contextPath': None, 'files': [
            f('src/pages/admin/admin-01.tsx', '/admin/admin-01'),
            f('src/pages/reports/report-01.tsx', '/reports/report-01'),
            f('src/pages/api/auth.ts', '/api/auth', 'api'),
        ]}

    def test_nextjs_forms_only(self):
        from build_uis_goto_plan import build_goto_plan
        plan = build_goto_plan(self._idx())
        routes = {s['route'] for s in plan}
        self.assertIn('/admin/admin-01', routes)
        self.assertNotIn('/api/auth', routes)  # api 제외

    def test_nextjs_domain(self):
        from build_uis_goto_plan import build_goto_plan
        plan = build_goto_plan(self._idx())
        s = next(s for s in plan if 'admin-01' in s['route'])
        self.assertEqual(s['domain'], 'admin')

    def test_nextjs_menu_path(self):
        from build_uis_goto_plan import build_goto_plan
        plan = build_goto_plan(self._idx())
        s = next(s for s in plan if 'admin-01' in s['route'])
        self.assertEqual(s['menuPath'], ['admin', 'admin-01'])


class TestGeneratePlanFile(unittest.TestCase):
    def test_writes_json(self):
        from build_uis_goto_plan import generate_goto_plan
        idx = {'contextPath': None, 'files': [
            {'type': 'controller', 'package': '', 'relPath': 'src/pages/cost/cost-01.tsx',
             'routes': [{'method': 'ANY', 'path': '/cost/cost-01', 'handlerMethod': '', 'kind': 'form'}]},
        ]}
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, 'source_index.json')
            out = os.path.join(tmp, 'uis_goto_plan.json')
            json.dump(idx, open(src, 'w', encoding='utf-8'))
            plan = generate_goto_plan(src, out, domain_filter=None)
            self.assertTrue(os.path.isfile(out))
            self.assertEqual(len(plan), 1)
            self.assertEqual(plan[0]['screenId'], 'cost-01')
            self.assertEqual(plan[0]['domain'], 'cost')


if __name__ == '__main__':
    unittest.main(verbosity=2)
