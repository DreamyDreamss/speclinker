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


def test_scan_funcs_from_funcmap():
    tmp = tempfile.mkdtemp()
    fdir = os.path.join(tmp, 'docs', '00_FUNC')
    os.makedirs(fdir)
    with open(os.path.join(fdir, 'FUNC_MAP.md'), 'w', encoding='utf-8') as f:
        f.write("| UIS-ID | 화면명 | FUNC-ID | 호출 INF | 연관 SCH |\n|---|---|---|---|---|\n")
        f.write("| UIS-PRD-001 | 상품등록 | FUNC-product-001 | INF-PRD-205, INF-PRD-206 | SCH-PRD-009 |\n")
    funcs = G.scan_funcs(tmp)
    assert len(funcs) == 1, funcs
    fn = funcs[0]
    assert fn['id'] == 'FUNC-product-001'
    assert fn['domain'] == 'product'
    assert 'UIS-PRD-001' in fn['uis']
    assert set(fn['inf']) == {'INF-PRD-205', 'INF-PRD-206'}
    assert fn['sch'] == ['SCH-PRD-009']
    assert fn['name'] == '상품등록'


def test_scan_funcs_dedup_gap_table():
    """FUNC_MAP에 색인표 + 갭/요약표가 함께 있어도 FUNC-ID당 1건(색인표 우선)."""
    tmp = tempfile.mkdtemp()
    fdir = os.path.join(tmp, 'docs', '00_FUNC')
    os.makedirs(fdir)
    with open(os.path.join(fdir, 'FUNC_MAP.md'), 'w', encoding='utf-8') as f:
        f.write("| UIS-ID | 화면명 | FUNC-ID | 호출 INF | 연관 SCH |\n|---|---|---|---|---|\n")
        f.write("| UIS-PRD-001 | 상품등록 | FUNC-PRD-001 | INF-PRD-205 | SCH-PRD-009 |\n")
        f.write("\n### 갭 목록\n| 갭 | 화면 | 비고 |\n|---|---|---|\n")
        f.write("| GAP-001 | FUNC-PRD-001 (상품등록) | INF→SCH 미연결 |\n")
    funcs = G.scan_funcs(tmp)
    assert len(funcs) == 1, [f['id'] for f in funcs]
    assert funcs[0]['name'] == '상품등록'   # 색인표 행 우선(갭표 아님)


def test_scan_funcs_absent_graceful():
    tmp = tempfile.mkdtemp()
    os.makedirs(os.path.join(tmp, 'docs'))
    assert G.scan_funcs(tmp) == []


def test_scan_srs_from_index_table():
    tmp = tempfile.mkdtemp()
    sdir = os.path.join(tmp, 'docs', '03_기능명세서')
    os.makedirs(sdir)
    with open(os.path.join(sdir, 'SRS_v1.0.md'), 'w', encoding='utf-8') as f:
        f.write("| SRS-F-XXX | 화면명 | UIS-ID | 호출 INF | FUNC-ID |\n|---|---|---|---|---|\n")
        f.write("| SRS-F-001 | 상품등록 | UIS-PRD-001 | INF-PRD-205, INF-PRD-206 | FUNC-product-001 |\n")
    srs = G.scan_srs(tmp)
    assert len(srs) == 1, srs
    assert srs[0]['id'] == 'SRS-F-001'
    assert srs[0]['name'] == '상품등록'
    assert 'UIS-PRD-001' in srs[0]['uis']
    assert set(srs[0]['inf']) == {'INF-PRD-205', 'INF-PRD-206'}
    assert srs[0]['func'] == 'FUNC-product-001'
    assert srs[0]['domain'] == 'product'


def test_scan_srs_absent_graceful():
    tmp = tempfile.mkdtemp()
    os.makedirs(os.path.join(tmp, 'docs'))
    assert G.scan_srs(tmp) == []


if __name__ == '__main__':
    for name, fn in sorted(globals().items()):
        if name.startswith('test_') and callable(fn):
            fn()
            print('PASS', name)
