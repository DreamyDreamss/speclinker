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

## Step 0-B — 모드 선택

사용자에게 아래를 출력하여 모드를 선택받는다:

```
실행 모드를 선택해 주세요:

1) RECON   — 기존 소스코드가 있고, 설계서를 역분석으로 생성 (→ /sl-recon)
2) GENESIS — 신규 프로젝트, 기획 문서로 설계서를 순방향으로 생성 (→ /sl-genesis)
```

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
MODE=<선택한 값: RECON 또는 GENESIS>
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
# ── 슬라이스 옵션 (3종, 우선순위: SCREENS > DOMAINS > LIMIT) ──
# POC_SCREENS=                     # 쉼표 구분 화면명 (예: Or701Form,LoginPage)
#                                  # 지정 화면이 호출하는 API URL만 자동 추출 → INF/UIS/SCH 전부 슬라이스
# POC_DOMAINS=                     # 쉼표 구분 도메인 (예: auth,order). 도메인 단위로 처리
# POC_FILE_LIMIT=                  # 도메인별 INF 컨트롤러 파일 수 제한 (예: 5) — alphabetical
#
# ── UA 재사용 ──
# POC_SKIP_UA=false                # true면 STEP 1 UA 분석 스킵 (기존 knowledge-graph 재사용)

# 미리보기 캡처 (선택 — RECON UI 스크린샷, Playwright 기반)
# PREVIEW_BASE_URL 설정 시 실제 dev/staging 서버를 헤드리스 캡처
# 미설정 시 사용자 수동 PNG 제출 또는 미리보기 생략으로 폴백
#
# 사용 절차:
#   1. npm install --save-dev playwright   (1회)
#   2. node scripts/runtime_capture.js --bootstrap .   (Chrome GUI로 1회 수동 로그인)
#   3. sl-recon STEP 5-C에서 자동 캡처 (storageState 재사용)
#
# PREVIEW_BASE_URL=http://localhost:3333
# PREVIEW_STORAGE_STATE=./.preview-storage.json          # storageState 저장 위치 (쿠키+localStorage)
# PREVIEW_VIEWPORT=1440x900
# PREVIEW_WAIT_UNTIL=networkidle                          # load|domcontentloaded|networkidle
# PREVIEW_TIMEOUT_MS=30000
# PREVIEW_LOGIN_URL_PATTERN=/login,/auth/signin           # 만료 감지용 로그인 URL 패턴
# PREVIEW_CHROME_PATH=                                    # 시스템 Chrome 재사용 (playwright-core 사용 시)
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

---

## Step 3 — 디렉토리 생성

아래 PowerShell 명령으로 디렉토리를 생성한다:

```powershell
New-Item -ItemType Directory -Force -Path @(
  "docs/00_입력자료",
  "docs/01_요구사항정의서",
  "docs/01_요구사항정의서/req",
  "docs/02_추적표",
  "docs/03_기능명세서",
  "docs/03_기능명세서/srs",
  "docs/04_아키텍처설계서",
  "docs/05_설계서",
  "docs/07_테스트케이스",
  "docs/08_테스트결과보고서",
  "docs/변경관리",
  "06_소스코드/src",
  "06_소스코드/tests",
  "06_소스코드/reviews"
) | Out-Null
Write-Output "디렉토리 생성 완료"
```

그 다음 **Write tool로 `README_DIRS.md` 파일을 직접 생성한다:**

---

### Step 3-A — UA 코어 빌드 확인

대시보드가 동작하려면 `@understand-anything/core`가 빌드되어 있어야 한다.

