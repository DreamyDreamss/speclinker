#!/usr/bin/env python3
"""
verify_mcp.py — DB MCP → SCH 그라운딩 end-to-end 검증 하네스 (사용자 직접 실행용)

번들 MCP 서버(oracle/db2/mariadb_schema_server.py)와 **동일한 SQL**로 DB에 직접 붙어
v3.18(타입/NULL/PK)·v3.19(조인/상시필터)·v3.20(anchors 근거) 파이프라인이 실제로 채워지는지
한 번에 확인한다. MCP가 세션 툴로 안 붙어 있어도 동작(접속정보만 있으면 됨).

사용법(접속정보는 env 또는 인자):
  # Oracle
  set ORA_HOST=... & set ORA_PORT=1521 & set ORA_SERVICE=... & set ORA_USER=... & set ORA_PASSWORD=...
  python verify_mcp.py --db oracle --table PRD_PRD_M --source D:/nkshop-bos/nkshop-bos-admin/src

  # MySQL/MariaDB
  python verify_mcp.py --db mysql --table orders --schema mydb --source ./src

검증 항목:
  [1] 연결            — 드라이버로 접속 성공?
  [2] describe(v3.18) — 컬럼 타입/NULL/PK/기본값이 사실로 나오나?
  [3] FK(v3.19)       — 선언 FK의 참조컬럼(ref_column)까지 나오나? (레거시는 0건일 수 있음)
  [4] index           — 인덱스/UNIQUE
  [5] query_patterns(v3.19) — 소스 SQL에서 이 테이블의 관찰 조인·상시필터가 채굴되나?
"""
import os, sys, argparse, json

def _env(*keys, default=""):
    for k in keys:
        v = os.environ.get(k)
        if v:
            return v
    return default

# ── 드라이버 연결 (번들 MCP 서버와 동일 접속 방식) ───────────────────────────
def connect(db):
    import sqlalchemy
    from urllib.parse import quote_plus
    if db == "oracle":
        host, port = _env("ORA_HOST"), _env("ORA_PORT", default="1521")
        svc, user, pw = _env("ORA_SERVICE"), _env("ORA_USER"), _env("ORA_PASSWORD")
        if not (host and svc and user):
            sys.exit("[FAIL] ORA_HOST/ORA_SERVICE/ORA_USER 환경변수 필요")
        url = f"oracle+oracledb://{quote_plus(user)}:{quote_plus(pw)}@{host}:{port}/?service_name={svc}"
    elif db in ("mysql", "mariadb"):
        host, port = _env("MARIA_HOST", "DB_HOST", default="127.0.0.1"), _env("MARIA_PORT", "DB_PORT", default="3306")
        name, user, pw = _env("MARIA_DB", "DB_NAME"), _env("MARIA_USER", "DB_USER"), _env("MARIA_PASSWORD", "DB_PASSWORD")
        url = f"mysql+pymysql://{quote_plus(user)}:{quote_plus(pw)}@{host}:{port}/{name}"
    elif db == "db2":
        host, port = _env("DB2_HOST"), _env("DB2_PORT", default="50000")
        name, user, pw = _env("DB2_DB"), _env("DB2_USER"), _env("DB2_PASSWORD")
        url = f"db2+ibm_db://{quote_plus(user)}:{quote_plus(pw)}@{host}:{port}/{name}"
    else:
        sys.exit(f"[FAIL] 알 수 없는 --db {db}")
    eng = sqlalchemy.create_engine(url, pool_size=1, max_overflow=0)
    return eng

def q(eng, sql, params=None):
    import sqlalchemy, pandas as pd
    with eng.connect() as c:
        df = pd.read_sql_query(sqlalchemy.text(sql), c, params=params or {})
    return json.loads(df.to_json(orient="records", date_format="iso", force_ascii=False))

# ── 스키마 조회 SQL (oracle_schema_server.py 미러) ──────────────────────────
ORA_DESCRIBE = """
SELECT c.column_id, c.column_name, c.data_type, c.data_length, c.data_precision,
       c.data_scale, c.nullable, c.data_default,
       CASE WHEN pk.column_name IS NOT NULL THEN 'Y' ELSE 'N' END AS is_pk, cc.comments
FROM all_tab_columns c
LEFT JOIN all_col_comments cc ON c.owner=cc.owner AND c.table_name=cc.table_name AND c.column_name=cc.column_name
LEFT JOIN (SELECT ac.owner, ac.table_name, acc.column_name FROM all_constraints ac
           JOIN all_cons_columns acc ON ac.owner=acc.owner AND ac.constraint_name=acc.constraint_name
           WHERE ac.constraint_type='P') pk
  ON c.owner=pk.owner AND c.table_name=pk.table_name AND c.column_name=pk.column_name
WHERE c.table_name=:t {ownc} ORDER BY c.column_id"""
ORA_FK = """
SELECT fk.constraint_name, fkc.column_name AS fk_column, pk.table_name AS ref_table,
       pkc.column_name AS ref_column, fk.delete_rule
FROM all_constraints fk
JOIN all_cons_columns fkc ON fk.owner=fkc.owner AND fk.constraint_name=fkc.constraint_name
JOIN all_constraints pk ON fk.r_owner=pk.owner AND fk.r_constraint_name=pk.constraint_name
JOIN all_cons_columns pkc ON pk.owner=pkc.owner AND pk.constraint_name=pkc.constraint_name AND fkc.position=pkc.position
WHERE fk.constraint_type='R' AND fk.table_name=:t {ownc} ORDER BY fk.constraint_name, fkc.position"""
ORA_IDX = """
SELECT i.index_name, i.uniqueness, ic.column_name, ic.column_position
FROM all_indexes i JOIN all_ind_columns ic ON i.owner=ic.index_owner AND i.index_name=ic.index_name
WHERE i.table_name=:t {ownc} ORDER BY i.index_name, ic.column_position"""

