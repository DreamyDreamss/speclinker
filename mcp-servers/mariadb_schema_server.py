"""
MariaDB / MySQL Schema Inspector MCP Server

환경변수:
  PROJECT_DIR   - 프로젝트 루트 경로 (선택 — .env.{ENV} 자동 로드)
  ENV           - 환경 이름 (local | dev | stg | prd), 기본값: local
  MDB_HOST      - MariaDB/MySQL 호스트 또는 IP
  MDB_PORT      - 포트 (기본 3306)
  MDB_DATABASE  - 기본 데이터베이스(스키마)명
  MDB_USER      - 접속 사용자명
  MDB_PASSWORD  - 비밀번호

pymysql + SQLAlchemy 사용. MariaDB / MySQL 모두 호환.
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
# 2. SQLAlchemy MariaDB 엔진 (pymysql)
# ------------------------------------------------------------------
import sqlalchemy
import pandas as pd
from urllib.parse import quote_plus
from readonly_guard import validate_readonly, attach_readonly_guard

def _build_engine() -> sqlalchemy.engine.Engine:
    user     = quote_plus(_get("MDB_USER"))
    password = quote_plus(_get("MDB_PASSWORD"))
    host     = _get("MDB_HOST")
    port     = _get("MDB_PORT", "3306")
    database = _get("MDB_DATABASE")
    engine = sqlalchemy.create_engine(
        f"mysql+pymysql://{user}:{password}@{host}:{port}/{database}"
        "?charset=utf8mb4",
        connect_args={"connect_timeout": 5},
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

# 동시 접속 시 간헐 연결종료 — 엔진 폐기 후 재접속 재시도 (L-4)
_TRANSIENT = ("2006", "2013", "lost connection", "server has gone away",
              "broken pipe", "not connected", "connection closed")

def _query(sql: str, params: dict | None = None, _retries: int = 2) -> list[dict]:
    global _engine
    import time
    for attempt in range(_retries + 1):
        try:
            with _engine_get().connect() as conn:
                df = pd.read_sql_query(sqlalchemy.text(sql), conn, params=params or {})
            return json.loads(df.to_json(orient="records", date_format="iso", force_ascii=False))
        except Exception as e:
            transient = any(s.lower() in str(e).lower() for s in _TRANSIENT)
            if attempt < _retries and transient:
                try:
                    if _engine is not None:
                        _engine.dispose()
                except Exception:
                    pass
                _engine = None
                time.sleep(0.5 * (attempt + 1))
                continue
            raise

_SYS_SCHEMAS = ("information_schema", "performance_schema", "mysql", "sys")

# ------------------------------------------------------------------
# 3. MCP 서버
# ------------------------------------------------------------------
from mcp.server.fastmcp import FastMCP

mcp = FastMCP(
    "MariaDB Schema Inspector",
    instructions=(
        "MariaDB / MySQL 데이터베이스의 information_schema를 조회하여 "
        "스키마 목록, 테이블 목록, 컬럼 정의, 인덱스, FK 제약을 반환합니다. "
        "SELECT 전용 — DDL/DML 실행 불가."
    ),
)

# ------------------------------------------------------------------
# Tool 1: 스키마(데이터베이스) 목록
# ------------------------------------------------------------------
@mcp.tool()
def mdb_list_schemas() -> str:
    """
    MariaDB/MySQL 데이터베이스(스키마) 목록을 반환합니다.
    시스템 스키마(information_schema 등)는 제외합니다.
    """
    rows = _query("""
        SELECT schema_name,
               default_character_set_name,
               default_collation_name
        FROM information_schema.SCHEMATA
        WHERE schema_name NOT IN ('information_schema','performance_schema','mysql','sys')
        ORDER BY schema_name
    """)
    return json.dumps(rows, ensure_ascii=False, indent=2)

# ------------------------------------------------------------------
# Tool 2: 테이블 목록
# ------------------------------------------------------------------
@mcp.tool()
def mdb_list_tables(schema: str = "", table_filter: str = "") -> str:
    """
    지정 스키마의 테이블·뷰 목록을 반환합니다.

    Args:
        schema: 데이터베이스(스키마)명. 빈 값이면 현재 접속 DB 기준.
        table_filter: 테이블명 LIKE 필터 (예: 'ord_%'). 빈 값이면 전체.
    """
    conds = ["table_type IN ('BASE TABLE','VIEW')",
             "table_schema NOT IN ('information_schema','performance_schema','mysql','sys')"]
    params: dict = {}

    if schema:
        conds.append("table_schema = :schema")
        params["schema"] = schema
    if table_filter:
        conds.append("table_name LIKE :tfilter")
        params["tfilter"] = table_filter

    where = " AND ".join(conds)
    rows = _query(f"""
        SELECT table_schema, table_name, table_type, table_rows, table_comment
        FROM information_schema.TABLES
        WHERE {where}
        ORDER BY table_schema, table_name
    """, params)
    return json.dumps(rows, ensure_ascii=False, indent=2)

# ------------------------------------------------------------------
# Tool 3: 테이블 컬럼 정의
# ------------------------------------------------------------------
@mcp.tool()
def mdb_describe_table(table_name: str, schema: str = "") -> str:
    """
    테이블의 컬럼 정의를 반환합니다. DB_Schema.md 작성에 사용합니다.

    Args:
        table_name: 테이블명
        schema: 데이터베이스(스키마)명 (빈 값이면 현재 접속 DB)

    Returns:
        컬럼명, 데이터타입, NULL 허용, 기본값, PK 여부, AUTO_INCREMENT, 설명
    """
    params: dict = {"tname": table_name}
    owner_cond = ""
    if schema:
        owner_cond = "AND table_schema = :schema"
        params["schema"] = schema

    rows = _query(f"""
        SELECT
            ordinal_position,
            column_name,
            column_type,
            is_nullable,
            column_default,
            CASE WHEN column_key = 'PRI' THEN 'Y' ELSE 'N' END AS is_pk,
            extra,
            column_comment
        FROM information_schema.COLUMNS
        WHERE table_name = :tname
          {owner_cond}
        ORDER BY ordinal_position
    """, params)
    if not rows:
        return f"테이블 '{table_name}'을 찾을 수 없습니다."
    return json.dumps(rows, ensure_ascii=False, indent=2)

# ------------------------------------------------------------------
# Tool 4: 인덱스
# ------------------------------------------------------------------
@mcp.tool()
def mdb_get_indexes(table_name: str, schema: str = "") -> str:
    """
    테이블의 인덱스 목록(컬럼 포함)을 반환합니다.

    Args:
        table_name: 테이블명
        schema: 데이터베이스(스키마)명
    """
    params: dict = {"tname": table_name}
    owner_cond = ""
    if schema:
        owner_cond = "AND table_schema = :schema"
        params["schema"] = schema

    rows = _query(f"""
        SELECT
            index_name,
            non_unique,
            column_name,
            seq_in_index,
            index_type,
            nullable
        FROM information_schema.STATISTICS
        WHERE table_name = :tname
          {owner_cond}
        ORDER BY index_name, seq_in_index
    """, params)
    return json.dumps(rows, ensure_ascii=False, indent=2)

# ------------------------------------------------------------------
# Tool 5: FK 제약
# ------------------------------------------------------------------
@mcp.tool()
def mdb_get_foreign_keys(table_name: str, schema: str = "") -> str:
    """
    테이블의 FK 제약 조건을 반환합니다.

    Args:
        table_name: 자식 테이블명
        schema: 데이터베이스(스키마)명
    """
    params: dict = {"tname": table_name}
    owner_cond = ""
    if schema:
        owner_cond = "AND kcu.table_schema = :schema"
        params["schema"] = schema

    rows = _query(f"""
        SELECT
            kcu.constraint_name,
            kcu.column_name,
            kcu.referenced_table_schema,
            kcu.referenced_table_name,
            kcu.referenced_column_name,
            rc.delete_rule,
            rc.update_rule
        FROM information_schema.KEY_COLUMN_USAGE kcu
        JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
          ON kcu.constraint_name  = rc.constraint_name
         AND kcu.table_schema     = rc.constraint_schema
        WHERE kcu.table_name = :tname
          AND kcu.referenced_table_name IS NOT NULL
          {owner_cond}
        ORDER BY kcu.constraint_name, kcu.ordinal_position
    """, params)
    return json.dumps(rows, ensure_ascii=False, indent=2)

# ------------------------------------------------------------------
# Tool 6: SELECT 실행 (읽기 전용)
# ------------------------------------------------------------------
@mcp.tool()
def mdb_execute_select(sql: str, limit: int = 100) -> str:
    """
    임의의 SELECT 쿼리를 실행합니다.
    DDL(CREATE/ALTER/DROP) 및 DML(INSERT/UPDATE/DELETE)은 거부됩니다.
    #주석, /* */ 주석, 세미콜론 체인을 통한 우회도 차단됩니다.

    Args:
        sql: 실행할 SELECT 쿼리
        limit: 최대 반환 행 수 (기본 100, 최대 1000)
    """
    err = validate_readonly(sql)
    if err:
        return f"오류: {err}"

    limit = min(int(limit), 1000)
    sql_upper = sql.upper()
    if "LIMIT" not in sql_upper:
        safe_sql = f"{sql.rstrip(';')} LIMIT {limit}"
    else:
        safe_sql = sql

    rows = _query(safe_sql)
    return json.dumps({"count": len(rows), "rows": rows}, ensure_ascii=False, indent=2)

# ------------------------------------------------------------------
# Tool 7: 테이블 명세서 전체 (one-shot)
# ------------------------------------------------------------------
@mcp.tool()
def mdb_full_table_spec(table_name: str, schema: str = "") -> str:
    """
    테이블의 컬럼 + 인덱스 + FK를 한 번에 반환합니다.
    DB_Schema.md 자동 생성에 사용합니다.

    Args:
        table_name: 테이블명
        schema: 데이터베이스(스키마)명
    """
    columns = json.loads(mdb_describe_table(table_name, schema))
    indexes = json.loads(mdb_get_indexes(table_name, schema))
    fkeys   = json.loads(mdb_get_foreign_keys(table_name, schema))

    result = {
        "table":        table_name,
        "schema":       schema or "(current db)",
        "columns":      columns,
        "indexes":      indexes,
        "foreign_keys": fkeys,
    }
    return json.dumps(result, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    mcp.run()
