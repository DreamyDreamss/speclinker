---
name: sl-init
description: 프로젝트 초기화 — docs/ 하위 디렉토리 구조 생성, RTM 초기화, network 환경 설정, MCP 연동 템플릿 생성. 프로젝트 시작 시 제일 먼저 실행.
triggers:
  - /sl-init
---

# /sl-init — 프로젝트 초기화

프로젝트 루트에 산출물 디렉토리 구조를 생성하고 환경을 설정합니다.

---

## Step 0 — 소스 경로 수집

분석할 소스코드 위치를 먼저 확인한다.  
Web · API · Batch 등 소스가 여러 디렉토리에 분산된 경우 각각 입력받는다.

사용자에게 아래를 출력하여 질문한다:

```
분석할 소스코드 위치를 입력해 주세요.
Web / API / Batch 등 위치가 다를 경우 각각 입력합니다.

소스 위치가 몇 곳입니까? (숫자 입력, 예: 1 ~ 5)
```

입력받은 수(N)만큼 아래 질문을 반복한다:

```
[소스-{번호}]
레이블을 입력하세요 (예: web, api, batch, frontend, backend):
절대 경로를 입력하세요 (예: C:\Projects\MyApp\frontend):
```

각 경로에 대해 **즉시 유효성 검사**를 수행한다:

```powershell
$path = "<사용자 입력 경로>"
if (Test-Path $path) {
    Write-Host "  [OK] 경로 확인: $path" -ForegroundColor Green
} else {
    Write-Host "  [XX] 경로를 찾을 수 없습니다: $path" -ForegroundColor Red
    Write-Host "  경로를 다시 입력해 주세요." -ForegroundColor Yellow
}
```

경로가 유효하지 않으면 해당 소스 번호를 **재입력 받는다** (넘어가지 않는다).

모든 경로가 확인되면 수집한 정보를 표 형태로 출력하여 사용자에게 확인을 받는다:

```
[소스 경로 확인]
번호  레이블    경로
----  -------   ----
1     web       C:\Projects\MyApp\frontend
2     api       C:\Projects\MyApp\backend
3     batch     C:\Projects\MyApp\batch

이 경로로 진행하시겠습니까? (y/N)
```

사용자가 N을 입력하면 처음부터 재입력받는다.

> **워크스페이스**: `/sl-init`을 실행한 **현재 디렉토리**가 산출물 워크스페이스가 된다.  
> `project.env`, `docs/`, `.understand-anything/` 등 모든 산출물이 이 위치에 생성된다.  
> 소스 디렉토리(SOURCE_*_PATH)와 다른 경로여도 무방하다.

---

## Step 1 — 네트워크 환경 확인

사용자에게 반드시 아래 내용을 텍스트로 출력하여 선택을 요청한다:

```
네트워크 환경을 선택해 주세요:

1) open   — 인터넷 또는 사내망 연결 가능 (Jira·Wiki·DB MCP 연동 활성화)
2) closed — 폐쇄망/오프라인 (로컬 파일만 사용)
```

선택 전 다음 단계로 넘어가지 않는다.

---

## Step 2 — project.env 생성

**먼저 플러그인 설치 경로를 감지한다:**

```powershell
$installJson = "$env:USERPROFILE\.claude\plugins\installed_plugins.json"
if (Test-Path $installJson) {
    $data  = Get-Content $installJson -Encoding UTF8 | ConvertFrom-Json
    $pluginKey = $data.plugins.PSObject.Properties.Name | Where-Object { $_ -like 'speclinker@*' } | Select-Object -First 1
    $entry = if ($pluginKey) { $data.plugins.$pluginKey } else { $null }
    $PLUGIN_PATH = if ($entry -and $entry.Count -gt 0) { ($entry[0].installPath -replace '\\', '/') }
                   else { "$env:USERPROFILE/.claude/plugins/speclinker" -replace '\\', '/' }
} else {
    $PLUGIN_PATH = "$env:USERPROFILE/.claude/plugins/speclinker" -replace '\\', '/'
}
Write-Output "PLUGIN_PATH=$PLUGIN_PATH"
```

**Write tool로 프로젝트 루트에 `project.env` 파일을 직접 생성한다.**

