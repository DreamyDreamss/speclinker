#!/usr/bin/env python3
"""func_context_bundle / build_story 의 query_patterns JIT 배선 검증 (합성 픽스처)."""
import os, sys, json, tempfile, shutil
SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPTS)
import func_context_bundle as fcb
import build_story


def _fixture(tmp):
    os.makedirs(os.path.join(tmp, 'docs/00_FUNC'), exist_ok=True)
    os.makedirs(os.path.join(tmp, 'docs/05_설계서/product/SCH'), exist_ok=True)
    os.makedirs(os.path.join(tmp, 'docs/05_설계서/_machine'), exist_ok=True)
    open(os.path.join(tmp, 'docs/00_FUNC/FUNC_MAP.md'), 'w', encoding='utf-8').write(
        '## FUNC-product-001 — 상품조회\n- **INF**: INF-PRD-001\n- **SCH**: SCH-PRD-001\n')
    open(os.path.join(tmp, 'docs/05_설계서/product/SCH/SCH-PRD-001.md'), 'w', encoding='utf-8').write(
        '---\nsch-id: SCH-PRD-001\ntable: APPLN\n---\n# SCH-PRD-001: APPLN\n')
    json.dump({'joins': [{'table_a': 'APPLN', 'col_a': 'DEPT_ID', 'table_b': 'DEPT',
                          'col_b': 'DEPT_ID', 'freq': 4, 'sources': []},
                         {'table_a': 'XX', 'col_a': 'A', 'table_b': 'YY', 'col_b': 'B',
                          'freq': 1, 'sources': []}],
               'filters': [{'table': 'APPLN', 'col': 'DEL_YN', 'op': '=', 'value': "'N'",
                            'freq': 9, 'sources': []}]},
              open(os.path.join(tmp, 'docs/05_설계서/_machine/query_patterns.json'), 'w', encoding='utf-8'))


def test_bundle_query_patterns():
    tmp = tempfile.mkdtemp()
    try:
        _fixture(tmp)
        fm = fcb.parse_func_map(tmp)
        b = fcb.make_bundle('FUNC-product-001', tmp, {}, fm)
        # 개별 SCH 파일 로드 (v2.56+ 구조) — frontmatter table 추출
        assert b['tables'] == ['APPLN'], b['tables']
        assert 'SCH-PRD-001' in b['spec_content']['sch'], '개별 SCH 본문 미로드'
        qp = b['query_patterns']
        # 이 FUNC 테이블(APPLN)에 한정 — 무관 조인(XX↔YY) 제외
        assert len(qp['joins']) == 1 and qp['joins'][0]['table_b'] == 'DEPT', qp['joins']
        assert len(qp['filters']) == 1 and qp['filters'][0]['col'] == 'DEL_YN', qp['filters']
        print('PASS: test_bundle_query_patterns')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_story_md_section():
    tmp = tempfile.mkdtemp()
    try:
        _fixture(tmp)
        fm = fcb.parse_func_map(tmp)
        b = fcb.make_bundle('FUNC-product-001', tmp, {}, fm)
        md = build_story.build_story_md(b, 'FUNC-product-001', tmp, '2026-06-07')
        assert '쿼리 작성 가이드' in md, 'JIT 섹션 누락'
        assert 'APPLN.DEPT_ID' in md and 'DEL_YN' in md, '조인/필터 미표기'
        print('PASS: test_story_md_section')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    test_bundle_query_patterns()
    test_story_md_section()
