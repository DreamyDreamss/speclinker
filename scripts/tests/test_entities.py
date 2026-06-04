#!/usr/bin/env python3
"""extract_entities 검증 (합성 픽스처)."""
import os, sys, json, tempfile, shutil
SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPTS)

def _inf(d, domain, code, n, path, tables):
    p = os.path.join(d, f'docs/05_설계서/{domain}/INF')
    os.makedirs(p, exist_ok=True)
    tl = '\n'.join(f'  - {t}' for t in tables)
    open(os.path.join(p, f'INF-{code}-{n:03d}.md'), 'w', encoding='utf-8').write(
        f"---\ninf-id: INF-{code}-{n:03d}\nmethod: POST\npath: {path}\n"
        f"domain: {domain}\ndomain-code: {code}\ntables:\n{tl}\nscreens: []\n---\n# x\n")

def test_extract_entities():
    import extract_entities as e
    tmp = tempfile.mkdtemp()
    try:
        _inf(tmp, 'order', 'ORD', 1, '/order/refundList', ['ORD_REFUND_D', 'ORD_M'])
        text = ("환불 정책 변경 요청. ORD_REFUND_D 테이블에 컬럼 추가하고 "
                "/order/refundList 화면과 INF-ORD-001 응답을 수정한다. 무관단어 zzz.")
        ents = e.extract(tmp, text)
        assert 'ORD_REFUND_D' in ents['tables'], ents['tables']
        assert 'INF-ORD-001' in ents['infs'], ents['infs']
        assert any('/order/refundList' in p for p in ents['paths']), ents['paths']
        # 그래프에 없는 가짜 테이블은 잡지 않음(정밀도)
        assert 'ZZZ' not in ents['tables']
        print('PASS: test_extract_entities')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == '__main__':
    test_extract_entities()