파일 내용 (실제 값으로 치환):
```
NETWORK=<선택한 값: open 또는 closed>
PROJECT_NAME=<현재 작업 디렉토리의 폴더명>
WORKSPACE_DIR=<현재 작업 디렉토리 절대경로>
PLUGIN_PATH=<위에서 감지한 PLUGIN_PATH>
AUTHOR=Claude
CREATED=<오늘 날짜: YYYY-MM-DD>

# 소스 경로 (Step 0에서 수집)
SOURCE_COUNT=<N>
SOURCE_1_LABEL=<레이블1>
SOURCE_1_PATH=<절대경로1>
SOURCE_2_LABEL=<레이블2>
SOURCE_2_PATH=<절대경로2>
...

# POC 모드 (선택 — RECON 개발 중 빠른 반복용)
# 전체 소스를 매번 다 분석하지 않고 특정 도메인/화면만 빠르게 처리
# POC_MODE=true 일 때만 아래 옵션 적용
# POC_MODE=false
#
# ── 슬라이스 옵션 (2종, 우선순위: DOMAINS > LIMIT) ──
# POC_DOMAINS=                     # 쉼표 구분 도메인 (예: auth,order). 도메인 단위로 처리
# POC_FILE_LIMIT=                  # 도메인별 INF 컨트롤러 파일 수 제한 (예: 5) — alphabetical

# 미리보기 캡처 (선택 — RECON UI 스크린샷, Chrome CDP attach 기반)
# PREVIEW_BASE_URL 설정 시 실제 dev/staging 서버를 메뉴진입 캡처(capture_screen_dom.js)
# 미설정 시 사용자 수동 PNG 제출 또는 미리보기 생략으로 폴백
#
# 사용 절차:
#   1. Chrome을 CDP 포트로 실행 (1회):
#      Windows: Start-Process chrome -ArgumentList '--remote-debugging-port=9222'
#      macOS  : open -a "Google Chrome" --args --remote-debugging-port=9222
#   2. PREVIEW_BASE_URL에 로그인 (2FA/SSO 포함) → 로그인 상태 유지
#   3. /sl-recon-uis STEP 6-2에서 자동 캡처 (attach → 로그인 상태 재사용)
#
# PREVIEW_BASE_URL=http://localhost:3333
# PREVIEW_CDP_PORT=9222                                   # Chrome 원격 디버깅 포트 (기본: 9222)
# PREVIEW_FALLBACK_BO=false                               # jwork 전용 BO admin 폴백 활성화
```

소스가 1개이고 현재 작업 디렉토리인 경우:
```
SOURCE_COUNT=1
SOURCE_1_LABEL=src
SOURCE_1_PATH=<현재 작업 디렉토리 절대경로>
```

> `WORKSPACE_DIR`은 PowerShell `(Get-Location).Path`로 현재 경로를 정확히 기록한다.
> `PLUGIN_PATH`는 모든 후속 커맨드에서 스크립트를 찾는 기준 경로가 된다.
> **업데이트 내성**: 설치 캐시 경로엔 버전이 포함돼 플러그인 업데이트 시 바뀐다. `SessionStart` 훅
> (`setup-deps.js`)이 매 세션 시작 시 `PLUGIN_PATH`를 점검해 **경로가 사라졌으면(=업데이트로 옛
> 버전 폴더 삭제) 현재 설치 경로로 자가치유**한다. 유효한 경로(개발용 로컬 경로 포함)는 그대로 둔다 —
> 그래서 init 후 업데이트해도 별도 조치 없이 동작한다.

---

## Step 2-B — 화면 캡처 설정

사용자에게 아래를 출력하여 질문한다:

```
실제 화면 스크린샷 캡처를 설정하시겠습니까?
(Chrome CDP attach 방식 — Chrome을 로그인 상태로 실행하면 자동 캡처)

1) 예 — 지금 URL 입력
2) 아니오 — 나중에 직접 project.env 수정
```

**아니오** 선택 시: 이 단계 건너뛴다. project.env의 PREVIEW 항목은 주석 상태 유지.

**예** 선택 시 아래를 순서대로 진행한다:

```
개발/스테이징 서버 URL을 입력하세요.
(예: http://localhost:3333  /  http://192.168.1.100:8080  /  https://dev.myapp.com)
```

수집 완료 후 `project.env`의 PREVIEW 항목을 **주석 해제하고 실제 값으로** 업데이트한다:

```
PREVIEW_BASE_URL=<입력한 URL>
PREVIEW_CDP_PORT=9222
```

그리고 사용자에게 아래를 출력한다:

```
캡처 설정 완료. /sl-recon-uis 실행 전에 Chrome을 CDP 모드로 실행하고 로그인하세요.

  [필수] Chrome CDP 모드 실행 (1회 — 로그인 상태 유지):

  Windows : Start-Process chrome -ArgumentList '--remote-debugging-port=9222'
  macOS   : open -a "Google Chrome" --args --remote-debugging-port=9222
  Linux   : google-chrome --remote-debugging-port=9222

  로그인 후 메뉴로 화면을 띄우고 /sl-recon-uis 가이드형 세션으로 캡처합니다.
```

> **Note**: Chrome CDP 포트가 열려 있는 한 세션이 유지되므로 재로그인 불필요.  
> capture_screen_dom.js가 Chrome에 attach하여 현재 로그인 세션·화면을 재사용한다.

---

## Step 3 — 디렉토리 생성

아래 PowerShell 명령으로 디렉토리를 생성한다:

