"""
DB2 Schema Inspector MCP Server

프로젝트의 .env.{ENV} 파일에서 DB 접속 정보를 로드하여
DB2 카탈로그(SYSCAT)를 조회하는 MCP 도구를 제공합니다.

환경변수:
  PROJECT_DIR  - 프로젝트 루트 경로 (예: D:/KDI source/nkshop-kdi-api)
  ENV          - 환경 이름 (local | dev | stg | prd), 기본값: local
  DB2_CLIDRIVER_PATH - ibm_db clidriver/bin 경로 (선택, DLL 경로 수동 설정 시)
"""

import os
import sys
import json
from pathlib import Path
from typing import Optional

# ------------------------------------------------------------------
# 1. clidriver DLL 경로 설정 (Windows 전용)
# ------------------------------------------------------------------
clidriver_path = os.environ.get("DB2_CLIDRIVER_PATH", "D:/v9.7fp11_ntx64_odbc_cli/clidriver/bin")
if sys.platform == "win32" and Path(clidriver_path).exists():
    os.add_dll_directory(clidriver_path)

# ------------------------------------------------------------------
# 2. 프로젝트 .env 로드
# ------------------------------------------------------------------
def _load_env() -> dict:
    project_dir = os.environ.get("PROJECT_DIR", "")
    env_name    = os.environ.get("ENV", "local")

    if project_dir:
        env_file = Path(project_dir) / "config" / f".env.{env_name}"
        if env_file.exists():
            from dotenv import dotenv_values
            return dict(dotenv_values(str(env_file)))

    # PROJECT_DIR 없으면 현재 환경변수 그대로 사용
    return dict(os.environ)

_cfg = _load_env()

def _get(key: str, default: str = "") -> str:
    return _cfg.get(key, os.environ.get(key, default))

# ------------------------------------------------------------------
# 3. SQLAlchemy DB2 엔진
# ------------------------------------------------------------------
import sqlalchemy
from urllib.parse import quote_plus
import pandas as pd
from readonly_guard import validate_readonly, attach_readonly_guard

