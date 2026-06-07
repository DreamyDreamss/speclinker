#!/usr/bin/env python3
"""detect_drift 변경 감지 검증 (합성 픽스처: stale / fresh / missing)."""
import os, sys, time, tempfile, shutil
SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPTS)
import detect_drift as dd


def _setup(tmp):
    src = os.path.join(tmp, 'src/main/java/ord/OrderController.java')
    os.makedirs(os.path.dirname(src), exist_ok=True)
    open(src, 'w').write('class X{}')
    inf = os.path.join(tmp, 'docs/05_설계서/ord/INF/INF-ORD-001.md')
    os.makedirs(os.path.dirname(inf), exist_ok=True)
    open(inf, 'w', encoding='utf-8').write(
        '---\ninf-id: INF-ORD-001\ndomain: ord\n'
        'anchors:\n  - "src/main/java/ord/OrderController.java:12"\n---\n# INF-ORD-001\n')
    return src, inf


def test_drift_stale_fresh_missing():
    tmp = tempfile.mkdtemp()
    try:
        src, inf = _setup(tmp)
        old = time.time() - 1000
        os.utime(inf, (old, old))                      # 스펙 과거, 소스 현재 → STALE
        r = dd.detect(tmp)
        assert r['total'] == 1 and r['items'][0]['id'] == 'INF-ORD-001', r
        assert '최신' in r['items'][0]['reason'], r['items']

        os.utime(inf, None)                            # 스펙 최신화 → STALE 0
        assert dd.detect(tmp)['total'] == 0

        os.remove(src); os.utime(inf, (old, old))      # 소스 삭제 → MISSING
        r3 = dd.detect(tmp)
        assert r3['total'] == 1 and '사라짐' in r3['items'][0]['reason'], r3
        print('PASS: test_drift_stale_fresh_missing')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_no_anchors_skipped():
    tmp = tempfile.mkdtemp()
    try:
        inf = os.path.join(tmp, 'docs/05_설계서/ord/INF/INF-ORD-002.md')
        os.makedirs(os.path.dirname(inf), exist_ok=True)
        open(inf, 'w', encoding='utf-8').write('---\ninf-id: INF-ORD-002\ndomain: ord\n---\n# x\n')
        assert dd.detect(tmp)['total'] == 0  # 앵커 없으면 비교 불가 → 제외
        print('PASS: test_no_anchors_skipped')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    test_drift_stale_fresh_missing()
    test_no_anchors_skipped()