```powershell
New-Item -ItemType Directory -Force -Path @(
  "docs/00_FUNC",
  "docs/00_FUNC/domains",
  "docs/02_추적표",
  "docs/03_기능명세서",
  "docs/03_기능명세서/domains",
  "docs/04_아키텍처설계서",
  "docs/05_설계서",
  "docs/07_테스트케이스",
  "docs/08_테스트결과보고서",
  "docs/변경관리",
  ".speclinker"
) | Out-Null
Write-Output "디렉토리 생성 완료"
```

> **SM 전용 구조**: speclinker는 *운영 중 시스템*을 대상으로 하므로 **소스코드 디렉토리를 만들지 않는다**.
> AIDD(`/sl-aidd`)는 생성코드를 별도 `06_소스코드/`에 덤프하지 않고 **`project.env`의 `SOURCE_*_PATH`(실제 소스 트리)에 기존 패키지/레이어 관례대로** 직접 반영한다(linked_func 주석 삽입).
> 입력자료(SR·기획문서)도 별도 폴더를 만들지 않는다 — 변경요구는 `/sl-change`가 Jira(MCP) 또는 SR 인자로 받고, 산출물은 `docs/변경관리/`에 쌓인다.

그 다음 **Write tool로 `README_DIRS.md` 파일을 직접 생성한다:**

---

---

```markdown
# 프로젝트 산출물 구조

| 폴더 | 역할 |
|------|------|
| docs/00_FUNC/ | 구현 기능 목록 (FUNC_v1.0.md) — RECON rd-agent 출력 |
| docs/00_FUNC/domains/ | 도메인별 FUNC 분리 파일 |
| docs/02_추적표/ | RTM (SR→INF/SCH/UIS 추적·도메인 색인) — sl-change(DELTA)가 사용 |
| docs/03_기능명세서/ | 기능 명세서 (SRS_v1.0.md) |
| docs/03_기능명세서/domains/ | 도메인별 SRS 분리 파일 |
| docs/04_아키텍처설계서/ | 시스템 아키텍처 설계서 |
| docs/05_설계서/ | 상세 설계서 (API_Design.md, DB_Schema.md, UI_Spec.md) |
| docs/07_테스트케이스/ | 테스트 케이스 명세서 |
| docs/08_테스트결과보고서/ | 테스트 결과 보고서 |
| docs/변경관리/ | SR별 분석서·변경명세·TC (sl-change 생성) |

> 소스코드는 docs 밖 **실제 소스 트리**(`SOURCE_*_PATH`)에 그대로 둔다 — speclinker는 별도 소스 폴더를 만들지 않는다(SM 전용).

생성일: {CREATED} | 작성자: Claude
```

---

## Step 4 — MCP 연동 설정 (NETWORK=open 인 경우만)

> NETWORK=closed 이면 이 단계 전체를 건너뛴다.

### 4-0. MCP 런타임 환경 검사

> **주의**: `install.py`는 대화형(interactive) 스크립트이므로 Claude Code 내부에서 직접 실행하면
> 모든 입력이 빈 값으로 처리되어 패키지가 설치되지 않는다.
> 아래처럼 **현재 설치 상태만 스캔**하고, 누락 항목은 사용자에게 직접 실행 명령을 안내한다.

```powershell
$PLUGIN_PATH = (Get-Content "project.env" -Encoding UTF8 | Where-Object {$_ -match "^PLUGIN_PATH="} | ForEach-Object {$_ -replace "^PLUGIN_PATH=",""}).Trim()
$py = if (Get-Command python -ErrorAction SilentlyContinue) { "python" } else { "python" }

# 필수 패키지 설치 여부만 조용히 확인 (설치 시도 없음)
$checks = @(
    @{ name="mcp";            label="mcp (FastMCP 서버)" },
    @{ name="sqlalchemy";     label="SQLAlchemy (DB 엔진)" },
    @{ name="pandas";         label="pandas (쿼리 결과 변환)" },
    @{ name="dotenv";         label="python-dotenv (.env 로드)" },
    @{ name="pymysql";        label="PyMySQL (MariaDB/MySQL)" },
    @{ name="oracledb";       label="python-oracledb (Oracle)" }
)
$missing = @()
foreach ($c in $checks) {
    $r = & $py -c "import $($c.name)" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  [OK] $($c.label)" -ForegroundColor Green
    } else {
        Write-Host "  [!!] $($c.label) — 미설치" -ForegroundColor Yellow
        $missing += $c.name
    }
}
$uvxOk = (Get-Command uvx -ErrorAction SilentlyContinue) -ne $null
Write-Host "  $(if ($uvxOk) {'[OK]'} else {'[!!]'}) uv/uvx (mcp-atlassian 실행)$(if (-not $uvxOk) {' — 미설치'})" -ForegroundColor $(if ($uvxOk) {'Green'} else {'Yellow'})
if (-not $uvxOk) { $missing += "uv" }

if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Host "누락 패키지가 있습니다. 터미널에서 아래 명령을 직접 실행하세요:" -ForegroundColor Yellow
    Write-Host "  ! $py $PLUGIN_PATH/mcp-servers/install.py" -ForegroundColor Cyan
    Write-Host "  (Claude Code 밖 일반 터미널에서 실행해야 대화형 입력이 됩니다)" -ForegroundColor Gray
} else {
    Write-Host "  모든 MCP 런타임 패키지 설치 확인됨" -ForegroundColor Green
}
```

