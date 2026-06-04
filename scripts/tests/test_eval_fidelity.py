#!/usr/bin/env python3
"""eval_fidelity 검증 (합성)."""
import os, sys, tempfile, shutil
SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPTS)

def test_sql_tables():
    import eval_fidelity as e
    sql = "SELECT a FROM ORD_M o JOIN PRD_M p ON o.id=p.id WHERE 1=1; UPDATE ORD_PAY_D SET x=1"
    t = e.tables_from_sql(sql)
    assert {'ORD_M', 'PRD_M', 'ORD_PAY_D'} <= t, t
    print('PASS: test_sql_tables')

def test_consistency_score():
    import eval_fidelity as e
    tmp = tempfile.mkdtemp()
    try:
        os.makedirs(os.path.join(tmp, 'src'), exist_ok=True)
        sqlp = os.path.join(tmp, 'src/m.xml')
        open(sqlp, 'w', encoding='utf-8').write("<select>SELECT 1 FROM ORD_M JOIN PRD_M</select>")
        inf_dir = os.path.join(tmp, 'docs/05_설계서/order/INF')
        os.makedirs(inf_dir, exist_ok=True)
        # spec tables: ORD_M, PRD_M, EXTRA_T (EXTRA_T는 SQL에 없음 → precision↓)
        open(os.path.join(inf_dir, 'INF-ORD-001.md'), 'w', encoding='utf-8').write(
            "---\ninf-id: INF-ORD-001\ntables:\n  - ORD_M\n  - PRD_M\n  - EXTRA_T\n---\n"
            "> **근거 소스:** `src/m.xml`\n")
        rep = e.score_consistency(tmp, sample=10)
        assert rep['inf_evaluated'] == 1, rep
        # spec={ORD_M,PRD_M,EXTRA_T}, source={ORD_M,PRD_M} → P=2/3, R=2/2=1.0
        assert abs(rep['precision'] - 2/3) < 0.01, rep
        assert abs(rep['recall'] - 1.0) < 0.01, rep
        print('PASS: test_consistency_score')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == '__main__':
    test_sql_tables()
    test_consistency_score()
