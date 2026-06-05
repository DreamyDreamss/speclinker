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
        assert 'SHARED_T' in c, 'ripple 연결경로(via table) 누락'
        print('PASS: test_change_context_brief')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

def test_frontmatter_anchors():
    import spec_graph_build as g
    tmp = tempfile.mkdtemp()
    try:
        p = os.path.join(tmp, 'docs/05_설계서/order/INF'); os.makedirs(p, exist_ok=True)
        open(os.path.join(p, 'INF-ORD-001.md'), 'w', encoding='utf-8').write(
            "---\ninf-id: INF-ORD-001\nmethod: POST\npath: /o\ndomain: order\n"
            "tables:\n  - ORDERS\nanchors:\n  - src/C.java:1-9\n  - src/S.java:2-8\n  - src/M.xml:3-30\n---\n# x\n")
        gr = g.build_graph(tmp)
        a = gr['inf']['INF-ORD-001']['anchors']
        assert any('C.java' in x for x in a) and any('S.java' in x for x in a) and any('M.xml' in x for x in a), a
        print('PASS: test_frontmatter_anchors')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

def test_freshness_gate():
    """소스 파일이 스펙보다 최신이면 STALE 경고."""
    import time
    tmp = tempfile.mkdtemp()
    try:
        # INF 스펙 + 그 앵커가 가리키는 소스 파일 생성
        os.makedirs(os.path.join(tmp, 'src/order'), exist_ok=True)
        _inf(tmp, 'order', 'ORD', 1, 'POST', '/order/x', ['ORDERS'], 'src/order/OrderCtl.java:1-9')
        spec = os.path.join(tmp, 'docs/05_설계서/order/INF/INF-ORD-001.md')
        src = os.path.join(tmp, 'src/order/OrderCtl.java')
        open(src, 'w', encoding='utf-8').write('class X {}')
        # 소스를 스펙보다 최신으로 (mtime +100s)
        st = os.stat(spec)
        os.utime(spec, (st.st_atime, st.st_mtime - 100))
        env = dict(os.environ, PYTHONUTF8='1')
        r = subprocess.run([sys.executable, os.path.join(SCRIPTS, 'build_change_context.py'),
                            tmp, '--entities', 'ORDERS'], capture_output=True, text=True, env=env)
        assert r.returncode == 0, r.stderr
        c = open(os.path.join(tmp, 'docs/변경관리/_adhoc/_asis_brief.md'), encoding='utf-8').read()
        assert '현행성' in c and 'OrderCtl.java' in c, '현행성 경고 누락'
        print('PASS: test_freshness_gate')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

def test_ubiquity_isolation():
    """공통테이블(다수 사용)은 격리되고, 전용테이블 사용처가 상위 랭킹."""
    tmp = tempfile.mkdtemp()
    try:
        # COMMON_CD를 5개 INF가 사용(편재), DEDICATED를 1개가 사용
        for n in range(1, 6):
            _inf(tmp, 'd'+str(n), 'D'+str(n), 1, 'GET', f'/d{n}/x', ['COMMON_CD'], f'src/d{n}.java:1-9')
        _inf(tmp, 'order', 'ORD', 9, 'POST', '/order/refund', ['COMMON_CD', 'ORD_REFUND_D'], 'src/order.java:1-9')
        env = dict(os.environ, PYTHONUTF8='1')
        # 임계 3 → COMMON_CD(6 users) 격리, ORD_REFUND_D(1 user) 정상
        r = subprocess.run([sys.executable, os.path.join(SCRIPTS, 'build_change_context.py'),
                            tmp, '--entities', 'COMMON_CD,ORD_REFUND_D', '--ubiquity', '3'],
                           capture_output=True, text=True, env=env)
        assert r.returncode == 0, r.stderr
        c = open(os.path.join(tmp, 'docs/변경관리/_adhoc/_asis_brief.md'), encoding='utf-8').read()
        assert '광역 공통자원' in c, '공통자원 격리 섹션 없음'
        assert 'COMMON_CD' in c
        # COMMON_CD를 쓰는 5개 무관 도메인 INF가 본문 영향목록에 개별 나열되지 않아야(노이즈 방지)
        assert c.count('INF-D1-001') == 0 or '광역' in c.split('INF-D1-001')[0][-200:], 'D1 INF 노이즈'
        print('PASS: test_ubiquity_isolation')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == '__main__':
    test_graph_reverse_ripple()
    test_change_context_brief()
    test_ubiquity_isolation()
    test_freshness_gate()
    test_frontmatter_anchors()