---

### 4-1. DB 연결 구성

사용자에게 아래를 출력하여 질문한다:

```
프로젝트에서 사용하는 DB가 있습니까?
몇 개의 DB에 연결하시겠습니까? (없으면 0 입력)
```

사용자가 입력한 DB 수(N)만큼 아래 질문을 **반복**한다 (DB-1, DB-2, ... DB-N):

```
[DB-{번호}] 설정

DB 종류를 선택해 주세요:
  1) DB2 (IBM)
  2) MariaDB / MySQL
  3) PostgreSQL
  4) Oracle
  5) MSSQL (SQL Server)

이 DB의 별칭을 입력하세요 (예: main, sub1, reporting):
```

각 DB에 대해 수집한 정보:
- 번호: 1~N
- 종류: db2 / mariadb / postgresql / oracle / mssql
- 별칭: 사용자 입력값 (mcpServers 키로 사용)

---

### 4-1B. DB MCP 등록 스코프 선택 (DB ≥ 1일 때)

DB가 1개 이상이면, 어디에 등록할지 사용자에게 질문한다:

```
DB MCP을 어디에 등록할까요?

1) 이 프로젝트만        — 프로젝트 루트 .mcp.json (이 프로젝트에서만 사용)
2) 전역 (모든 프로젝트)  — 사용자 스코프 설정파일 (회사 DB가 고정이면 한 번만 등록)
3) 건너뜀               — 나중에 직접 설정
```

- **2) 전역** 선택 시 — **접속정보(아이디/비번)는 묻지 않는다.** 전역 설정파일에 항목만 placeholder로 추가하고 파일 위치를 안내한다.
  내장 MCP가 있는 종류(**oracle / db2 / mariadb**)만 대상이다(postgresql·mssql은 npx 기반 → 프로젝트 .mcp.json로 처리):

  ```bash
  !python "{PLUGIN_PATH}/mcp-servers/install.py" --global-template --db <4-1에서 고른 내장 DB종류 쉼표구분, 예: oracle,mariadb>
  ```

  → `~/.claude.json`(전역)에 `db-oracle` 등 서버 항목이 `CHANGE_ME` placeholder creds로 추가되고, **사용자가 직접 채울 파일 경로·키가 출력된다.** 이때 **4-3 `.mcp.json`에는 이 DB들을 넣지 않는다**(Jira/Wiki만 들어감). 사용자에게 그대로 안내:
  ```
  [전역 DB MCP] ~/.claude.json 에 항목을 추가했습니다.
    이 파일을 열어 각 DB의 ORA_HOST/ORA_USER/ORA_PASSWORD(등) 'CHANGE_ME'를 실제 값으로 교체하세요.
    교체 후 Claude Code 재시작 → 모든 프로젝트에서 사용됩니다.
  ```

- **1) 이 프로젝트만**: 4-3에서 DB 포함 `.mcp.json`을 생성한다(기존 흐름, `{PLUGIN_PATH}` 치환, 접속정보는 사용자가 .mcp.json에서 입력).
- **3) 건너뜀**: 4-3에서 DB 제외.

> 어느 방식이든 **DB 접속정보는 비밀이라 자동 입력하지 않는다** — 전역=`~/.claude.json`, 프로젝트=`.mcp.json`에서 사용자가 직접 채운다.
> 4-4의 `MCP_DB_{별칭}=true` 플래그는 스코프와 무관하게 기록한다(사용 의도 + 라이브러리 자동설치 신호).

---

### 4-2. Jira / Wiki 연결 구성

사용자에게 아래를 출력하여 질문한다:

```
Jira 또는 Wiki(Confluence)에 연결하시겠습니까?

1) 예
2) 아니오
```

**예** 선택 시 추가 질문:

```
설치 형태를 선택해 주세요:

1) 온프레미스 (사내 서버 — Jira Server / Data Center)
2) 클라우드 (Atlassian Cloud — atlassian.net)
```

```
연결할 서비스를 선택해 주세요 (복수 선택):

1) Jira만
2) Wiki(Confluence)만
3) Jira + Wiki 모두
```

**Jira를 선택한 경우 — SR 작업보드 조회 범위를 반드시 물어 `project.env`에 기록한다:**

