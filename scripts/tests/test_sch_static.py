#!/usr/bin/env python3
"""build_sch_static / sch_facts 단위 검증 (합성 픽스처)."""
import os, sys, json, subprocess, tempfile, shutil
SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPTS)

def test_sch_draft_columns():
    import sch_facts
    tmp = tempfile.mkdtemp()
    try:
        draft = os.path.join(tmp, 'appln.json')
        json.dump({'table':'appln','domain':'product',
                   'columns':{'DEPT_ID':{'seen':1},'APPLN_NO':{'seen':2}},
                   'evidence':[], 'referencedByInfRange':[]},
                  open(draft,'w',encoding='utf-8'))
        facts = sch_facts.collect_table_facts('appln', [draft], db=None, src_roots=[])
        names = [c['name'] for c in facts['columns']]
        assert 'DEPT_ID' in names and 'APPLN_NO' in names, names
        # 타입 없음 → None (LLM-TODO 대상)
        assert all(c['type'] is None for c in facts['columns']), facts['columns']
        print('PASS: test_sch_draft_columns')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

def test_create_table_parse():
    import sch_facts
    sql = '''CREATE TABLE users (
        id BIGINT NOT NULL AUTO_INCREMENT,
        email VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'USER',
        PRIMARY KEY (id)
    );'''
    cols = sch_facts.parse_create_table(sql, 'users')
    by = {c['name']: c for c in cols}
    assert by['id']['type'].upper().startswith('BIGINT'), by['id']
    assert by['email']['nullable'] is False, by['email']
    assert by['role']['default'] == "'USER'", by['role']
    assert by['id']['pk'] is True, by['id']
    print('PASS: test_create_table_parse')

def test_build_static_emit():
    tmp = tempfile.mkdtemp()
    try:
        os.makedirs(os.path.join(tmp,'docs/05_설계서/product/INF'), exist_ok=True)
        os.makedirs(os.path.join(tmp,'_tmp/sch_draft/product'), exist_ok=True)
        json.dump({'domains':[{'name':'product','code':'PRD','rootPaths':[]}]},
                  open(os.path.join(tmp,'docs/05_설계서/_domain_plan.json'),'w',encoding='utf-8'))
        json.dump([{'name':'product','code':'PRD','existing':[],'missing':['appln']}],
                  open(os.path.join(tmp,'_tmp/sch_todo.json'),'w',encoding='utf-8'))
        json.dump({'table':'appln','domain':'product','columns':{'DEPT_ID':{'seen':1},'STS_CD':{'seen':1}},
                   'evidence':['src/main/resources/mapper/ApplnMapper.xml'],
                   'referencedByRouter':['src/main/java/.../ApplnController.java'],
                   'referencedByInfRange':[]},
                  open(os.path.join(tmp,'_tmp/sch_draft/product/appln.json'),'w',encoding='utf-8'))
        # query_patterns: 관찰 조인 + 상시필터 (B)
        os.makedirs(os.path.join(tmp,'docs/05_설계서/_machine'), exist_ok=True)
        json.dump({'joins':[{'table_a':'APPLN','col_a':'DEPT_ID','table_b':'DEPT',
                             'col_b':'DEPT_ID','freq':4,'sources':['ApplnMapper.xml']}],
                   'filters':[{'table':'APPLN','col':'DEL_YN','op':'=','value':"'N'",
                              'freq':9,'sources':['ApplnMapper.xml']}]},
                  open(os.path.join(tmp,'docs/05_설계서/_machine/query_patterns.json'),'w',encoding='utf-8'))
        open(os.path.join(tmp,'project.env'),'w',encoding='utf-8').write('PLUGIN_PATH='+SCRIPTS.replace('\\','/').rsplit('/scripts',1)[0]+'\n')
        env = dict(os.environ, PYTHONUTF8='1')
        r = subprocess.run([sys.executable, os.path.join(SCRIPTS,'build_sch_static.py'), tmp],
                           capture_output=True, text=True, env=env)
        assert r.returncode == 0, r.stderr
        sch = os.path.join(tmp,'docs/05_설계서/product/SCH/SCH-PRD-001.md')
        assert os.path.exists(sch), 'SCH 파일 없음'
        c = open(sch,encoding='utf-8').read()
        assert 'sch-id: SCH-PRD-001' in c and 'table: appln' in c
        assert 'DEPT_ID' in c
        assert 'LLM-TODO' in c
        # B: 컬럼표 키열 + 관찰조인(쿼리관찰) + 참조컬럼 + 상시필터 접이식
        assert '| 컬럼명 | 타입 | NULL | 키 |' in c, '키 컬럼 헤더 누락'
        assert '쿼리관찰(4)' in c and 'DEPT' in c, '관찰 조인 누락'
        assert '참조 컬럼' in c, 'FK 참조컬럼 헤더 누락'
        assert '상시 필터' in c and 'DEL_YN' in c, '상시필터 섹션 누락'
        # SCH anchors 구조화(JIT 소스조회): 쿼리/라우터 근거가 frontmatter anchors로
        assert 'anchors:' in c and 'ApplnMapper.xml (query)' in c, 'SCH anchors 누락'
        assert 'ApplnController.java (router)' in c, 'router anchor 누락'
        assert os.path.exists(os.path.join(tmp,'docs/05_설계서/product/DB_product.md'))
        assert os.path.exists(os.path.join(tmp,'docs/05_설계서/DB_Schema.md'))
        et = json.load(open(os.path.join(tmp,'_tmp/sch_enrich_todo.json'),encoding='utf-8'))
        assert any(d['name']=='product' for d in et), et
        print('PASS: test_build_static_emit')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

def test_scan_query_patterns():
    import scan_query_patterns as sqp
    tmp = tempfile.mkdtemp()
    try:
        # MyBatis XML: 조인(별칭) + soft-delete + 테넌트 필터 + 구식 콤마조인
        xml = '''<mapper>
        <select id="list">
          SELECT o.ORD_NO, i.QTY
          FROM ORDERS o
          JOIN ORDER_ITEM i ON o.ORD_NO = i.ORD_NO
          WHERE o.DEL_YN = 'N' AND o.COMP_CD = #{compCd}
        </select>
        <select id="old">
          SELECT * FROM ORDERS o, MEMBER m WHERE o.MBR_NO = m.MBR_NO
        </select>
        </mapper>'''
        open(os.path.join(tmp,'OrderMapper.xml'),'w',encoding='utf-8').write(xml)
        out = os.path.join(tmp,'qp.json')
        nj, nf = sqp.scan_paths([tmp], out)
        data = json.load(open(out,encoding='utf-8'))
        jset = {(j['table_a'],j['col_a'],j['table_b'],j['col_b']) for j in data['joins']}
        # 무방향 정규화 → (ORDER_ITEM,ORD_NO,ORDERS,ORD_NO) 정렬형
        assert any('ORDERS' in (a,c) and 'ORDER_ITEM' in (a,c) for a,b,c,d in jset), jset
        assert any('MEMBER' in (a,c) for a,b,c,d in jset), ('구식 콤마조인 누락', jset)
        fcols = {(f['table'],f['col']) for f in data['filters']}
        assert ('ORDERS','DEL_YN') in fcols, ('soft-delete 누락', fcols)
        assert ('ORDERS','COMP_CD') in fcols, ('테넌트 필터 누락', fcols)
        print('PASS: test_scan_query_patterns')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == '__main__':
    test_sch_draft_columns()
    test_create_table_parse()
    test_build_static_emit()
    test_scan_query_patterns()
