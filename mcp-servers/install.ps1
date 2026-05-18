# =============================================================================
# Speclinker MCP Servers — Windows 설치 스크립트 (PowerShell)
# =============================================================================
# 실행 방법:
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\install.ps1
# =============================================================================

$ErrorActionPreference = "Stop"

function Write-Step($msg)  { Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "  [!!] $msg" -ForegroundColor Yellow }
function Write-Fail($msg)  { Write-Host "  [XX] $msg" -ForegroundColor Red }

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path

# -----------------------------------------------------------------------------
# 1. Python 확인
# -----------------------------------------------------------------------------
Write-Step "Python 확인"
try {
    $pyver = python --version 2>&1
    if ($pyver -match "Python (\d+)\.(\d+)") {
        $major = [int]$Matches[1]; $minor = [int]$Matches[2]
        if ($major -lt 3 -or ($major -eq 3 -and $minor -lt 10)) {
            Write-Fail "Python 3.10 이상이 필요합니다. (현재: $pyver)"
            exit 1
        }
        Write-Ok $pyver
    }
} catch {
    Write-Fail "Python을 찾을 수 없습니다. https://python.org 에서 설치 후 재시도하세요."
    exit 1
}

# -----------------------------------------------------------------------------
# 2. pip 업그레이드
# -----------------------------------------------------------------------------
Write-Step "pip 업그레이드"
python -m pip install --upgrade pip --quiet
Write-Ok "pip 최신 버전"

# -----------------------------------------------------------------------------
# 3. uv 설치 (uvx mcp-atlassian 실행에 필요)
# -----------------------------------------------------------------------------
Write-Step "uv 설치 확인 (uvx mcp-atlassian 실행용)"
$uvInstalled = $false
try {
    $uvver = uvx --version 2>&1
    Write-Ok "uv 이미 설치됨: $uvver"
    $uvInstalled = $true
} catch { }

if (-not $uvInstalled) {
    Write-Host "  uv 설치 중..."
    pip install uv --quiet
    try {
        $uvver = uvx --version 2>&1
        Write-Ok "uv 설치 완료: $uvver"
    } catch {
        Write-Warn "uvx 명령을 찾을 수 없습니다. PATH를 확인하거나 새 터미널을 열어보세요."
    }
}

# -----------------------------------------------------------------------------
# 4. 핵심 패키지 설치 (Oracle / MariaDB / 공통)
# -----------------------------------------------------------------------------
Write-Step "핵심 Python 패키지 설치"
$core_packages = @(
    "mcp[cli]>=1.0.0",
    "fastmcp>=0.1.0",
    "sqlalchemy>=2.0.0",
    "pandas>=2.0.0",
    "python-dotenv>=1.0.0",
    "PyMySQL>=1.1.0",
    "python-oracledb>=2.0.0"
)

foreach ($pkg in $core_packages) {
    Write-Host "  설치: $pkg"
    pip install $pkg --quiet
}
Write-Ok "핵심 패키지 설치 완료"

# -----------------------------------------------------------------------------
# 5. DB2 패키지 설치 (선택)
# -----------------------------------------------------------------------------
Write-Step "DB2 패키지 (선택사항)"
Write-Host "  DB2를 사용하시겠습니까? [y/N] " -NoNewline
$ans = Read-Host
if ($ans -match "^[yY]") {
    Write-Host ""
    Write-Warn "ibm_db 설치 전 IBM ODBC CLI Driver가 필요합니다."
    Write-Warn "드라이버 경로 예: D:\v9.7fp11_ntx64_odbc_cli\clidriver\bin"
    Write-Host "  IBM CLI Driver 경로를 입력하세요 (없으면 Enter 스킵): " -NoNewline
    $cliPath = Read-Host
    if ($cliPath -and (Test-Path $cliPath)) {
        $env:IBM_DB_HOME = Split-Path -Parent $cliPath
        pip install ibm_db ibm_db_sa --quiet
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "ibm_db 설치 완료"
        } else {
            Write-Warn "ibm_db 설치 실패. 수동으로 설치하세요: pip install ibm_db ibm_db_sa"
        }
    } else {
        Write-Warn "CLI Driver 경로를 찾을 수 없습니다. ibm_db 설치를 건너뜁니다."
        Write-Warn "나중에 설치: pip install ibm_db ibm_db_sa"
    }
} else {
    Write-Warn "DB2 패키지 건너뜀. 나중에 필요하면: pip install ibm_db ibm_db_sa"
}

# -----------------------------------------------------------------------------
# 6. mcp-atlassian 사전 캐싱 (선택)
# -----------------------------------------------------------------------------
Write-Step "mcp-atlassian 사전 다운로드 (선택)"
Write-Host "  Jira / Confluence MCP를 미리 다운로드하시겠습니까? [y/N] " -NoNewline
$ans2 = Read-Host
if ($ans2 -match "^[yY]") {
    Write-Host "  mcp-atlassian 캐싱 중 (인터넷 필요)..."
    try {
        uvx mcp-atlassian --help 2>&1 | Out-Null
        Write-Ok "mcp-atlassian 캐싱 완료"
    } catch {
        Write-Warn "캐싱 실패. uvx mcp-atlassian --help 를 직접 실행해보세요."
    }
} else {
    Write-Warn "건너뜀. Claude Code 최초 연결 시 자동 다운로드됩니다."
}

# -----------------------------------------------------------------------------
# 7. 설치 결과 요약
# -----------------------------------------------------------------------------
Write-Host "`n=============================================" -ForegroundColor Cyan
Write-Host " 설치 완료" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host @"

다음 단계:
  1) 프로젝트 디렉토리에서 Claude Code 실행
  2) /sl-init 입력 → 네트워크 환경 선택 → DB/Jira 연결 구성
  3) 생성된 .mcp.json 파일을 열어 자격증명 입력
     (HOST / PORT / USER / PASSWORD / URL / PAT 등)
  4) Claude Code 재시작 → MCP 자동 활성화

DB2 CLI Driver (별도 설치):
  https://www.ibm.com/support/pages/db2-odbc-cli-driver-download-and-installation-information

"@ -ForegroundColor White