```
SR 작업보드에 어떤 지라 업무를 가져올까요?

1) 지라 프로젝트 키로 (내 미완료 SR)        → JIRA_PROJECT=<키>  (예: KSHOPSR)
2) 커스텀 JQL로 (시스템·컴포넌트 등 직접 필터) → JIRA_JQL=<JQL>
   예: (시스템구분 = "KDI/KDI파트너" OR component = KDI) AND statusCategory != Done ORDER BY updated DESC
3) 나중에 (SR 보드 실행 시 다시 질문)
```

> - 1) → `JIRA_PROJECT=<키>` 기록. **워크스페이스 폴더명(`PROJECT_NAME`)은 지라 키가 아니다** — 사용자에게 실제 키를 받는다.
> - 2) → `JIRA_JQL=<JQL>` 기록(최우선 적용).
> - 3) → 아무것도 기록 안 함. SR 보드가 실행 시점에 다시 묻는다(전체 조회 금지).
> 이 값은 4-3 `.mcp.json`이 아니라 **`project.env`(Step 4-4 append)** 에 들어간다.

---

### 4-3. .mcp.json 생성

**사전 준비 — 플러그인 설치 경로 자동 감지**

.mcp.json을 생성하기 전에 아래 PowerShell 명령으로 실제 설치 경로를 확인한다:

```powershell
$installJson = Get-Content "$env:USERPROFILE\.claude\plugins\installed_plugins.json" -Encoding UTF8 | ConvertFrom-Json
# speclinker@local / speclinker@speclinker 등 설치 방식 무관하게 탐색
$pluginKey = $installJson.plugins.PSObject.Properties.Name | Where-Object { $_ -like 'speclinker@*' } | Select-Object -First 1
$entry = if ($pluginKey) { $installJson.plugins.$pluginKey } else { $null }
if ($entry -and $entry.Count -gt 0) {
    $PLUGIN_PATH = ($entry[0].installPath -replace '\\', '/')
} else {
    $PLUGIN_PATH = "$env:USERPROFILE/.claude/plugins/speclinker" -replace '\\', '/'
}
Write-Output "PLUGIN_PATH=$PLUGIN_PATH"
```

출력된 `PLUGIN_PATH` 값을 아래 모든 `args` 경로의 `{PLUGIN_PATH}` 자리에 대입한다.

---

**중요 규칙:**
- 프로젝트의 어떤 파일(config, .env 등)도 읽지 않는다
- DB 접속 정보는 "여기에_XXX_입력" 플레이스홀더로 작성한다
- 사용자가 직접 파일을 열어 실제 값을 채워야 한다
- **4-1B에서 '전역' 선택한 DB는 `.mcp.json`에 넣지 않는다** (이미 `~/.claude.json`에 등록됨). Jira/Wiki와 '프로젝트만' 선택 DB만 포함한다. (DB도 Jira도 모두 전역/없음이면 `.mcp.json` 생성을 건너뛴다.)

**4-1, 4-2에서 수집한 정보를 바탕으로 Write tool을 사용해 프로젝트 루트에 `.mcp.json` 파일을 직접 생성한다.**

아래 항목 예시를 참고하여 수집된 선택에 맞는 항목만 `mcpServers` 객체에 조합한다.  
`{PLUGIN_PATH}`는 위에서 감지한 실제 경로로 치환한다.

#### DB 항목 예시 (별칭 기반)

**DB2 (별칭: main):**
```json
"db-main": {
  "command": "python",
  "args": ["{PLUGIN_PATH}/mcp-servers/db2_schema_server.py"],
  "env": {
    "PROJECT_DIR": "여기에_프로젝트_루트_절대경로_입력",
    "ENV": "local",
    "DB2_HOST": "여기에_main_DB_호스트_IP_입력",
    "DB2_PORT": "50000",
    "DB2_DATABASE": "여기에_main_DB명_입력",
    "DB2_USER": "여기에_아이디_입력",
    "DB2_PASSWORD": "여기에_비밀번호_입력",
    "DB2_CLIDRIVER_PATH": "여기에_DB2_CLI드라이버_bin_경로_입력"
  }
}
```

**MariaDB / MySQL (별칭: sub1):**
```json
"db-sub1": {
  "command": "python",
  "args": ["{PLUGIN_PATH}/mcp-servers/mariadb_schema_server.py"],
  "env": {
    "PROJECT_DIR": "여기에_프로젝트_루트_절대경로_입력",
    "ENV": "local",
    "MDB_HOST": "여기에_sub1_DB_호스트_IP_입력",
    "MDB_PORT": "3306",
    "MDB_DATABASE": "여기에_DB명_입력",
    "MDB_USER": "여기에_아이디_입력",
    "MDB_PASSWORD": "여기에_비밀번호_입력"
  }
}
```

**PostgreSQL (별칭: analytics):**
```json
"db-analytics": {
  "command": "npx",
  "args": [
    "-y",
    "@modelcontextprotocol/server-postgres",
    "postgresql://여기에_아이디:여기에_비밀번호@여기에_호스트:5432/여기에_DB명"
  ]
}
```