```powershell
# PLUGIN_PATH는 project.env에서 읽거나 Step 2에서 감지한 값 사용
$PLUGIN_PATH = (Get-Content "project.env" -Encoding UTF8 | Where-Object {$_ -match "^PLUGIN_PATH="} | ForEach-Object {$_ -replace "^PLUGIN_PATH=",""}).Trim()
$coreIndex = "$PLUGIN_PATH/ua/packages/core/dist/index.js"
if (Test-Path $coreIndex) {
    Write-Host "[OK] UA core 빌드 확인됨" -ForegroundColor Green
} else {
    Write-Host "[빌드 필요] UA core 빌드 시작..." -ForegroundColor Yellow
    Push-Location "$PLUGIN_PATH/ua"
    pnpm --filter @understand-anything/core build 2>&1
    Pop-Location
    if (Test-Path $coreIndex) {
        Write-Host "[OK] UA core 빌드 완료" -ForegroundColor Green
    } else {
        Write-Host "[경고] 빌드 실패 — 수동 실행 필요: cd $PLUGIN_PATH/ua && pnpm --filter @understand-anything/core build" -ForegroundColor Red
    }
}
```

---

### Step 3-B — 대시보드 실행 스크립트 생성

**Write tool로 프로젝트 루트에 `run-dashboard.ps1`을 생성한다 (Windows용):**

```powershell
# run-dashboard.ps1 파일 내용:
$env_content = Get-Content "project.env" -Encoding UTF8
$plugin_path = ($env_content | Where-Object {$_ -match "^PLUGIN_PATH="} | ForEach-Object {$_ -replace "^PLUGIN_PATH=",""}).Trim()
$workspace   = ($env_content | Where-Object {$_ -match "^WORKSPACE_DIR="} | ForEach-Object {$_ -replace "^WORKSPACE_DIR=",""}).Trim()
$env:GRAPH_DIR = $workspace
Set-Location "$plugin_path/ua/packages/dashboard"
Write-Host "대시보드 시작 중... (GRAPH_DIR=$workspace)"
pnpm dev
```

**Write tool로 `run-dashboard.sh`도 생성한다 (Mac/Linux/Git Bash용):**

```bash
#!/usr/bin/env bash
PLUGIN_PATH=$(grep "^PLUGIN_PATH=" project.env | cut -d= -f2-)
WORKSPACE=$(grep "^WORKSPACE_DIR=" project.env | cut -d= -f2-)
export GRAPH_DIR="$WORKSPACE"
echo "대시보드 시작 중... (GRAPH_DIR=$WORKSPACE)"
cd "$PLUGIN_PATH/ua/packages/dashboard" && pnpm dev
```

사용자에게 안내한다:
```
대시보드 실행 방법:
  Windows PowerShell : .\run-dashboard.ps1
  Mac/Linux/Git Bash : bash run-dashboard.sh

  [참고] run-dashboard.sh 는 bash 환경 필요:
    - Windows: Git Bash (https://git-scm.com/downloads) 설치 후 사용
    - Mac/Linux: 기본 터미널에서 바로 사용 가능
```

---

```markdown
# 프로젝트 산출물 구조

| 폴더 | 역할 |
|------|------|
| docs/00_입력자료/ | 기획 문서·인터뷰·회의록 원본 (sl-genesis 입력) |
| docs/01_요구사항정의서/ | 요구사항 정의서 (RD_v1.0.md) |
| docs/01_요구사항정의서/req/ | 대형 프로젝트 시 REQ 개별 파일 분리 |
| docs/02_추적표/ | 요구사항 추적 매트릭스 |
| docs/03_기능명세서/ | 기능 명세서 (SRS_v1.0.md) |
| docs/03_기능명세서/srs/ | 도메인별 SRS 분리 파일 |
| docs/04_아키텍처설계서/ | 시스템 아키텍처 설계서 |
| docs/05_설계서/ | 상세 설계서 (API_Design.md, DB_Schema.md, UI_Spec.md) |
| docs/07_테스트케이스/ | 테스트 케이스 명세서 |
| docs/08_테스트결과보고서/ | 테스트 결과 보고서 |
| docs/변경관리/ | SR별 분석서·변경명세·TC (sl-change 생성) |
| 06_소스코드/src/ | 프로덕션 소스코드 |
| 06_소스코드/tests/ | 단위 테스트 |
| 06_소스코드/reviews/ | 코드 리뷰 결과 (sl-dev --review) |

생성일: {CREATED} | 작성자: Claude
```

---

## Step 4 — MCP 연동 설정 (NETWORK=open 인 경우만)

> NETWORK=closed 이면 이 단계 전체를 건너뛴다.

### 4-0. MCP 런타임 환경 검사

