# 내장 DB 스키마 MCP — 다른 PC에 단독 설치 가이드

> 플러그인(Claude Code 워크플로우) 없이 **DB 스키마 조회 MCP 서버만** 다른 PC/다른 MCP 클라이언트에
> 붙이고 싶을 때. 서버는 순수 Python·stdio MCP라 **Claude Desktop·Claude Code·Cursor 등 어디서나** 동작한다.
> SELECT 전용(readonly 이중 방어) — 운영 DB에 안전하게 붙는다.

대상 DB: **Oracle / DB2 / MariaDB(·MySQL)**. (PostgreSQL/MSSQL은 별도 npx MCP 사용 — 본 가이드 범위 밖)

---

## 0. 필요한 것

| 항목 | 비고 |
|---|---|
| **Python 3.8+** | 서버 런타임 (Node·Java 불필요) |
| **서버 파일 4종** | `{db}_schema_server.py` + `readonly_guard.py`(서버가 import) |
| Python 라이브러리 | `mcp[cli]`·`sqlalchemy`·`pandas`·`python-dotenv` + DB 드라이버 |
| DB 접속정보 | host/port/service(db)/user/password |
| MCP 클라이언트 | Claude Desktop / Claude Code / Cursor 등 |

---

## 1. 서버 파일 가져오기 (플러그인 전체 필요 없음)

`mcp-servers/` 폴더의 아래 파일만 있으면 된다. 다른 PC로 **복사**하거나 git에서 그 폴더만 받는다.

```
mcp-servers/
 ├ oracle_schema_server.py      ← Oracle 쓸 때
 ├ db2_schema_server.py         ← DB2 쓸 때
 ├ mariadb_schema_server.py     ← MariaDB/MySQL 쓸 때
 ├ readonly_guard.py            ← (필수 공통 — 서버가 import)
 └ requirements.txt
```

예) 임의 폴더에 둔다 (경로는 자유, 단 **server.py와 readonly_guard.py는 같은 폴더**):
```
C:\mcp\speclinker\        (Windows)
~/mcp/speclinker/         (mac/linux)
```

> sparse하게 git에서 그 폴더만:
> ```bash
> git clone --depth 1 --filter=blob:none --sparse https://github.com/DreamyDreamss/speclinker.git
> cd speclinker && git sparse-checkout set mcp-servers
> ```

---

## 2. Python 라이브러리 설치

```bash
# 공통 + (쓰는 DB 드라이버만)
pip install -r mcp-servers/requirements.txt
# 또는 최소만:
pip install "mcp[cli]" sqlalchemy pandas python-dotenv
pip install oracledb          # Oracle  (Thin 모드 — Oracle Client 불필요!)
pip install pymysql           # MariaDB/MySQL
pip install ibm_db ibm_db_sa  # DB2  (+ IBM CLI Driver 별도, 아래 참고)
```

**DB별 주의**
- **Oracle**: `oracledb` Thin 모드라 **Oracle Instant Client 설치 불필요**.
- **DB2**: `ibm_db`가 **IBM CLI Driver(네이티브)** 를 요구할 수 있음 → IBM 사이트에서 받아 `DB2_CLIDRIVER_PATH` 지정.
- **MariaDB/MySQL**: `pymysql`만.

---

## 3. MCP 클라이언트에 등록 (셋 중 택1)

서버 실행 = `python <서버.py>`, 접속정보는 **env로 주입**. 별칭은 자유(`db-oracle` 등).

### (A) Claude Desktop (소비자 챗앱)
설정 파일에 추가:
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

```jsonc
{
  "mcpServers": {
    "db-oracle": {
      "command": "python",
      "args": ["C:/mcp/speclinker/oracle_schema_server.py"],   // ← 절대경로
      "env": {
        "ORA_HOST": "10.0.0.5", "ORA_PORT": "1521",
        "ORA_SERVICE": "ORCLPDB1",
        "ORA_USER": "READONLY_ID", "ORA_PASSWORD": "********"
      }
    }
  }
}
```
저장 후 **Claude Desktop 재시작**.

> `python`이 PATH에 없으면 절대경로로: `"command": "C:/Users/<id>/AppData/Local/Programs/Python/Python310/python.exe"`

