#!/usr/bin/env bash
# =============================================================================
# Speclinker MCP Servers — macOS / Linux 설치 스크립트
# =============================================================================
# 실행 방법:
#   chmod +x install.sh && ./install.sh
# =============================================================================

set -euo pipefail

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'

step() { echo -e "\n${CYAN}>>> $1${NC}"; }
ok()   { echo -e "  ${GREEN}[OK]${NC} $1"; }
warn() { echo -e "  ${YELLOW}[!!]${NC} $1"; }
fail() { echo -e "  ${RED}[XX]${NC} $1"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# -----------------------------------------------------------------------------
# 1. Python 확인
# -----------------------------------------------------------------------------
step "Python 확인"
PYTHON=""
for cmd in python3 python; do
    if command -v "$cmd" &>/dev/null; then
        VER=$("$cmd" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
        MAJOR=$(echo "$VER" | cut -d. -f1)
        MINOR=$(echo "$VER" | cut -d. -f2)
        if [ "$MAJOR" -ge 3 ] && [ "$MINOR" -ge 10 ]; then
            PYTHON="$cmd"
            ok "Python $VER ($cmd)"
            break
        fi
    fi
done
[ -z "$PYTHON" ] && fail "Python 3.10 이상이 필요합니다. https://python.org 에서 설치 후 재시도하세요."

PIP="$PYTHON -m pip"

# -----------------------------------------------------------------------------
# 2. pip 업그레이드
# -----------------------------------------------------------------------------
step "pip 업그레이드"
$PIP install --upgrade pip --quiet
ok "pip 최신 버전"

# -----------------------------------------------------------------------------
# 3. uv 설치
# -----------------------------------------------------------------------------
step "uv 설치 확인 (uvx mcp-atlassian 실행용)"
if command -v uvx &>/dev/null; then
    ok "uv 이미 설치됨: $(uvx --version 2>&1)"
else
    echo "  uv 설치 중..."
    $PIP install uv --quiet
    if command -v uvx &>/dev/null; then
        ok "uv 설치 완료"
    else
        warn "uvx 명령을 찾을 수 없습니다. PATH를 확인하거나 새 터미널을 열어보세요."
        warn "수동 설치: pip install uv"
    fi
fi

# -----------------------------------------------------------------------------
# 4. 핵심 패키지 설치
# -----------------------------------------------------------------------------
step "핵심 Python 패키지 설치"
CORE_PKGS=(
    "mcp[cli]>=1.0.0"
    "fastmcp>=0.1.0"
    "sqlalchemy>=2.0.0"
    "pandas>=2.0.0"
    "python-dotenv>=1.0.0"
    "PyMySQL>=1.1.0"
    "python-oracledb>=2.0.0"
)
for pkg in "${CORE_PKGS[@]}"; do
    echo "  설치: $pkg"
    $PIP install "$pkg" --quiet
done
ok "핵심 패키지 설치 완료"

# -----------------------------------------------------------------------------
# 5. DB2 패키지 (선택)
# -----------------------------------------------------------------------------
step "DB2 패키지 (선택사항)"
read -rp "  DB2를 사용하시겠습니까? [y/N] " ans
if [[ "$ans" =~ ^[yY]$ ]]; then
    warn "ibm_db 설치 전 IBM ODBC CLI Driver가 필요합니다."
    warn "Linux: /opt/ibm/v11.5/clidriver/bin 등"
    read -rp "  IBM CLI Driver bin 경로 (없으면 Enter 스킵): " cliPath
    if [ -n "$cliPath" ] && [ -d "$cliPath" ]; then
        export IBM_DB_HOME="$(dirname "$cliPath")"
        if $PIP install ibm_db ibm_db_sa --quiet; then
            ok "ibm_db 설치 완료"
        else
            warn "ibm_db 설치 실패. 수동으로 설치하세요: pip install ibm_db ibm_db_sa"
        fi
    else
        warn "CLI Driver 경로를 찾을 수 없습니다. ibm_db 설치를 건너뜁니다."
        warn "나중에 설치: pip install ibm_db ibm_db_sa"
    fi
else
    warn "DB2 패키지 건너뜀. 나중에 필요하면: pip install ibm_db ibm_db_sa"
fi

# -----------------------------------------------------------------------------
# 6. mcp-atlassian 사전 캐싱 (선택)
# -----------------------------------------------------------------------------
step "mcp-atlassian 사전 다운로드 (선택)"
read -rp "  Jira / Confluence MCP를 미리 다운로드하시겠습니까? [y/N] " ans2
if [[ "$ans2" =~ ^[yY]$ ]]; then
    echo "  mcp-atlassian 캐싱 중 (인터넷 필요)..."
    if uvx mcp-atlassian --help &>/dev/null; then
        ok "mcp-atlassian 캐싱 완료"
    else
        warn "캐싱 실패. uvx mcp-atlassian --help 를 직접 실행해보세요."
    fi
else
    warn "건너뜀. Claude Code 최초 연결 시 자동 다운로드됩니다."
fi

# -----------------------------------------------------------------------------
# 7. 완료 안내
# -----------------------------------------------------------------------------
echo -e "\n${CYAN}=============================================${NC}"
echo -e "${CYAN} 설치 완료${NC}"
echo -e "${CYAN}=============================================${NC}"
cat <<'EOF'

다음 단계:
  1) 프로젝트 디렉토리에서 Claude Code 실행
  2) /sl-init 입력 → 네트워크 환경 선택 → DB/Jira 연결 구성
  3) 생성된 .mcp.json 파일을 열어 자격증명 입력
     (HOST / PORT / USER / PASSWORD / URL / PAT 등)
  4) Claude Code 재시작 → MCP 자동 활성화

DB2 CLI Driver (별도 설치):
  https://www.ibm.com/support/pages/db2-odbc-cli-driver-download-and-installation-information

EOF
