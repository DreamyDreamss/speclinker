#!/usr/bin/env python3
"""build_table_registry — 발견출처(INF/SQL/UIS) + generated 매칭 + carry-forward 검증."""
import os, sys, json, tempfile
SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPTS)
import build_table_registry as BTR


def _inf(d, iid, path, tables):
    body = f"---\ninf-id: {iid}\nmethod: GET\npath: {path}\ndomain: {d}\ntables:\n"
    body += "".join(f"  - {t}\n" for t in tables) + "---\n# x\n"
    return body


def _mk(ws, domain, iid, path, tables):
    infd = os.path.join(ws, 'docs', '05_설계서', domain, 'INF'); os.makedirs(infd, exist_ok=True)
    open(os.path.join(infd, f'{iid}.md'), 'w', encoding='utf-8').write(_inf(domain, iid, path, tables))


def _by(reg, table):
    for t in reg['tables']:
        if t['table'].upper() == table.upper():
            return t
    return None


def test_sources_and_generated():
    ws = tempfile.mkdtemp()
    # INF: PRODUCT, CATEGORY
    _mk(ws, 'product', 'INF-PRD-001', '/product/list', ['PRODUCT', 'CATEGORY'])
    # SCH 생성: PRODUCT만
    schd = os.path.join(ws, 'docs', '05_설계서', 'product', 'SCH'); os.makedirs(schd)
    open(os.path.join(schd, 'SCH-PRD-001.md'), 'w', encoding='utf-8').write(
        "---\nsch-id: SCH-PRD-001\ntable: PRODUCT\ndomain: product\n---\n# x\n")
    # SQL sch_draft: ORDERS (INF엔 없음 — sql-only)
    dd = os.path.join(ws, '_tmp', 'sch_draft', 'product'); os.makedirs(dd)
    json.dump({"table": "orders", "domain": "product"}, open(os.path.join(dd, 'orders.json'), 'w'))
    # UIS: 화면이 INF-PRD-001 호출 → PRODUCT/CATEGORY를 used_by_screens
    uisd = os.path.join(ws, 'docs', '05_설계서', 'product', 'UIS', 'UIS-F-001'); os.makedirs(uisd)
    open(os.path.join(uisd, 'spec.md'), 'w', encoding='utf-8').write(
        "---\nUIS-ID: UIS-F-001\n화면명: 목록\n도메인: product\napis:\n  - /product/list\n---\n# x\n")

    reg = BTR.write_registry(ws)

    product = _by(reg, 'PRODUCT')
    assert product['generated'] is True and product['sch_id'] == 'SCH-PRD-001'
    assert 'inf' in product['sources'] and 'uis' in product['sources']
    assert 'UIS-F-001' in product['used_by_screens']
    assert 'INF-PRD-001' in product['used_by_inf']

    category = _by(reg, 'CATEGORY')
    assert category['generated'] is False        # SCH 미생성
    assert 'inf' in category['sources']

    orders = _by(reg, 'ORDERS')
    assert orders is not None and 'sql' in orders['sources']   # SQL-only 발견
    assert orders['generated'] is False

    # 영속 파일
    assert os.path.exists(os.path.join(ws, '.speclinker', 'table_registry.json'))


def test_carry_forward_when_sch_draft_cleared():
    """_tmp/sch_draft 사라져도 직전 레지스트리의 'sql' 출처를 보존한다."""
    ws = tempfile.mkdtemp()
    _mk(ws, 'order', 'INF-ORD-001', '/order/list', ['ORDER_M'])
    dd = os.path.join(ws, '_tmp', 'sch_draft', 'order'); os.makedirs(dd)
    json.dump({"table": "order_log", "domain": "order"}, open(os.path.join(dd, 'order_log.json'), 'w'))
    reg1 = BTR.write_registry(ws)
    assert 'sql' in _by(reg1, 'ORDER_LOG')['sources']

    # sch_draft 삭제 후 재빌드 — carry-forward로 ORDER_LOG('sql') 유지
    import shutil
    shutil.rmtree(os.path.join(ws, '_tmp', 'sch_draft'))
    reg2 = BTR.write_registry(ws)
    ol = _by(reg2, 'ORDER_LOG')
    assert ol is not None and 'sql' in ol['sources']


def test_empty_graceful():
    ws = tempfile.mkdtemp()
    reg = BTR.write_registry(ws)
    assert reg['tables'] == []


if __name__ == '__main__':
    test_sources_and_generated()
    test_carry_forward_when_sch_draft_cleared()
    test_empty_graceful()
    print('OK')