### (B) Claude Code (CLI/IDE) — 전역(모든 프로젝트)
```bash
claude mcp add --scope user db-oracle \
  --env ORA_HOST=10.0.0.5 --env ORA_PORT=1521 --env ORA_SERVICE=ORCLPDB1 \
  --env ORA_USER=READONLY_ID --env ORA_PASSWORD=**** \
  -- python C:/mcp/speclinker/oracle_schema_server.py
```
→ `~/.claude.json`(user scope)에 등록. 확인: `claude mcp list`.

### (C) Cursor / 기타 MCP 클라이언트
각 클라이언트의 `mcpServers` 설정에 (A)와 동일한 `command/args/env` 구조로 입력.

**DB별 env 키**
| DB | env |
|---|---|
| Oracle | `ORA_HOST` `ORA_PORT`(1521) `ORA_SERVICE` `ORA_USER` `ORA_PASSWORD` |
| DB2 | `DB2_HOST` `DB2_PORT`(50000) `DB2_DATABASE` `DB2_USER` `DB2_PASSWORD` `DB2_CLIDRIVER_PATH`(필요시) |
| MariaDB | `MDB_HOST` `MDB_PORT`(3306) `MDB_DATABASE` `MDB_USER` `MDB_PASSWORD` |

---

## 4. 연결 테스트

- **Claude Code**: `claude mcp list` → `✔ Connected` 확인.
- **수동 기동 테스트**(접속정보 env 넣고): 서버가 stdio로 떠서 멈춰 있으면 정상.
  ```bash
  ORA_HOST=... ORA_USER=... ORA_PASSWORD=... python oracle_schema_server.py   # Ctrl+C로 종료
  ```
- **클라이언트에서 도구 호출**: `ora_list_tables`, `ora_describe_table` 등이 보이면 성공.

> ⚠️ `✔ Connected`는 MCP 핸드셰이크만 성공한 것. **접속정보가 틀리면(또는 placeholder면)** 도구 호출 시
> DB 인증 에러가 난다. env의 host/user/password가 실제 값인지 반드시 확인.

---

## 5. 제공 도구 (DB별 prefix `ora_`/`db2_`/`mdb_`)

| 도구 | 역할 |
|---|---|
| `{p}_list_schemas` | 스키마 목록 |
| `{p}_list_tables(schema, filter)` | 테이블 목록 |
| `{p}_describe_table(table, schema)` | 컬럼·타입·NULL·PK |
| `{p}_get_indexes(table, schema)` | 인덱스 |
| `{p}_get_foreign_keys(table, schema)` | 선언 FK |
| `{p}_execute_select(sql, limit)` | **SELECT 전용** 쿼리 |
| `{p}_full_table_spec(table, schema)` | 위 통합 |

**안전**: `execute_select`는 첫 토큰이 SELECT/WITH가 아니거나 INSERT/UPDATE/DELETE/DDL/`SELECT INTO` 등이
섞이면 차단(`readonly_guard`). 엔진 레벨에서도 재검사하는 이중 방어 — 운영 DB에 안전.

---

## 6. 트러블슈팅

| 증상 | 원인/해결 |
|---|---|
| `uvx/python를 찾을 수 없음` | `command`를 python **절대경로**로. |
| `✔ Connected`인데 도구 호출 실패 | env 접속정보가 틀림/placeholder → 실제 값 입력 |
| `ModuleNotFoundError: readonly_guard` | `readonly_guard.py`가 server.py와 **같은 폴더**에 없음 |
| `ModuleNotFoundError: oracledb/pymysql/ibm_db` | 해당 드라이버 `pip install` 누락 |
| DB2 `SQL10013`/드라이버 오류 | IBM CLI Driver 설치 + `DB2_CLIDRIVER_PATH` 지정 |
| 한글/cp949 깨짐(Windows) | 서버는 내부 처리 — 클라이언트 인코딩 문제면 무관 |

> 보안: 운영 DB엔 **읽기 전용 계정**을 쓰는 것을 권장(서버가 SELECT만 허용하지만, 계정 권한으로도 한 번 더 막으면 안전).
