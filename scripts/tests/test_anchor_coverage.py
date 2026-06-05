#!/usr/bin/env python3
"""eval_anchor_coverage 검증."""
import os, sys, tempfile, shutil
SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPTS)

def test_stage_classify():
    import eval_anchor_coverage as e
    assert e.stage('src/x/FooController.java:1-9') == 'controller'
    assert e.stage('src/x/FooServiceImpl.java:1') == 'service'
    assert e.stage('src/x/FooMapper.xml:3-30') == 'sql'
    assert e.stage('src/x/FooDao.java:1') == 'sql'
    print('PASS: test_stage_classify')

def _inf(d, code, n, anchors):
    p = os.path.join(d, 'docs/05_설계서/order/INF'); os.makedirs(p, exist_ok=True)
    al = '\n'.join(f'  - {a}' for a in anchors)
    open(os.path.join(p, f'INF-{code}-{n:03d}.md'), 'w', encoding='utf-8').write(
        f"---\ninf-id: INF-{code}-{n:03d}\nmethod: POST\npath: /o/{n}\ndomain: order\n"
        f"tables:\n  - ORDERS\nanchors:\n{al}\n---\n# x\n")

def test_coverage_report():
    import eval_anchor_coverage as e
    tmp = tempfile.mkdtemp()
    try:
        _inf(tmp, 'ORD', 1, ['src/AController.java:1-9'])  # controller only
        _inf(tmp, 'ORD', 2, ['src/BController.java:1', 'src/BService.java:2', 'src/BMapper.xml:3'])  # full
        rep = e.evaluate(tmp)
        assert rep['inf_total'] == 2
        assert abs(rep['has_sql_rate'] - 0.5) < 0.01, rep   # 1/2 has SQL anchor
        assert rep['meta_path_rate'] == 1.0, rep
        print('PASS: test_coverage_report')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == '__main__':
    test_stage_classify()
    test_coverage_report()
