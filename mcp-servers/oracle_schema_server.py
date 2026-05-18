"""
Oracle Schema Inspector MCP Server

환경변수:
  PROJECT_DIR  - 프로젝트 루트 경로 (선택 — .env.{ENV} 자동 로드)
  ENV          - 환경 이름 (local | dev | stg | prd), 기본값: local
  ORA_HOST     - Oracle 서버 호스트 또는 IP
  ORA_PORT     - Oracle 포트 (기본 1521)
  ORA_SERVICE  - Oracle Service Name (SID 대신 권장)
  ORA_USER     - 접속 사용자명
  ORA_PASSWORD - 비밀번호

python-oracledb Thin 모드로 동작 — Oracle Client(Instant Client) 설치 불필요.
"""

import os
import json
from pathlib import Path
from typing import Optional

# ------------------------------------------------------------------
# 1. 프로젝트 .env 로드
# ------------------------------------------------------------------
def _load_env() -> dict:
    project_dir = os.environ.get("PROJECT_DIR", "")
    env_name    = os.environ.get("ENV", "local")
    if project_dir:
        env_file = Path(project_dir) / "config" / f".env.{env_name}"
        if env_file.exists():
            from dotenv import dotenv_values
            return dict(dotenv_values(str(env_file)))
    return dict(os.environ)

_cfg = _load_env()

def _get(key: str, default: str = "") -> str:
    return _cfg.get(key, os.environ.get(key, default))

# ------------------------------------------------------------------
# 2. SQLAlchemy Oracle 엔진 (python-oracledb Thin)
# ------------------------------------------------------------------
import sqlalchemy
import pandas as pd
from urllib.parse import quote_plus
from readonly_guard import validate_readonly, attach_readonly_guard

def _build_engine() -> sqlalchemy.engine.Engine:
    user     = quote_plus(_get("ORA_USER"))
    password = quote_plus(_get("ORA_PASSWORD"))
    host     = _get("ORA_HOST")
    port     = _get("ORA_PORT", "1521")
    service  = _get("ORA_SERVICE")
    engine = sqlalchemy.create_engine(
        f"oracle+oracledb://{user}:{password}@{host}:{port}/?service_name={service}",
        connect_args={"mode": "default"},
        pool_size=1,
        max_overflow=0,
    )
    attach_readonly_guard(engine)
    return engine

_engine: Optional[sqlalchemy.engine.Engine] = None

def _engine_get() -> sqlalchemy.engine.Engine:
    global _engine
    if _engine is None:
        _engine = _build_engine()
    return _engine

def _query(sql: str, params: dict | None = None) -> list[dict]:
    with _engine_get().connect() as conn:
        df = pd.read_sql_query(sqlalchemy.text(sql), conn, params=params or {})
    return json.loads(df.to_json(orient="records", date_format="iso", force_ascii=False))

# 시스템 계정 제외 목록
_SYS_USERS = (
    "SYS","SYSTEM","OUTLN","DIP","ORACLE_OCM","DBSNMP","APPQOSSYS",
    "WMSYS","EXFSYS","CTXSYS","ANONYMOUS","XDB","ORDPLUGINS","ORDSYS",
    "SI_INFORMTN_SCHEMA","MDSYS","OLAPSYS","MDDATA","XS$NULL","LBACSYS",
    "OJVMSYS","DVSYS","AUDSYS","APEX_PUBLIC_USER","FLOWS_FILES",
    "APEX_030200","APEX_040200","OWBSYS","OWBSYS_AUDIT","SCOTT",
    "HR","OE","PM","SH","BI","IX",
)
_SYS_USERS_SQL = ", ".join(f"'{u}'" for u in _SYS_USERS)

# ------------------------------------------------------------------
# 3. MCP 서버
# ------------------------------------------------------------------
from mcp.server.fastmcp import FastMCP

mcp = FastMCP(
    "Oracle Schema Inspector",
    instructions=(
        "Oracle 데이터베이스의 딕셔너리(ALL_* 뷰)를 조회하여 "
        "스키마/테이블 목록, 컬럼 정의, 인덱스, FK 제약을 반환합니다. "
        "SELECT 전용 — DDL/DML 실행 불가."
    ),
)

