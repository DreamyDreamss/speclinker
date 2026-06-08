#!/usr/bin/env python3
"""생성/미생성 커버리지 (build_manifest + build_coverage) 단위 검증."""
import os, sys, json, tempfile
SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPTS)
import gen_docsify as G


def _mk_inf(d, iid, method, path, tables):
    body = f"---\ninf-id: {iid}\nmethod: {method}\npath: {path}\ndomain: {d}\ntables:\n"
    body += "".join(f"  - {t}\n" for t in tables) + "---\n# x\n"
    return body


def _build(ws):
    return G.generate_index(ws, os.path.join(ws, 'docs', 'viewer', 'spec_index.json'))


def test_coverage_inf_sch_uis():
    ws = tempfile.mkdtemp()
    infd = os.path.join(ws, 'docs', '05_설계서', 'product', 'INF'); os.makedirs(infd)
    open(os.path.join(infd, 'INF-PRD-001.md'), 'w', encoding='utf-8').write(
        _mk_inf('product', 'INF-PRD-001', 'GET', '/product/list', ['PRODUCT', 'CATEGORY']))
    open(os.path.join(infd, 'INF-PRD-002.md'), 'w', encoding='utf-8').write(
        _mk_inf('product', 'INF-PRD-002', 'POST', '/product', ['PRODUCT']))
    schd = os.path.join(ws, 'docs', '05_설계서', 'product', 'SCH'); os.makedirs(schd)
    open(os.path.join(schd, 'SCH-PRD-001.md'), 'w', encoding='utf-8').write(
        "---\nsch-id: SCH-PRD-001\ntable: PRODUCT\ndomain: product\n---\n# x\n")
    uisd = os.path.join(ws, 'docs', '05_설계서', 'product', 'UIS', 'UIS-F-001'); os.makedirs(uisd)
    open(os.path.join(uisd, 'spec.md'), 'w', encoding='utf-8').write(
        "---\nUIS-ID: UIS-F-001\n화면명: 목록\n도메인: product\n---\n# x\n")

    os.makedirs(os.path.join(ws, '_tmp'))
    inv = [[{"domain": "product", "domainCode": "PRD", "infIdStart": 1,
             "filePath": "ProductController.java",
             "apiRoutes": [{"method": "get", "path": "/product/list"},
                           {"method": "post", "path": "/product"},
                           {"method": "delete", "path": "/product/{id}"}]}]]
    json.dump(inv, open(os.path.join(ws, '_tmp', 'router_inventory_with_chain.json'), 'w'))
    os.makedirs(os.path.join(ws, '.speclinker'))
    plan = {"screens": [
        {"id": "UIS-F-001", "route": "/product/list", "name": "목록", "domain": "product", "status": "pending"},
        {"id": "UIS-F-002", "route": "/product/edit", "name": "수정", "domain": "product", "status": "pending"},
        {"id": "UIS-F-099", "route": "/old", "name": "폐기", "domain": "product", "status": "excluded"}]}
    json.dump(plan, open(os.path.join(ws, '.speclinker', 'screen_plan.confirmed.json'), 'w'))

    cov = _build(ws)['domains']['product']['coverage']
    # INF: 3 expected, 2 generated, INF-PRD-003 missing
    assert cov['inf']['expected'] == 3 and cov['inf']['generated'] == 2
    assert [m['id'] for m in cov['inf']['missing']] == ['INF-PRD-003']
    # SCH: PRODUCT generated, CATEGORY missing (derived from INF tables)
    assert cov['sch']['expected'] == 2 and cov['sch']['generated'] == 1
    assert [m['id'] for m in cov['sch']['missing']] == ['CATEGORY']
    # UIS: excluded 제외 → 2 expected, 1 generated, UIS-F-002 missing
    assert cov['uis']['expected'] == 2 and cov['uis']['generated'] == 1
    assert [m['id'] for m in cov['uis']['missing']] == ['UIS-F-002']
    # 매니페스트 영속
    assert os.path.exists(os.path.join(ws, '.speclinker', 'spec_manifest.json'))


def test_manifest_carry_forward_when_tmp_cleared():
    """_tmp 인벤토리가 사라져도 직전 매니페스트(expected)를 보존한다."""
    ws = tempfile.mkdtemp()
    infd = os.path.join(ws, 'docs', '05_설계서', 'order', 'INF'); os.makedirs(infd)
    open(os.path.join(infd, 'INF-ORD-001.md'), 'w', encoding='utf-8').write(
        _mk_inf('order', 'INF-ORD-001', 'GET', '/order/list', []))
    os.makedirs(os.path.join(ws, '_tmp'))
    inv = [[{"domain": "order", "domainCode": "ORD", "infIdStart": 1, "filePath": "OrderController.java",
             "apiRoutes": [{"method": "get", "path": "/order/list"},
                           {"method": "post", "path": "/order"}]}]]
    json.dump(inv, open(os.path.join(ws, '_tmp', 'router_inventory_with_chain.json'), 'w'))
    cov1 = _build(ws)['domains']['order']['coverage']
    assert cov1['inf']['expected'] == 2 and cov1['inf']['generated'] == 1

    # _tmp 인벤토리 삭제 후 재빌드 — 매니페스트 carry-forward로 expected 유지
    os.remove(os.path.join(ws, '_tmp', 'router_inventory_with_chain.json'))
    cov2 = _build(ws)['domains']['order']['coverage']
    assert cov2['inf']['expected'] == 2 and cov2['inf']['generated'] == 1
    assert [m['id'] for m in cov2['inf']['missing']] == ['INF-ORD-002']


def test_no_sources_no_coverage():
    """expected 소스가 전혀 없으면 coverage 미설정(graceful) — SCH는 INF tables 있으면 도출."""
    ws = tempfile.mkdtemp()
    infd = os.path.join(ws, 'docs', '05_설계서', 'x', 'INF'); os.makedirs(infd)
    open(os.path.join(infd, 'INF-X-001.md'), 'w', encoding='utf-8').write(
        _mk_inf('x', 'INF-X-001', 'GET', '/x', []))
    cov = _build(ws)['domains']['x'].get('coverage', {})
    assert 'inf' not in cov   # router 인벤토리 없음 → INF coverage 없음
    assert 'uis' not in cov   # screen plan 없음 → UIS coverage 없음


if __name__ == '__main__':
    test_coverage_inf_sch_uis()
    test_manifest_carry_forward_when_tmp_cleared()
    test_no_sources_no_coverage()
    print('OK')
