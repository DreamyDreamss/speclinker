#!/usr/bin/env python3
"""scan_code_literals 검증."""
import os, sys, tempfile, shutil, json
SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPTS)

def test_scan_literals():
    import scan_code_literals as s
    sql = ("SELECT * FROM ORD_M WHERE PRD_APP_STS_CD = '20' AND USE_YN='Y' "
           "AND ORD_TP IN ('01','02') "
           "AND (SELECT CODE_NM FROM JT_CODE WHERE CODE_GRP_ID='PRD_APP_STS' AND CODE=A.PRD_APP_STS_CD) IS NOT NULL")
    lits = s.scan_sql(sql)
    by = {l['column']: l for l in lits}
    assert '20' in by['PRD_APP_STS_CD']['values'], by
    assert by['PRD_APP_STS_CD'].get('group') == 'PRD_APP_STS', by  # 소스 JT_CODE 패턴서 그룹 복원
    assert set(by['ORD_TP']['values']) >= {'01', '02'}, by
    assert 'Y' in by['USE_YN']['values'], by
    print('PASS: test_scan_literals')

def test_scan_dir():
    import scan_code_literals as s
    tmp = tempfile.mkdtemp()
    try:
        d = os.path.join(tmp, 'sql'); os.makedirs(d)
        open(os.path.join(d, 'm.xml'), 'w', encoding='utf-8').write(
            "<select>SELECT 1 FROM T WHERE STS_CD='03' AND DEL_YN='N'</select>")
        out = os.path.join(tmp, 'code_literals.json')
        n = s.scan_paths([d], out)
        data = json.load(open(out, encoding='utf-8'))
        cols = {x['column'] for x in data}
        assert 'STS_CD' in cols and 'DEL_YN' in cols, data
        print('PASS: test_scan_dir')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == '__main__':
    test_scan_literals()
    test_scan_dir()
