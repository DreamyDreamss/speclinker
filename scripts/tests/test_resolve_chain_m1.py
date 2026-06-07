#!/usr/bin/env python3
"""M-1 검증: service/impl 해소 + MyBatis 문자열 네임스페이스 → XML (합성 픽스처)."""
import os, sys, tempfile, shutil
SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPTS)
import resolve_call_chain as rcc


def _w(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'w', encoding='utf-8').write(text)


def test_impl_files():
    ci = {'OrderService': ['/x/OrderService.java'],
          'OrderServiceImpl': ['/x/impl/OrderServiceImpl.java']}
    impls = rcc.impl_files('/x/OrderService.java', ci)
    assert any('OrderServiceImpl' in p for p in impls), impls
    # 이미 Impl이면 재귀 안 함
    assert rcc.impl_files('/x/impl/OrderServiceImpl.java', ci) == []
    print('PASS: test_impl_files')


def test_namespace_resolution():
    tmp = tempfile.mkdtemp()
    try:
        _w(os.path.join(tmp, 'src/main/resources/sqlmapper/StatMapper.xml'),
           '<?xml version="1.0"?>\n<mapper namespace="com.ex.stat">\n'
           '  <select id="list">SELECT * FROM STAT_T WHERE DEL_YN=\'N\'</select>\n</mapper>')
        java = os.path.join(tmp, 'src/com/ex/service/impl/StatServiceImpl.java')
        _w(java, 'package com.ex.service.impl;\n'
                 'public class StatServiceImpl {\n'
                 '  public void run(){ sqlSession.selectList("com.ex.stat.list", p); }\n}')
        rcc._NS_INDEX_CACHE.clear(); rcc._NS_SCAN_CACHE.clear()
        out = rcc.find_query_files_by_namespace(java, tmp)
        assert any('StatMapper.xml' in p for p in out), ('네임스페이스 매핑 실패', out)
        print('PASS: test_namespace_resolution')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_resolve_chain_service_impl():
    tmp = tempfile.mkdtemp()
    try:
        base = os.path.join(tmp, 'src/com/ex')
        _w(os.path.join(base, 'controller/OrderController.java'),
           'package com.ex.controller;\nimport com.ex.service.OrderService;\n'
           'public class OrderController { OrderService s; }')
        _w(os.path.join(base, 'service/OrderService.java'),
           'package com.ex.service;\npublic interface OrderService { void list(); }')
        _w(os.path.join(base, 'service/impl/OrderServiceImpl.java'),
           'package com.ex.service.impl;\nimport com.ex.dao.OrderMapper;\n'
           'public class OrderServiceImpl implements OrderService { OrderMapper m; }')
        _w(os.path.join(base, 'dao/OrderMapper.java'),
           'package com.ex.dao;\npublic interface OrderMapper { void list(); }')
        _w(os.path.join(tmp, 'src/main/resources/sqlmapper/OrderMapper.xml'),
           '<?xml version="1.0"?>\n<mapper namespace="com.ex.dao.OrderMapper">\n'
           '  <select id="list">SELECT ORD_NO FROM ORDERS</select>\n</mapper>')
        rcc._NS_INDEX_CACHE.clear(); rcc._NS_SCAN_CACHE.clear()
        ci = rcc.build_java_class_index(tmp)
        ctrl = os.path.join(base, 'controller/OrderController.java')
        res = rcc.resolve_chain(rcc.norm(ctrl), tmp, max_depth=2, class_index=ci)
        # service/impl 해소로 DAO(OrderMapper) 도달 + Mapper.xml 쿼리 발견
        assert any('OrderServiceImpl' in rcc.norm(f) for f in res['service']), ('Impl 미해소', res['service'])
        assert any('OrderMapper' in rcc.norm(f) for f in res['dao']), ('DAO 미도달(dao=0)', res['dao'])
        assert any('OrderMapper.xml' in rcc.norm(f) for f in res['query']), ('query=0', res['query'])
        assert any(t.upper() == 'ORDERS' for t in res['usedTables']), ('테이블 미추출', list(res['usedTables']))
        print('PASS: test_resolve_chain_service_impl')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    test_impl_files()
    test_namespace_resolution()
    test_resolve_chain_service_impl()