**Oracle (별칭: {별칭}):**
```json
"db-{별칭}": {
  "command": "python",
  "args": ["{PLUGIN_PATH}/mcp-servers/oracle_schema_server.py"],
  "env": {
    "PROJECT_DIR": "여기에_프로젝트_루트_절대경로_입력",
    "ENV": "local",
    "ORA_HOST": "여기에_호스트_입력",
    "ORA_PORT": "1521",
    "ORA_SERVICE": "여기에_SERVICE_NAME_입력",
    "ORA_USER": "여기에_아이디_입력",
    "ORA_PASSWORD": "여기에_비밀번호_입력"
  }
}
```

**MSSQL (별칭: {별칭}):**
```json
"db-{별칭}": {
  "command": "npx",
  "args": ["-y", "@azure/mcp-server-mssql"],
  "env": {
    "MSSQL_HOST": "여기에_호스트_입력",
    "MSSQL_PORT": "1433",
    "MSSQL_DATABASE": "여기에_DB명_입력",
    "MSSQL_USER": "여기에_아이디_입력",
    "MSSQL_PASSWORD": "여기에_비밀번호_입력",
    "MSSQL_ENCRYPT": "false"
  }
}
```

#### Atlassian 항목 (온프레미스)

> 온프레미스는 `mcp-atlassian` 패키지를 사용한다 (`uvx` 필요).
> Jira Data Center는 PAT, Jira Server는 비밀번호를 JIRA_API_TOKEN에 입력한다.

```json
"atlassian": {
  "command": "uvx",
  "args": ["mcp-atlassian"],
  "env": {
    "JIRA_URL": "https://여기에_온프레미스_지라_주소_입력",
    "JIRA_USERNAME": "여기에_지라_사용자명_입력",
    "JIRA_API_TOKEN": "여기에_지라_PAT_또는_비밀번호_입력",
    "CONFLUENCE_URL": "https://여기에_온프레미스_위키_주소_입력",
    "CONFLUENCE_USERNAME": "여기에_위키_사용자명_입력",
    "CONFLUENCE_API_TOKEN": "여기에_위키_PAT_또는_비밀번호_입력"
  }
}
```

> Jira만 선택 시 CONFLUENCE_* 항목 제거.
> Wiki만 선택 시 JIRA_* 항목 제거.

#### Atlassian 항목 (클라우드)

```json
"atlassian": {
  "command": "uvx",
  "args": ["mcp-atlassian"],
  "env": {
    "JIRA_URL": "https://여기에_회사명.atlassian.net",
    "JIRA_USERNAME": "여기에_이메일_입력",
    "JIRA_API_TOKEN": "여기에_API_토큰_입력",
    "CONFLUENCE_URL": "https://여기에_회사명.atlassian.net/wiki",
    "CONFLUENCE_USERNAME": "여기에_이메일_입력",
    "CONFLUENCE_API_TOKEN": "여기에_API_토큰_입력"
  }
}
```

#### 최종 .mcp.json 구조

**Write tool로 프로젝트 루트에 `.mcp.json`을 생성할 때의 전체 구조:**

```json
{
  "mcpServers": {
    "db-{별칭1}": { ... },
    "db-{별칭2}": { ... },
    "atlassian": { ... }
  }
}
```

DB가 0개이고 Atlassian도 없으면 `.mcp.json` 생성을 건너뛴다.

---

### 4-4. project.env에 MCP 연동 플래그 기록

4-1·4-2에서 수집한 선택을 바탕으로 `project.env`에 MCP 설정 여부를 추가한다.  
**연결 테스트는 하지 않는다 — 자격증명 미입력 상태이므로 `/sl-recon` 첫 단계에서 테스트한다.**

Write tool로 `project.env`를 읽어 아래 내용을 **추가(append)** 한다:

```
# MCP 연동 설정 (true=활성, false=비활성)
MCP_DB_{별칭1}=true       ← 선택한 DB 수만큼 반복 (없으면 생략)
MCP_DB_{별칭2}=true
MCP_JIRA=true/false       ← Jira 선택 여부
MCP_WIKI=true/false       ← Wiki 선택 여부
# SR 작업보드 조회 범위 (MCP_JIRA=true일 때) — 아래 중 하나 권장
# JIRA_PROJECT=PROJ            ← 지라 프로젝트 키(폴더명 아님). 내 미완료 SR 조회에 사용
# JIRA_JQL=...                 ← 커스텀 JQL(최우선). 시스템/컴포넌트 등 임의 필터
```

> **Jira 선택 시 SR 보드 조회 범위를 물어 `JIRA_PROJECT` 또는 `JIRA_JQL`을 기록한다.**
> 둘 다 없으면 SR 보드는 전체를 긁지 않고 실행 시점에 다시 질문한다(`PROJECT_NAME`=폴더명은 지라 키가 아님).

