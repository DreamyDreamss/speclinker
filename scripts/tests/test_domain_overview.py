#!/usr/bin/env python3
"""build_domain_overview 검증."""
import os, sys, json, tempfile, shutil
SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPTS)

def _inf(d, domain, code, n, method, path, tables):
    p = os.path.join(d, f'docs/05_설계서/{domain}/INF')
    os.makedirs(p, exist_ok=True)
    tl = '\n'.join(f'  - {t}' for t in tables)
    open(os.path.join(p, f'INF-{code}-{n:03d}.md'), 'w', encoding='utf-8').write(
        f"---\ninf-id: INF-{code}-{n:03d}\nmethod: {method}\npath: {path}\n"
        f"domain: {domain}\ndomain-code: {code}\ntables:\n{tl}\nscreens: []\n---\n# x\n")

def test_overview():
    import build_domain_overview as o
    tmp = tempfile.mkdtemp()
    try:
        os.makedirs(os.path.join(tmp, 'docs/05_설계서'), exist_ok=True)
        json.dump({'domains': [{'name': 'order', 'code': 'ORD',
                                'description': '주문 처리 도메인'}]},
                  open(os.path.join(tmp, 'docs/05_설계서/_domain_plan.json'), 'w', encoding='utf-8'))
        _inf(tmp, 'order', 'ORD', 1, 'POST', '/order/list', ['ORDERS', 'ORDERS', 'PAY'])
        _inf(tmp, 'order', 'ORD', 2, 'GET', '/order/detail', ['ORDERS'])
        n = o.generate(tmp)
        ov = os.path.join(tmp, 'docs/05_설계서/order/OVERVIEW_order.md')
        assert os.path.exists(ov), '개요 파일 없음'
        c = open(ov, encoding='utf-8').read()
        assert '주문 처리 도메인' in c, '목적 누락'
        assert 'ORDERS' in c, '핵심 테이블 누락'
        assert '/order/list' in c, '대표 기능 누락'
        assert n == 1
        print('PASS: test_overview')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == '__main__':
    test_overview()