def _build_engine() -> sqlalchemy.engine.Engine:
    user     = quote_plus(_get("DB2_USER"))
    password = quote_plus(_get("DB2_PASSWORD"))
    host     = _get("DB2_HOST")
    port     = _get("DB2_PORT", "50000")
    database = _get("DB2_DATABASE")
    engine = sqlalchemy.create_engine(
        f"db2+ibm_db://{user}:{password}@{host}:{port}/{database}"
        ";ConnectTimeout=5;QueryTimeout=60;",
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

def _query(sql: str) -> list[dict]:
    """SELECT 쿼리 실행 후 dict 목록 반환."""
    with _engine_get().connect() as conn:
        df = pd.read_sql_query(sql, conn)
    return json.loads(df.to_json(orient="records", date_format="iso", force_ascii=False))

# ------------------------------------------------------------------
# 4. MCP 서버
# ------------------------------------------------------------------
from mcp.server.fastmcp import FastMCP

mcp = FastMCP(
    "DB2 Schema Inspector",
    instructions=(
        "IBM DB2 데이터베이스의 카탈로그(SYSCAT)를 조회하여 "
        "테이블 목록, 컬럼 정의, 인덱스, FK 제약을 반환합니다. "
        "SELECT 전용 — DDL/DML 실행 불가."
    ),
)

# ------------------------------------------------------------------
# Tool 1: 스키마 목록
# ------------------------------------------------------------------
@mcp.tool()
def db2_list_schemas() -> str:
    """
    DB2에 존재하는 사용자 스키마 목록을 반환합니다.
    시스템 스키마(SYSIBM, SYSCAT 등)는 제외합니다.
    """
    rows = _query("""
        SELECT SCHEMANAME, OWNER, CREATE_TIME
        FROM SYSCAT.SCHEMATA
        WHERE SCHEMANAME NOT LIKE 'SYS%'
          AND SCHEMANAME NOT IN ('NULLID','SQLJ','IBMPDQ','IBMCONFIGURATION')
        ORDER BY SCHEMANAME
        WITH UR
    """)
    return json.dumps(rows, ensure_ascii=False, indent=2)

# ------------------------------------------------------------------
# Tool 2: 테이블 목록
# ------------------------------------------------------------------
@mcp.tool()
def db2_list_tables(schema: str = "", table_filter: str = "") -> str:
    """
    지정 스키마의 테이블/뷰 목록을 반환합니다.

    Args:
        schema: 조회할 스키마명 (빈 값이면 전체). 대소문자 구분 없음.
        table_filter: 테이블명 LIKE 필터 (예: 'BI_%'). 빈 값이면 전체.
    """
    where_parts = ["TYPE IN ('T','V')"]
    if schema:
        where_parts.append(f"TABSCHEMA = '{schema.upper()}'")
    else:
        where_parts.append("TABSCHEMA NOT LIKE 'SYS%'")
    if table_filter:
        where_parts.append(f"TABNAME LIKE '{table_filter.upper()}'")

    where = " AND ".join(where_parts)
    rows = _query(f"""
        SELECT TABSCHEMA, TABNAME, TYPE,
               CARD AS ROW_COUNT_APPROX,
               REMARKS
        FROM SYSCAT.TABLES
        WHERE {where}
        ORDER BY TABSCHEMA, TABNAME
        WITH UR
    """)
    return json.dumps(rows, ensure_ascii=False, indent=2)

# ------------------------------------------------------------------
# Tool 3: 테이블 컬럼 정의 (테이블 명세서)
# ------------------------------------------------------------------
@mcp.tool()
def db2_describe_table(table_name: str, schema: str = "") -> str:
    """
    테이블의 컬럼 정의를 반환합니다. DB_Schema.md 작성에 사용합니다.

    Args:
        table_name: 테이블명 (대소문자 구분 없음)
        schema: 스키마명 (빈 값이면 자동 탐색)

    Returns:
        컬럼명, 데이터타입, 길이, NULL 허용, 기본값, PK 여부, 설명
    """
    schema_cond = f"AND TABSCHEMA = '{schema.upper()}'" if schema else ""
    rows = _query(f"""
        SELECT
            c.colname,
            c.typename      AS data_type,
            c.length,
            c.scale,
            c.NULLS         AS nullable,
            c.DEFAULT       AS default_val,
            CASE WHEN pk.colname IS NOT NULL THEN 'Y' ELSE 'N' END AS is_pk,
            c.colno         AS col_order,
            c.remarks
        FROM SYSCAT.COLUMNS c
        LEFT JOIN (
            SELECT k.TABSCHEMA, k.TABNAME, k.colname
            FROM SYSCAT.KEYCOLUSE k
            JOIN SYSCAT.TABCONST tc
              ON k.TABSCHEMA = tc.TABSCHEMA
             AND k.TABNAME   = tc.TABNAME
             AND k.CONSTNAME = tc.CONSTNAME
            WHERE tc.TYPE = 'P'
        ) pk
          ON c.TABSCHEMA = pk.TABSCHEMA
         AND c.TABNAME   = pk.TABNAME
         AND c.colname   = pk.colname
        WHERE c.tabname = '{table_name.upper()}'
          {schema_cond}
        ORDER BY c.colno
        WITH UR
    """)
    if not rows:
        return f"테이블 '{table_name}'을 찾을 수 없습니다."
    return json.dumps(rows, ensure_ascii=False, indent=2)

# ------------------------------------------------------------------
# Tool 4: 인덱스
# ------------------------------------------------------------------
@mcp.tool()
def db2_get_indexes(table_name: str, schema: str = "") -> str:
    """
    테이블의 인덱스 목록(컬럼 포함)을 반환합니다.

    Args:
        table_name: 테이블명
        schema: 스키마명 (빈 값이면 자동 탐색)
    """
    schema_cond = f"AND i.TABSCHEMA = '{schema.upper()}'" if schema else ""
    rows = _query(f"""
        SELECT
            i.indname,
            i.uniquerule,
            ic.colname,
            ic.colorder
        FROM SYSCAT.INDEXES i
        JOIN SYSCAT.INDEXCOLUSE ic
          ON i.INDSCHEMA = ic.INDSCHEMA
         AND i.indname   = ic.indname
        WHERE i.tabname = '{table_name.upper()}'
          {schema_cond}
        ORDER BY i.indname, ic.colseq
        WITH UR
    """)
    return json.dumps(rows, ensure_ascii=False, indent=2)

# ------------------------------------------------------------------
# Tool 5: FK 제약
# ------------------------------------------------------------------
@mcp.tool()
def db2_get_foreign_keys(table_name: str, schema: str = "") -> str:
    """
    테이블의 FK 제약 조건을 반환합니다.

    Args:
        table_name: 자식 테이블명
        schema: 스키마명
    """
    schema_cond = f"AND r.TABSCHEMA = '{schema.upper()}'" if schema else ""
    rows = _query(f"""
        SELECT
            r.constname,
            fk.colname      AS fk_column,
            r.reftabschema,
            r.reftabname,
            pk.colname      AS ref_column,
            r.deleterule,
            r.updaterule
        FROM SYSCAT.REFERENCES r
        JOIN SYSCAT.KEYCOLUSE fk
          ON r.TABSCHEMA  = fk.TABSCHEMA
         AND r.tabname    = fk.tabname
         AND r.constname  = fk.constname
        JOIN SYSCAT.KEYCOLUSE pk
          ON r.reftabschema = pk.TABSCHEMA
         AND r.reftabname   = pk.tabname
         AND r.refkeyname   = pk.constname
         AND fk.colseq      = pk.colseq
        WHERE r.tabname = '{table_name.upper()}'
          {schema_cond}
        ORDER BY r.constname, fk.colseq
        WITH UR
    """)
    return json.dumps(rows, ensure_ascii=False, indent=2)

# ------------------------------------------------------------------
# Tool 6: SELECT 실행 (읽기 전용)
# ------------------------------------------------------------------
@mcp.tool()
def db2_execute_select(sql: str, limit: int = 100) -> str:
    """
    임의의 SELECT 쿼리를 실행합니다. WITH UR(uncommitted read)로 실행됩니다.
    DDL(CREATE/ALTER/DROP) 및 DML(INSERT/UPDATE/DELETE)은 거부됩니다.
    SQL 주석·CTE·세미콜론 체인을 통한 우회도 차단됩니다.

    Args:
        sql: 실행할 SELECT 쿼리 (단일 문장)
        limit: 최대 반환 행 수 (기본 100, 최대 1000)
    """
    err = validate_readonly(sql)
    if err:
        return f"오류: {err}"

    sql_upper = sql.upper()
    limit = min(int(limit), 1000)
    if "FETCH FIRST" not in sql_upper:
        safe_sql = f"{sql.rstrip(';')} FETCH FIRST {limit} ROWS ONLY WITH UR"
    else:
        safe_sql = sql

    rows = _query(safe_sql)
    return json.dumps({"count": len(rows), "rows": rows}, ensure_ascii=False, indent=2)

# ------------------------------------------------------------------
# Tool 7: 테이블 명세서 전체 (API명세 생성용 one-shot)
# ------------------------------------------------------------------
@mcp.tool()
def db2_full_table_spec(table_name: str, schema: str = "") -> str:
    """
    테이블의 컬럼 + 인덱스 + FK를 한 번에 반환합니다.
    DB_Schema.md 자동 생성에 사용합니다.

    Args:
        table_name: 테이블명
        schema: 스키마명
    """
    columns = json.loads(db2_describe_table(table_name, schema))
    indexes = json.loads(db2_get_indexes(table_name, schema))
    fkeys   = json.loads(db2_get_foreign_keys(table_name, schema))

    result = {
        "table": table_name.upper(),
        "schema": schema.upper() if schema else "(auto)",
        "columns": columns,
        "indexes": indexes,
        "foreign_keys": fkeys,
    }
    return json.dumps(result, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    mcp.run()
