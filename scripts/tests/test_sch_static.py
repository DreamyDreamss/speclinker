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
                   'evidence':[], 'referencedByInfRange':[]},
                  open(os.path.join(tmp,'_tmp/sch_draft/product/appln.json'),'w',encoding='utf-8'))
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
        assert os.path.exists(os.path.join(tmp,'docs/05_설계서/product/DB_product.md'))
        assert os.path.exists(os.path.join(tmp,'docs/05_설계서/DB_Schema.md'))
        et = json.load(open(os.path.join(tmp,'_tmp/sch_enrich_todo.json'),encoding='utf-8'))
        assert any(d['name']=='product' for d in et), et
        print('PASS: test_build_static_emit')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == '__main__':
    test_sch_draft_columns()
    test_create_table_parse()
    test_build_static_emit()
