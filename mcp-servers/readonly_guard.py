"""
Read-Only SQL Guard

MCP 스키마 서버 공용 모듈.
애플리케이션 레벨 + SQLAlchemy 엔진 레벨에서 이중으로 쓰기 구문을 차단한다.

두 계층의 방어:
  1) validate_readonly(sql)     — execute_select 도구 진입 시 화이트리스트 검사
  2) attach_readonly_guard(eng) — 엔진의 모든 cursor_execute 직전 이벤트로 재검사
     → 새 도구를 추가하다 실수로 validate_readonly를 빠뜨려도 엔진이 막는다
"""

import re
from typing import Optional

# ---------------------------------------------------------------------------
# 쓰기 키워드 집합 (대문자)
# ---------------------------------------------------------------------------
_WRITE_KW: frozenset[str] = frozenset({
    "INSERT", "UPDATE", "DELETE", "REPLACE",  # DML
    "MERGE", "UPSERT",                         # DML 확장
    "CREATE", "ALTER", "DROP", "TRUNCATE",     # DDL
    "RENAME", "COMMENT",                       # DDL 확장
    "GRANT", "REVOKE",                         # DCL
    "CALL", "EXEC", "EXECUTE",                 # 프로시저 실행
    "LOAD", "IMPORT", "EXPORT",                # 벌크 조작
    "LOCK", "UNLOCK",                          # 잠금
    "SET",                                     # 세션 변수 변경 (SET SELECT 패턴 방지)
    "BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT",# TCL — 외부 트랜잭션 조작 차단
})

# ---------------------------------------------------------------------------
# 내부 유틸
# ---------------------------------------------------------------------------
def _strip_comments(sql: str) -> str:
    """블록 주석(/* */), 라인 주석(--, #)을 제거하고 정규화된 SQL 반환."""
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    sql = re.sub(r"--[^\n]*",  " ", sql)
    sql = re.sub(r"#[^\n]*",   " ", sql)   # MariaDB/MySQL # 주석
    return sql.strip()


def _first_token(sql: str) -> str:
    """공백·괄호를 제거한 첫 번째 SQL 토큰(대문자) 반환."""
    return re.split(r"[\s(]+", sql.strip(), maxsplit=1)[0].upper()


def _scan_cte_for_writes(clean_upper: str) -> Optional[str]:
    """
    WITH ... (CTE) 구문에서 괄호 깊이 0인 레벨에 쓰기 키워드가 있으면
    오류 메시지를 반환한다. 안전하면 None.
    """
    tokens = re.split(r"(\s+|[(),;])", clean_upper)
    depth = 0
    for tok in tokens:
        t = tok.strip()
        if not t:
            continue
        if t == "(":
            depth += 1
        elif t == ")":
            depth = max(depth - 1, 0)
        elif depth == 0 and t in _WRITE_KW:
            return f"쓰기 구문({t})은 허용되지 않습니다."
    return None

# ---------------------------------------------------------------------------
# Public: 단일 SQL 검사
# ---------------------------------------------------------------------------
def validate_readonly(sql: str) -> Optional[str]:
    """
    SQL이 안전한 읽기 전용 구문이면 None 반환.
    쓰기 가능성이 있으면 오류 메시지(str) 반환.

    검사 규칙:
      - 세미콜론으로 구분된 각 문장을 독립적으로 검사 (다중 문장 체인 차단)
      - 주석 제거 후 첫 토큰이 SELECT 또는 WITH 이어야 함
      - WITH(CTE): 괄호 깊이 0에서 쓰기 키워드 스캔
      - SELECT: _WRITE_KW 에 속하는 토큰이 어디에도 없어야 함
    """
    statements = [s.strip() for s in sql.split(";") if s.strip()]
    if not statements:
        return "빈 쿼리입니다."

    for stmt in statements:
        clean = _strip_comments(stmt)
        upper = clean.upper()
        first = _first_token(upper)

        if first == "WITH":
            err = _scan_cte_for_writes(upper)
            if err:
                return err
            # CTE 끝에 실제 쿼리가 SELECT 인지 확인할 수 없으므로
            # 추가로 전체 토큰에 쓰기 키워드가 없는지 검사
        elif first == "SELECT":
            # SELECT 내부에 숨겨진 쓰기 키워드 탐지
            # (e.g. SELECT * INTO #tmp — SQL Server 특수 문법 차단)
            tokens_upper = set(re.split(r"[\s(),;]+", upper))
            bad = tokens_upper & _WRITE_KW
            if bad:
                return f"허용되지 않는 키워드가 포함되어 있습니다: {', '.join(sorted(bad))}"
        else:
            return (
                f"SELECT / WITH 으로 시작하는 쿼리만 허용됩니다. "
                f"(감지된 첫 토큰: {first})"
            )

    return None  # 모든 문장 통과

# ---------------------------------------------------------------------------
# Public: SQLAlchemy 엔진 레벨 가드 부착
# ---------------------------------------------------------------------------
def attach_readonly_guard(engine) -> None:
    """
    SQLAlchemy 엔진의 before_cursor_execute 이벤트에 가드를 등록한다.
    도구 코드에서 validate_readonly를 빠뜨려도 엔진이 실행 직전에 차단한다.

    스키마 카탈로그 조회(하드코딩된 SQL)는 내부에서 직접 실행하므로
    이 레이어를 통과하지만, 그 SQL은 모두 SELECT 이므로 문제없다.
    """
    from sqlalchemy import event

    @event.listens_for(engine, "before_cursor_execute")
    def _block_writes(conn, cursor, statement, parameters, context, executemany):
        err = validate_readonly(statement)
        if err:
            raise PermissionError(f"[ReadOnly Guard] {err}")