예시 (DB 2개 + Jira, 시스템 기준 JQL):
```
MCP_DB_main=true
MCP_DB_sub1=true
MCP_JIRA=true
MCP_WIKI=false
JIRA_PROJECT=KSHOPSR
JIRA_JQL=(시스템구분 = "KDI/KDI파트너" OR component = KDI) AND statusCategory != Done ORDER BY updated DESC
```

DB가 0개이고 Jira/Wiki도 선택하지 않은 경우, 아래만 추가한다:
```
MCP_JIRA=false
MCP_WIKI=false
```

---

### 4-5. 보안 처리 및 안내

.gitignore에 `.mcp.json` 추가:

```powershell
$gi = ".gitignore"
if (!(Test-Path $gi)) { New-Item $gi -ItemType File | Out-Null }
$content = Get-Content $gi -Raw -ErrorAction SilentlyContinue
if ($content -notmatch "\.mcp\.json") { Add-Content $gi "`n.mcp.json" }
Write-Output ".gitignore 업데이트 완료"
```

사용자에게 아래를 출력한다:

```
.mcp.json 이 생성되었습니다.

⚠️  보안 주의사항:
    - 직접 파일을 열어 플레이스홀더를 채워주세요
    - .gitignore에 자동 추가됨 — 절대 Git 커밋 금지
    - 비밀번호/PAT는 이 파일에만 보관, 다른 곳 공유 금지

수정할 항목:
  DB({별칭}): HOST / PORT / DATABASE / USER / PASSWORD
  Jira/Wiki:  URL / USERNAME / API_TOKEN (또는 PAT)

온프레미스 Atlassian 인증 방식:
  - Jira Data Center → PAT (Personal Access Token) 권장
  - Jira Server      → 사용자명 + 비밀번호
  - PAT 발급: 지라 우측상단 프로필 → Personal Access Tokens

필요 패키지 (최초 1회):
  uvx 설치:  pip install uv
  테스트:    uvx mcp-atlassian --help

수정 완료 후 Claude Code를 재시작하면 MCP가 활성화됩니다.
```

---

## Step 5 — RTM 초기화

`docs/02_추적표/RTM_v1.0.md` 파일이 이미 존재하면 건너뛴다.

존재하지 않으면 **Write tool로 아래 내용으로 `docs/02_추적표/RTM_v1.0.md`를 직접 생성한다:**

```markdown
---
doc_id: RTM-001
doc_type: 요구사항 추적 매트릭스
version: 1.0
status: draft
created: {CREATED}
updated: {CREATED}
project: {PROJECT_NAME}
author: Claude (자동 생성)
linked_docs:
  - RD-001
  - SRS-001
---

# 요구사항 추적 매트릭스 (Requirements Traceability Matrix)

> **문서 목적**: FUNC-ID를 공통 키로 설계→코드→테스트 전 체인을 추적한다.
> **DELTA 활용**: `domain` 컬럼을 기준으로 sl-change가 관련 ID만 선택적으로 로드한다.

---

## 1. 상태값 범례

| 상태 | 의미 |
|------|------|
| ⬜ 미착수 | 작업 시작 전 |
| 🔄 진행중 | 설계 또는 개발 진행 중 |
| 🧪 테스트중 | 구현 완료, 테스트 진행 중 |
| ✅ 완료 | 테스트 통과, 완전 완료 |
| ❌ 제외 | 범위 제외 또는 취소 |
| 🔁 변경중 | SR에 의해 변경 진행 중 |

---

## 2. 기능 요구사항 추적

| domain | FUNC-ID | 기능명 | SRS-ID | UIS-ID | INF-ID | SCH-ID | TC-ID | SR-ID | 상태 |
|--------|--------|-----------|--------|--------|--------|--------|-------|-------|------|

---

## 3. 비기능 요구사항 추적

| domain | FUNC-ID | 기능명 | SRS-ID | INF-ID | 설계 문서 | 측정 방법 | TC-ID | 상태 |
|--------|--------|-----------|--------|--------|----------|----------|-------|------|

---

## 4. 변경 요구사항 추적 (DELTA)

| SR-ID | FUNC-ID | 변경 유형 | 변경 요약 | domain | 영향 INF | 영향 SCH | 영향 UIS | 변경일 | 상태 |
|-------|--------|---------|----------|--------|---------|---------|---------|--------|------|

---

## 5. 도메인 색인

| domain | API 파일 | DB 파일 | UI 파일 | FUNC 수 |
|--------|---------|---------|---------|--------|

---

## 6. 커버리지 요약

| 구분 | 전체 | 완료 | 진행중 | 미착수 | 완료율 |
|------|------|------|--------|--------|--------|
| 기능 요구사항 | 0 | 0 | 0 | 0 | 0% |
| 비기능 요구사항 | 0 | 0 | 0 | 0 | 0% |
| 변경 요구사항(SR) | 0 | 0 | 0 | 0 | 0% |
| **전체** | **0** | **0** | **0** | **0** | **0%** |

