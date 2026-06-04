#!/usr/bin/env python3
"""build_change_context / spec_graph_build 검증 (합성 픽스처)."""
import os, sys, json, subprocess, tempfile, shutil
SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPTS)

def _inf(d, domain, code, n, method, path, tables, anchor):
    p = os.path.join(d, f'docs/05_설계서/{domain}/INF')
    os.makedirs(p, exist_ok=True)
    tl = '\n'.join(f'  - {t}' for t in tables)
    open(os.path.join(p, f'INF-{code}-{n:03d}.md'), 'w', encoding='utf-8').write(
        f"---\ninf-id: INF-{code}-{n:03d}\nmethod: {method}\npath: {path}\n"
        f"domain: {domain}\ndomain-code: {code}\ntables:\n{tl}\nscreens: []\n---\n\n"
        f"# INF-{code}-{n:03d}\n\n> **근거 소스:** `{anchor}`\n\n## 비즈니스 규칙\n- 예시\n")

def test_graph_reverse_ripple():
    import spec_graph_build as g
    tmp = tempfile.mkdtemp()
    try:
        _inf(tmp, 'order', 'ORD', 1, 'POST', '/order/list', ['ORDERS', 'SHARED_T'], 'src/order/OrderCtl.java:10-50')
        _inf(tmp, 'product', 'PRD', 1, 'GET', '/product/get', ['SHARED_T'], 'src/product/PrdCtl.java:5-20')
        graph = g.build_graph(tmp)
        users = graph['table_to_inf'].get('SHARED_T', [])
        assert 'INF-ORD-001' in users and 'INF-PRD-001' in users, users
        assert ':10-50' in graph['inf']['INF-ORD-001']['anchors'][0], graph['inf']['INF-ORD-001']
        print('PASS: test_graph_reverse_ripple')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

def test_change_context_brief():
    tmp = tempfile.mkdtemp()
    try:
        _inf(tmp, 'order', 'ORD', 1, 'POST', '/order/list', ['ORDERS', 'SHARED_T'], 'src/order/OrderCtl.java:10-50')
        _inf(tmp, 'product', 'PRD', 1, 'GET', '/product/get', ['SHARED_T'], 'src/product/PrdCtl.java:5-20')
        env = dict(os.environ, PYTHONUTF8='1')
        r = subprocess.run([sys.executable, os.path.join(SCRIPTS, 'build_change_context.py'),
                            tmp, '--entities', 'SHARED_T'], capture_output=True, text=True, env=env)
        assert r.returncode == 0, r.stderr
        brief = os.path.join(tmp, 'docs/변경관리/_adhoc/_asis_brief.md')
        c = open(brief, encoding='utf-8').read()
        assert 'INF-ORD-001' in c and 'INF-PRD-001' in c, 'ripple 누락'
        assert 'OrderCtl.java:10-50' in c, '앵커 누락'
        assert 'ripple' in c.lower() or '공유' in c, 'ripple 경고 누락'
        print('PASS: test_change_context_brief')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == '__main__':
    test_graph_reverse_ripple()
    test_change_context_brief()