NETWORK=open인 경우, project.env의 PLUGIN_PATH를 사용하여 환경 검사 스크립트를 실행한다:

```powershell
$PLUGIN_PATH = (Get-Content "project.env" -Encoding UTF8 | Where-Object {$_ -match "^PLUGIN_PATH="} | ForEach-Object {$_ -replace "^PLUGIN_PATH=",""}).Trim()
$INSTALL_PY  = "$PLUGIN_PATH/mcp-servers/install.py"
if (Test-Path $INSTALL_PY) {
    $py = if (Get-Command python3 -ErrorAction SilentlyContinue) { "python3" } else { "python" }
    & $py $INSTALL_PY
} else { Write-Output "환경 검사 스크립트 없음 — 건너뜀" }
```

> 스크립트가 현재 환경을 스캔하여 설치 상태를 출력하고, 누락된 항목만 선택 설치한다.
> 실행 실패 시 오류를 노출하지 말고 조용히 건너뛰어 다음 단계로 진행한다.

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

---

### 4-3. .mcp.json 생성

**사전 준비 — 플러그인 설치 경로 자동 감지**

.mcp.json을 생성하기 전에 아래 PowerShell 명령으로 실제 설치 경로를 확인한다:

```powershell
$installJson = Get-Content "$env:USERPROFILE\.claude\plugins\installed_plugins.json" -Encoding UTF8 | ConvertFrom-Json
$entry = $installJson.plugins.'speclinker@local'
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
```

예시 (DB 2개 + Jira만 선택한 경우):
```
MCP_DB_main=true
MCP_DB_sub1=true
MCP_JIRA=true
MCP_WIKI=false
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

> **문서 목적**: REQ-ID를 공통 키로 설계→코드→테스트 전 체인을 추적한다.
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

| domain | REQ-ID | 요구사항명 | SRS-ID | UIS-ID | INF-ID | SCH-ID | TC-ID | SR-ID | 상태 |
|--------|--------|-----------|--------|--------|--------|--------|-------|-------|------|

---

## 3. 비기능 요구사항 추적

| domain | REQ-ID | 요구사항명 | SRS-ID | INF-ID | 설계 문서 | 측정 방법 | TC-ID | 상태 |
|--------|--------|-----------|--------|--------|----------|----------|-------|------|

---

## 4. 변경 요구사항 추적 (DELTA)

| SR-ID | REQ-ID | 변경 유형 | 변경 요약 | domain | 영향 INF | 영향 SCH | 영향 UIS | 변경일 | 상태 |
|-------|--------|---------|----------|--------|---------|---------|---------|--------|------|

---

## 5. 도메인 색인

| domain | API 파일 | DB 파일 | UI 파일 | REQ 수 |
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

## Step 6 — 다음 단계 안내

```
초기화 완료. 상황에 따라 다음 커맨드를 실행하세요:

- 새 프로젝트 (코드 없음)     → docs/00_입력자료/ 에 기획 문서를 넣고 /sl-genesis 실행
- 기존 코드 있음 (문서 없음)  → /sl-recon 실행
- 코드·문서 모두 있음 (변경)  → /sl-analyze 실행

대시보드 실행:
  Windows PowerShell : .\run-dashboard.ps1
  Mac/Linux/Git Bash : bash run-dashboard.sh
```

---

## 출력 결과

- `project.env` — MODE, NETWORK, PROJECT_NAME, PLUGIN_PATH (Write tool 생성)
- `run-dashboard.ps1` — Windows 대시보드 실행 스크립트 (Write tool 생성)
- `run-dashboard.sh` — Mac/Linux/Git Bash 대시보드 실행 스크립트 (Write tool 생성)
- `.mcp.json` — DB(N개) + Atlassian 연동 템플릿 (NETWORK=open이고 연동 선택 시, Write tool 생성)
- `.gitignore` — .mcp.json 항목 추가
- `README_DIRS.md` — 폴더 구조 설명 (Write tool 생성)
- `docs/02_추적표/RTM_v1.0.md` — 빈 추적 매트릭스 (Write tool 생성)
- `docs/` 하위 전체 디렉토리