# ------------------------------------------------------------------
# Tool 1: 스키마(사용자) 목록
# ------------------------------------------------------------------
@mcp.tool()
def ora_list_schemas() -> str:
    """
    Oracle 사용자(= 스키마) 목록을 반환합니다.
    SYS, SYSTEM 등 시스템 계정은 제외합니다.
    """
    rows = _query(f"""
        SELECT username, account_status, created
        FROM all_users
        WHERE username NOT IN ({_SYS_USERS_SQL})
        ORDER BY username
    """)
    return json.dumps(rows, ensure_ascii=False, indent=2)

# ------------------------------------------------------------------
# Tool 2: 테이블 목록
# ------------------------------------------------------------------
@mcp.tool()
def ora_list_tables(schema: str = "", table_filter: str = "") -> str:
    """
    지정 스키마의 테이블·뷰 목록을 반환합니다.

    Args:
        schema: 조회할 스키마(사용자)명. 빈 값이면 전체(시스템 제외).
        table_filter: 테이블명 LIKE 필터 (예: 'ORD_%'). 빈 값이면 전체.
    """
    conds = [f"t.owner NOT IN ({_SYS_USERS_SQL})"]
    params: dict = {}

    if schema:
        conds.append("t.owner = :owner")
        params["owner"] = schema.upper()
    if table_filter:
        conds.append("t.table_name LIKE :tfilter")
        params["tfilter"] = table_filter.upper()

    where = " AND ".join(conds)
    rows = _query(f"""
        SELECT t.owner, t.table_name, t.num_rows, tc.comments
        FROM all_tables t
        LEFT JOIN all_tab_comments tc
          ON t.owner = tc.owner AND t.table_name = tc.table_name
        WHERE {where}
        UNION ALL
        SELECT v.owner, v.view_name AS table_name, NULL AS num_rows, vc.comments
        FROM all_views v
        LEFT JOIN all_tab_comments vc
          ON v.owner = vc.owner AND v.view_name = vc.table_name
        WHERE v.owner NOT IN ({_SYS_USERS_SQL})
        ORDER BY 1, 2
    """, params)
    return json.dumps(rows, ensure_ascii=False, indent=2)

# ------------------------------------------------------------------
# Tool 3: 테이블 컬럼 정의
# ------------------------------------------------------------------
@mcp.tool()
def ora_describe_table(table_name: str, schema: str = "") -> str:
    """
    테이블의 컬럼 정의를 반환합니다. DB_Schema.md 작성에 사용합니다.

    Args:
        table_name: 테이블명 (대소문자 구분 없음)
        schema: 스키마(사용자)명 (빈 값이면 자동 탐색)

    Returns:
        컬럼명, 데이터타입, 길이/정밀도, NULL 허용, 기본값, PK 여부, 설명
    """
    params: dict = {"tname": table_name.upper()}
    owner_cond = ""
    if schema:
        owner_cond = "AND c.owner = :owner"
        params["owner"] = schema.upper()

    rows = _query(f"""
        SELECT
            c.column_id,
            c.column_name,
            c.data_type,
            c.data_length,
            c.data_precision,
            c.data_scale,
            c.nullable,
            c.data_default,
            CASE WHEN pk.column_name IS NOT NULL THEN 'Y' ELSE 'N' END AS is_pk,
            cc.comments
        FROM all_tab_columns c
        LEFT JOIN all_col_comments cc
          ON c.owner = cc.owner
         AND c.table_name = cc.table_name
         AND c.column_name = cc.column_name
        LEFT JOIN (
            SELECT ac.owner, ac.table_name, acc.column_name
            FROM all_constraints ac
            JOIN all_cons_columns acc
              ON ac.owner = acc.owner
             AND ac.constraint_name = acc.constraint_name
            WHERE ac.constraint_type = 'P'
        ) pk
          ON c.owner = pk.owner
         AND c.table_name = pk.table_name
         AND c.column_name = pk.column_name
        WHERE c.table_name = :tname
          {owner_cond}
        ORDER BY c.column_id
    """, params)
    if not rows:
        return f"테이블 '{table_name}'을 찾을 수 없습니다."
    return json.dumps(rows, ensure_ascii=False, indent=2)