---

## 7. 변경 이력

| 버전 | 날짜 | 변경 내용 | SR-ID | 작성자 |
|------|------|----------|-------|--------|
| 1.0 | {CREATED} | 최초 생성 (/sl-init) | | Claude |
```

---

## Step 5.5 — 소스 스캔 + 도메인 카탈로그

> `scan_source.js`로 소스를 스캔하고, **relPath 디렉토리 경로 기반**으로 도메인을 미리 분류한다 (Java/Next.js 등 스택 무관).
> 이 카탈로그는 `/sl-recon` 실행 시 "처리할 도메인 선택" 화면의 입력이 된다.

```bash
!python -c "
import os, sys, subprocess, json
try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except: pass

env = dict(l.strip().split('=',1) for l in open('project.env', encoding='utf-8')
           if '=' in l and not l.startswith('#'))

plugin = env.get('PLUGIN_PATH','')
scan   = os.path.join(plugin, 'scripts', 'scan_source.js') if plugin else ''
catpy  = os.path.join(plugin, 'scripts', 'build_domain_catalog.py') if plugin else ''

if not (scan and os.path.exists(scan)):
    print('[WARN] scan_source.js 없음 — 스캔 건너뜀 (PLUGIN_PATH 확인)')
    sys.exit(0)

print('소스 스캔 중 (scan_source.js)...')
r = subprocess.run(['node', scan, '--workspace=.'],
                   capture_output=True, text=True, encoding='utf-8', errors='replace')
if r.returncode != 0:
    print('[WARN] 스캔 실패 — /sl-recon에서 재시도:', (r.stderr or '')[:300])
    sys.exit(0)

idx_path = '_tmp/source_index.json'
if not os.path.exists(idx_path):
    print('[WARN] source_index.json 미생성 — /sl-recon에서 재시도')
    sys.exit(0)
data = json.load(open(idx_path, encoding='utf-8'))
print(f'  소스 스캔 완료: {len(data.get(\"files\",[]))}개 파일')

if catpy and os.path.exists(catpy):
    r2 = subprocess.run([sys.executable, catpy, idx_path, '_tmp/domain_catalog.json'],
                        capture_output=True, text=True, encoding='utf-8', errors='replace')
    print(r2.stdout)
    if r2.returncode != 0:
        print('[WARN] 도메인 카탈로그 생성 실패:', (r2.stderr or '')[:300])
else:
    print('[WARN] build_domain_catalog.py 없음 — /sl-recon에서 생성')
"
```

> 출력된 도메인 목록은 `_tmp/domain_catalog.json`에 저장된다.
> `/sl-recon` 실행 시 이 목록에서 처리할 도메인을 선택하게 된다.

---

## Step 6 — 다음 단계 안내

Step 2-B에서 캡처 설정을 완료했는지 여부에 따라 다른 안내를 출력한다.

**캡처 설정 완료한 경우:**
```
초기화 완료.

체크리스트:
  [ ] /sl-recon-uis 실행 전 Chrome CDP 모드로 실행:
      Windows: Start-Process chrome -ArgumentList '--remote-debugging-port=9222'
      macOS  : open -a "Google Chrome" --args --remote-debugging-port=9222
  [ ] PREVIEW_BASE_URL 접속 및 로그인 완료

다음 커맨드:
  - 기존 코드 (문서 없음)      → /sl-recon 실행 (도메인 선택 후 부분 처리 가능)
  - 코드·문서 모두 있음 (변경)  → /sl-change <SR> 실행
```

**캡처 설정 건너뛴 경우:**
```
초기화 완료.

캡처가 필요하면 나중에 project.env 에서 직접 설정하세요:
  PREVIEW_BASE_URL=http://localhost:3333   ← 주석 해제 후 URL 입력
  PREVIEW_CDP_PORT=9222                   ← Chrome 디버깅 포트 (기본값)

다음 커맨드:
  - 기존 코드 (문서 없음)      → /sl-recon 실행 (도메인 선택 후 부분 처리 가능)
  - 코드·문서 모두 있음 (변경)  → /sl-change <SR> 실행
```

---

## 출력 결과

- `project.env` — NETWORK, PROJECT_NAME, PLUGIN_PATH (Write tool 생성)
- `.mcp.json` — DB(N개) + Atlassian 연동 템플릿 (NETWORK=open이고 연동 선택 시, Write tool 생성)
- `.gitignore` — .mcp.json 항목 추가
- `README_DIRS.md` — 폴더 구조 설명 (Write tool 생성)
- `docs/02_추적표/RTM_v1.0.md` — 빈 추적 매트릭스 (Write tool 생성)
- `docs/` 하위 전체 디렉토리
