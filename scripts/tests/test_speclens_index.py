#!/usr/bin/env python3
"""SpecLens 인덱스 관계 해소 단위 검증 (Java Spring + Next.js 2스택 픽스처)."""
import os, sys, tempfile
SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPTS)
import gen_docsify as G

# 2스택 형태: Java 컨트롤러 경로 + Next.js 파일라우팅 경로 혼재
INFS = [
    {'id': 'INF-PRD-205', 'path': '/product/save', 'method': 'POST', 'domain': 'product'},
    {'id': 'INF-PRD-206', 'path': '/product/category', 'method': 'GET', 'domain': 'product'},
    {'id': 'INF-ORD-010', 'path': '/api/order/list', 'method': 'GET', 'domain': 'order'},
]


def test_resolve_uis_inf_exact_and_prefix():
    uis = [
        {'id': 'UIS-PRD-001', 'apis': ['/product/save', '/product/category'], 'domain': 'product'},
        {'id': 'UIS-ORD-001', 'apis': ['/api/order/list?page=1'], 'domain': 'order'},  # 쿼리스트링 → norm 후 정확매칭
        {'id': 'UIS-X-001', 'apis': ['/unknown/path'], 'domain': 'x'},                  # 매칭 실패
    ]
    G.resolve_uis_inf(uis, INFS)
    assert uis[0]['inf_ids'] == ['INF-PRD-205', 'INF-PRD-206'], uis[0]
    assert uis[1]['inf_ids'] == ['INF-ORD-010'], uis[1]
    assert uis[2]['inf_ids'] == [], uis[2]                    # 실패분은 빈 목록(raw는 apis에 유지)
    assert uis[2]['apis'] == ['/unknown/path']


def test_resolve_uis_inf_real_api_hints_format():
    """실제 link_uis_inf 산출 api_hints 형식: 'METHOD [INF-ID](link)' / 'METHOD /path' / 따옴표."""
    infs = [
        {'id': 'INF-PRD-490', 'path': '/app/product/prdreg/x490', 'method': 'POST', 'domain': 'product'},
        {'id': 'INF-PRD-487', 'path': '/app/product/prdreg/x487', 'method': 'POST', 'domain': 'product'},
        {'id': 'INF-PRD-001', 'path': '/app/product/prdreg/save', 'method': 'POST', 'domain': 'product'},
    ]
    uis = [{'id': 'UIS-PRD-001', 'domain': 'product', 'apis': [
        'POST /product/prdreg',                                  # 페이지 라우트 → 특정 INF 아님(미해소 OK)
        'POST [INF-PRD-490](../../INF/INF-PRD-490.md)',          # ① 박힌 ID
        '"POST [INF-PRD-487](../../INF/INF-PRD-487.md)"',        # ① 박힌 ID + 따옴표 래핑
        'POST /product/prdreg/save',                             # ② 컨텍스트 접두 차이(/app 없음) suffix 매칭
        'POST [INF-PRD-999](../../INF/INF-PRD-999.md)',          # 없는 INF → 무시
    ]}]
    G.resolve_uis_inf(uis, infs)
    assert uis[0]['inf_ids'] == ['INF-PRD-490', 'INF-PRD-487', 'INF-PRD-001'], uis[0]['inf_ids']


def test_build_inf_sch_index():
    infs = [{'id': 'INF-PRD-205'}, {'id': 'INF-PRD-206'}, {'id': 'INF-ORD-010'}]
    schs = [
        {'id': 'SCH-PRD-009', 'table': 'PRODUCT', 'inf': ['INF-PRD-205', 'INF-PRD-206']},
        {'id': 'SCH-PRD-010', 'table': 'PRICE', 'inf': ['INF-PRD-205']},
        {'id': 'SCH-ORD-001', 'table': 'ORDERS', 'inf': []},  # 참조 INF 없음
    ]
    G.build_inf_sch_index(infs, schs)
    assert infs[0]['sch_ids'] == ['SCH-PRD-009', 'SCH-PRD-010'], infs[0]
    assert infs[1]['sch_ids'] == ['SCH-PRD-009'], infs[1]
    assert infs[2]['sch_ids'] == [], infs[2]


def test_load_func_links_from_funcmap():
    tmp = tempfile.mkdtemp()
    func_dir = os.path.join(tmp, 'docs', '00_FUNC')
    os.makedirs(func_dir)
    with open(os.path.join(func_dir, 'FUNC_MAP.md'), 'w', encoding='utf-8') as f:
        f.write("| FUNC-ID | 기능 | INF | UIS | SCH |\n")
        f.write("|---|---|---|---|---|\n")
        f.write("| FUNC-product-001 | 상품등록 | INF-PRD-205, INF-PRD-206 | UIS-PRD-001 | SCH-PRD-009 |\n")
    infs = [{'id': 'INF-PRD-205'}, {'id': 'INF-PRD-206'}, {'id': 'INF-ORD-010'}]
    uis = [{'id': 'UIS-PRD-001'}]
    schs = [{'id': 'SCH-PRD-009'}]
    G.load_func_links(tmp, infs, uis, schs)
    assert infs[0]['func'] == 'FUNC-product-001'
    assert infs[2].get('func') in (None, '')   # 매핑 없음
    assert uis[0]['func'] == 'FUNC-product-001'
    assert schs[0]['func'] == 'FUNC-product-001'


def test_compute_gaps():
    infs = [{'id': 'INF-PRD-205', 'sch_ids': ['SCH-PRD-009']},
            {'id': 'INF-PRD-206', 'sch_ids': []}]          # 테이블 미연결
    uis = [{'id': 'UIS-PRD-001', 'inf_ids': ['INF-PRD-205']},
           {'id': 'UIS-PRD-002', 'inf_ids': []}]           # API 미연결
    gaps = G.compute_gaps(infs, uis)
    assert gaps['inf_no_sch'] == 1
    assert gaps['uis_no_inf'] == 1


if __name__ == '__main__':
    for name, fn in sorted(globals().items()):
        if name.startswith('test_') and callable(fn):
            fn()
            print('PASS', name)