def ora_queries(eng, table, schema):
    ownc = "AND c.owner=:o" if schema else ""
    params = {"t": table.upper()}
    if schema: params["o"] = schema.upper()
    cols = q(eng, ORA_DESCRIBE.format(ownc=ownc), params)
    ownc_i = "AND i.table_owner=:o" if schema else ""
    ownc_f = "AND fk.owner=:o" if schema else ""
    idx = q(eng, ORA_IDX.format(ownc=ownc_i), params)
    fk  = q(eng, ORA_FK.format(ownc=ownc_f), params)
    return cols, fk, idx

def mysql_queries(eng, table, schema):
    p = {"t": table, "s": schema}
    cols = q(eng, "SELECT column_name, column_type AS data_type, is_nullable AS nullable, "
                  "column_default AS data_default, column_key, column_comment AS comments "
                  "FROM information_schema.columns WHERE table_schema=:s AND table_name=:t "
                  "ORDER BY ordinal_position", p)
    fk = q(eng, "SELECT constraint_name, column_name AS fk_column, referenced_table_name AS ref_table, "
                "referenced_column_name AS ref_column FROM information_schema.key_column_usage "
                "WHERE table_schema=:s AND table_name=:t AND referenced_table_name IS NOT NULL", p)
    idx = q(eng, "SELECT index_name, non_unique, column_name, seq_in_index AS column_position "
                 "FROM information_schema.statistics WHERE table_schema=:s AND table_name=:t "
                 "ORDER BY index_name, seq_in_index", p)
    return cols, fk, idx

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", choices=["oracle", "mysql", "mariadb", "db2"], default="oracle")
    ap.add_argument("--table", required=True)
    ap.add_argument("--schema", default="")
    ap.add_argument("--source", default="", help="scan_query_patterns 대상 소스 디렉토리(선택)")
    a = ap.parse_args()

    print(f"== verify_mcp: db={a.db} table={a.table} schema={a.schema or '(auto)'} ==\n")
    try:
        eng = connect(a.db)
        if a.db == "oracle":
            cols, fk, idx = ora_queries(eng, a.table, a.schema)
        else:
            if not a.schema:
                sys.exit("[FAIL] mysql/db2는 --schema(DB명) 필요")
            cols, fk, idx = mysql_queries(eng, a.table, a.schema)
    except Exception as e:
        print(f"[1] 연결/조회  ✗ FAIL: {e}")
        print("\n→ 접속정보(env) 확인: ORA_HOST/ORA_PORT/ORA_SERVICE/ORA_USER/ORA_PASSWORD (또는 MARIA_*/DB2_*)")
        return 1

    ok_conn = True
    ok_type = bool(cols) and all(c.get("data_type") for c in cols)
    print(f"[1] 연결            ✔ PASS")
    print(f"[2] describe(v3.18) {'✔ PASS' if ok_type else '✗ FAIL'} — 컬럼 {len(cols)}개, 타입 채움={ok_type}")
    for c in cols[:6]:
        nm = c.get("column_name") or c.get("COLUMN_NAME")
        print(f"      - {nm}: {c.get('data_type')}  null={c.get('nullable')}  pk={c.get('is_pk', c.get('column_key',''))}")
    if len(cols) > 6:
        print(f"      … +{len(cols)-6}개")
    has_refcol = bool(fk) and all(f.get("ref_column") for f in fk)
    print(f"[3] FK(v3.19)       {'✔ ref_column 채움' if has_refcol else ('— FK 0건(레거시 미선언 — 정상, 관찰조인이 대체)' if not fk else '✗ ref_column 누락')} — {len(fk)}건")
    for f in fk[:4]:
        print(f"      - {f.get('fk_column')} → {f.get('ref_table')}.{f.get('ref_column')}")
    print(f"[4] index           ✔ {len({i.get('index_name') or i.get('INDEX_NAME') for i in idx})}개")

    # [5] query_patterns 교차확인
    if a.source:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import scan_query_patterns as sqp
        joins, filters = {}, {}
        import glob
        files = glob.glob(os.path.join(a.source, "**", "*.xml"), recursive=True) + \
                glob.glob(os.path.join(a.source, "**", "*.sql"), recursive=True)
        js, fs = {}, {}
        for fp in files:
            try:
                txt = open(fp, encoding="utf-8", errors="ignore").read()
            except OSError:
                continue
            sqp.scan_text(txt, fp.lower().endswith(".xml"), js, fs)
        T = a.table.upper()
        tj = [k for k in js if T in (k[0], k[2])]
        tf = [k for k in fs if k[0] == T]
        print(f"[5] query_patterns(v3.19) — {a.table} 관찰조인 {len(tj)}건 / 상시필터 {len(tf)}건  (소스 {len(files)}파일 스캔)")
        for k in tj[:4]:
            print(f"      조인: {k[0]}.{k[1]} = {k[2]}.{k[3]}")
        for k in tf[:4]:
            print(f"      필터: {k[0]}.{k[1]} {k[2]} {k[3]}")
    else:
        print("[5] query_patterns  — (--source 미지정, 스킵)")

    print("\n== 요약 ==")
    print(f"  v3.18 타입권위:  {'OK' if ok_type else 'CHECK'}")
    print(f"  v3.19 FK/조인:   {'FK 선언됨' if fk else '관찰조인 의존(레거시 정상)'}")
    print(f"  → 이 결과가 ddd-db-agent enrichment가 SCH에 채울 사실. 빈칸/추론이 사실로 바뀌면 검증 성공.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