# ------------------------------------------------------------------
# Tool 4: 인덱스
# ------------------------------------------------------------------
@mcp.tool()
def ora_get_indexes(table_name: str, schema: str = "") -> str:
    """
    테이블의 인덱스 목록(컬럼 포함)을 반환합니다.

    Args:
        table_name: 테이블명
        schema: 스키마명 (빈 값이면 자동 탐색)
    """
    params: dict = {"tname": table_name.upper()}
    owner_cond = ""
    if schema:
        owner_cond = "AND i.table_owner = :owner"
        params["owner"] = schema.upper()

    rows = _query(f"""
        SELECT
            i.index_name,
            i.uniqueness,
            i.index_type,
            ic.column_name,
            ic.column_position,
            ic.descend
        FROM all_indexes i
        JOIN all_ind_columns ic
          ON i.owner = ic.index_owner
         AND i.index_name = ic.index_name
        WHERE i.table_name = :tname
          {owner_cond}
        ORDER BY i.index_name, ic.column_position
    """, params)
    return json.dumps(rows, ensure_ascii=False, indent=2)

# ------------------------------------------------------------------
# Tool 5: FK 제약
# ------------------------------------------------------------------
@mcp.tool()
def ora_get_foreign_keys(table_name: str, schema: str = "") -> str:
    """
    테이블의 FK 제약 조건을 반환합니다.

    Args:
        table_name: 자식 테이블명
        schema: 스키마명
    """
    params: dict = {"tname": table_name.upper()}
    owner_cond = ""
    if schema:
        owner_cond = "AND fk.owner = :owner"
        params["owner"] = schema.upper()

    rows = _query(f"""
        SELECT
            fk.constraint_name,
            fkc.column_name     AS fk_column,
            pk.owner            AS ref_owner,
            pk.table_name       AS ref_table,
            pkc.column_name     AS ref_column,
            fk.delete_rule
        FROM all_constraints fk
        JOIN all_cons_columns fkc
          ON fk.owner = fkc.owner
         AND fk.constraint_name = fkc.constraint_name
        JOIN all_constraints pk
          ON fk.r_owner = pk.owner
         AND fk.r_constraint_name = pk.constraint_name
        JOIN all_cons_columns pkc
          ON pk.owner = pkc.owner
         AND pk.constraint_name = pkc.constraint_name
         AND fkc.position = pkc.position
        WHERE fk.constraint_type = 'R'
          AND fk.table_name = :tname
          {owner_cond}
        ORDER BY fk.constraint_name, fkc.position
    """, params)
    return json.dumps(rows, ensure_ascii=False, indent=2)

# ------------------------------------------------------------------
# Tool 6: SELECT 실행 (읽기 전용)
# ------------------------------------------------------------------
@mcp.tool()
def ora_execute_select(sql: str, limit: int = 100) -> str:
    """
    임의의 SELECT 쿼리를 실행합니다.
    DDL(CREATE/ALTER/DROP) 및 DML(INSERT/UPDATE/DELETE)은 거부됩니다.

    Args:
        sql: 실행할 SELECT 쿼리
        limit: 최대 반환 행 수 (기본 100, 최대 1000)
    """
    err = validate_readonly(sql)
    if err:
        return f"오류: {err}"

    limit = min(int(limit), 1000)
    sql_upper = sql.upper()
    if "FETCH FIRST" not in sql_upper and "ROWNUM" not in sql_upper:
        safe_sql = f"{sql.rstrip(';')} FETCH FIRST {limit} ROWS ONLY"
    else:
        safe_sql = sql

    rows = _query(safe_sql)
    return json.dumps({"count": len(rows), "rows": rows}, ensure_ascii=False, indent=2)

# ------------------------------------------------------------------
# Tool 7: 테이블 명세서 전체 (one-shot)
# ------------------------------------------------------------------
@mcp.tool()
def ora_full_table_spec(table_name: str, schema: str = "") -> str:
    """
    테이블의 컬럼 + 인덱스 + FK를 한 번에 반환합니다.
    DB_Schema.md 자동 생성에 사용합니다.

    Args:
        table_name: 테이블명
        schema: 스키마명
    """
    columns = json.loads(ora_describe_table(table_name, schema))
    indexes = json.loads(ora_get_indexes(table_name, schema))
    fkeys   = json.loads(ora_get_foreign_keys(table_name, schema))

    result = {
        "table":        table_name.upper(),
        "schema":       schema.upper() if schema else "(auto)",
        "columns":      columns,
        "indexes":      indexes,
        "foreign_keys": fkeys,
    }
    return json.dumps(result, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    mcp.run()
