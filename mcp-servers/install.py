#!/usr/bin/env python3
"""
Speclinker MCP 환경 검사 + 선택 설치

1단계) 현재 환경을 스캔해서 상태 표시
2단계) 누락/문제 항목만 골라서 설치 여부 확인
3단계) 사용자가 OK한 것만 설치

실행: python install.py
"""

import sys
import os
import subprocess
import platform
import shutil
import importlib.util
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# 출력 헬퍼
# ---------------------------------------------------------------------------
IS_TTY = sys.stdout.isatty()
CYAN   = "\033[0;36m" if IS_TTY else ""
GREEN  = "\033[0;32m" if IS_TTY else ""
YELLOW = "\033[1;33m" if IS_TTY else ""
RED    = "\033[0;31m" if IS_TTY else ""
GRAY   = "\033[0;90m" if IS_TTY else ""
BOLD   = "\033[1m"    if IS_TTY else ""
NC     = "\033[0m"    if IS_TTY else ""

def c(code, msg): return f"{code}{msg}{NC}"

OS_NAME = platform.system()   # Windows | Darwin | Linux
ARCH    = platform.machine()

def run_silent(cmd: list) -> tuple[int, str]:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        return r.returncode, (r.stdout + r.stderr).strip()
    except Exception as e:
        return -1, str(e)

def pip_install(*pkgs: str) -> bool:
    ret, _ = run_silent([sys.executable, "-m", "pip", "install", "--quiet", *pkgs])
    return ret == 0

def ask(prompt: str) -> str:
    try:
        return input(prompt).strip()
    except (EOFError, KeyboardInterrupt):
        return ""

# ---------------------------------------------------------------------------
# 검사 항목 정의
# ---------------------------------------------------------------------------
@dataclass
class CheckItem:
    key:     str
    label:   str
    status:  str = "unknown"   # ok | warn | missing
    detail:  str = ""
    fix_fn:  object = None     # callable or None
    optional: bool = False

# ---------------------------------------------------------------------------
# 검사 함수들
# ---------------------------------------------------------------------------
def _check_python() -> CheckItem:
    v = sys.version_info
    ver = f"{v.major}.{v.minor}.{v.micro}"
    if v.major < 3 or (v.major == 3 and v.minor < 10):
        return CheckItem("python", "Python 3.10+", "missing",
                         f"현재 {ver} — Python 3.10 이상 필요 (수동 설치)")
    return CheckItem("python", "Python 3.10+", "ok", ver)

def _check_uv() -> CheckItem:
    if shutil.which("uvx"):
        _, ver = run_silent(["uvx", "--version"])
        return CheckItem("uv", "uv / uvx  (mcp-atlassian 실행)", "ok", ver.split()[0] if ver else "설치됨")

    # pip으로 설치 가능한지 확인
    ret, _ = run_silent([sys.executable, "-m", "pip", "show", "uv"])
    if ret == 0:
        return CheckItem("uv", "uv / uvx  (mcp-atlassian 실행)", "warn",
                         "pip에 uv가 있지만 uvx 명령을 못 찾음 — PATH 재확인 필요",
                         _install_uv)
    return CheckItem("uv", "uv / uvx  (mcp-atlassian 실행)", "missing",
                     "미설치 — mcp-atlassian 연동 시 필요", _install_uv)

def _check_pkg(import_name: str, pip_name: str, label: str,
               optional=False) -> CheckItem:
    spec = importlib.util.find_spec(import_name.replace("-", "_").replace(".", "_"))
    if spec:
        try:
            ret, ver = run_silent([sys.executable, "-m", "pip", "show",
                                   pip_name.split(">=")[0].split("[")[0]])
            version_line = next((l for l in ver.splitlines() if l.startswith("Version:")), "")
            ver_str = version_line.replace("Version:", "").strip()
        except Exception:
            ver_str = "설치됨"
        return CheckItem(pip_name, label, "ok", ver_str, optional=optional)

    def _fix(p=pip_name):
        return pip_install(p)

    return CheckItem(pip_name, label, "missing", "미설치",
                     _fix, optional=optional)

def _check_mcp() -> CheckItem:
    spec = importlib.util.find_spec("mcp")
    if spec:
        ret, ver = run_silent([sys.executable, "-m", "pip", "show", "mcp"])
        version_line = next((l for l in ver.splitlines() if l.startswith("Version:")), "")
        return CheckItem("mcp", "mcp  (FastMCP 서버 프레임워크)", "ok",
                         version_line.replace("Version:", "").strip())

    def _fix():
        return pip_install("mcp[cli]>=1.0.0", "fastmcp>=0.1.0")

    return CheckItem("mcp", "mcp  (FastMCP 서버 프레임워크)", "missing", "미설치", _fix)

def _check_ibm_db() -> CheckItem:
    spec = importlib.util.find_spec("ibm_db")
    if spec:
        ret, ver = run_silent([sys.executable, "-m", "pip", "show", "ibm_db"])
        version_line = next((l for l in ver.splitlines() if l.startswith("Version:")), "")
        return CheckItem("ibm_db", "ibm_db  (DB2 — IBM CLI Driver 필요)", "ok",
                         version_line.replace("Version:", "").strip(), optional=True)

    return CheckItem("ibm_db", "ibm_db  (DB2 — IBM CLI Driver 필요)", "missing",
                     "미설치 — DB2 미사용 시 무시", _install_ibm_db, optional=True)

def _check_node() -> CheckItem:
    """PostgreSQL MCP는 npx로 실행 — Node.js 필요."""
    if shutil.which("npx"):
        _, ver = run_silent(["node", "--version"])
        return CheckItem("node", "Node.js / npx  (PostgreSQL MCP 실행)", "ok",
                         ver.strip())
    return CheckItem("node", "Node.js / npx  (PostgreSQL MCP 실행)", "warn",
                     "미설치 — PostgreSQL MCP 사용 시 필요 (https://nodejs.org)",
                     optional=True)

# ---------------------------------------------------------------------------
# 설치 함수들
# ---------------------------------------------------------------------------
def _install_uv():
    if OS_NAME == "Windows":
        return pip_install("uv")
    else:
        ret, _ = run_silent(
            ["sh", "-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"]
        )
        if ret != 0:
            return pip_install("uv")
        return True

def _install_ibm_db():
    print(f"\n  {c(YELLOW,'[!!]')} ibm_db는 IBM ODBC CLI Driver가 있어야 설치됩니다.")
    if OS_NAME == "Windows":
        win_example = "D:\\v9.7fp11_ntx64_odbc_cli\\clidriver\\bin"
        print(f"  {c(GRAY, '예시: ' + win_example)}")
    else:
        print(f"  {c(GRAY, '예시: /opt/ibm/v11.5/clidriver/bin')}")
    cli = ask("  IBM CLI Driver bin 경로 (없으면 Enter 건너뜀): ")
    if cli and os.path.isdir(cli):
        os.environ["IBM_DB_HOME"] = os.path.dirname(cli)
        return pip_install("ibm_db", "ibm_db_sa")
    print(f"  {c(GRAY,'→ 건너뜀. 나중에: pip install ibm_db ibm_db_sa')}")
    return False

# ---------------------------------------------------------------------------
# 1단계: 스캔
# ---------------------------------------------------------------------------
def scan() -> list[CheckItem]:
    print(f"\n{c(CYAN, BOLD + '환경 스캔 중...' + NC)}")
    items = [
        _check_python(),
        _check_uv(),
        _check_mcp(),
        _check_pkg("sqlalchemy",     "sqlalchemy>=2.0.0",    "SQLAlchemy  (DB 엔진)"),
        _check_pkg("pandas",         "pandas>=2.0.0",        "pandas  (쿼리 결과 변환)"),
        _check_pkg("dotenv",         "python-dotenv>=1.0.0", "python-dotenv  (.env 로드)"),
        _check_pkg("pymysql",        "PyMySQL>=1.1.0",       "PyMySQL  (MariaDB/MySQL 드라이버)"),
        _check_pkg("oracledb",       "python-oracledb>=2.0.0", "python-oracledb  (Oracle Thin 드라이버)"),
        _check_ibm_db(),
        _check_node(),
    ]
    return items

# ---------------------------------------------------------------------------
# 2단계: 결과 출력
# ---------------------------------------------------------------------------
STATUS_ICON = {"ok": c(GREEN, "✔"), "warn": c(YELLOW, "△"), "missing": c(RED, "✘"), "unknown": c(GRAY, "?")}

def print_report(items: list[CheckItem]):
    print(f"\n{c(BOLD, '─' * 55)}")
    print(f"{c(BOLD, '  항목'): <38}  {'상태': <8}  {'버전 / 메모'}")
    print(f"{c(BOLD, '─' * 55)}")
    for it in items:
        icon  = STATUS_ICON.get(it.status, "?")
        label = it.label
        if it.optional:
            label += f"  {c(GRAY,'[선택]')}"
        detail = c(GRAY, it.detail) if it.status == "ok" else it.detail
        print(f"  {icon}  {label: <36}  {detail}")
    print(f"{c(BOLD, '─' * 55)}")

# ---------------------------------------------------------------------------
# 3단계: 누락 항목 선별 → 설치 확인
# ---------------------------------------------------------------------------
def select_and_install(items: list[CheckItem], auto: bool = False):
    need = [it for it in items if it.status in ("missing", "warn") and it.fix_fn]
    if not need:
        print(f"\n{c(GREEN, '모든 항목이 설치되어 있습니다. 추가 설치가 필요 없습니다.')}")
        return

    # 비대화형(--yes): 필수(비optional) 누락만 자동 설치. optional(ibm_db: CLI Driver 경로 입력 필요)은 스킵.
    if auto:
        targets = [it for it in need if not it.optional]
        skipped = [it for it in need if it.optional]
        print(f"\n{c(CYAN, '[--yes] 자동 설치:')} {', '.join(it.label.split('  ')[0] for it in targets) or '(없음)'}")
        for it in targets:
            try:
                ok = it.fix_fn()
                print(f"  {c(GREEN,'[OK]') if ok else c(YELLOW,'[!!]')} {it.label.split('  ')[0]}")
            except Exception as e:
                print(f"  {c(RED,'[XX]')} {it.label.split('  ')[0]}: {e}")
        for it in skipped:
            print(f"  {c(GRAY,'[선택 스킵]')} {it.label.split('  ')[0]} — 수동: pip install (DB2는 IBM CLI Driver 필요)")
        return

    print(f"\n{c(YELLOW, '아래 항목이 없거나 확인이 필요합니다:')}")
    for i, it in enumerate(need, 1):
        tag = c(GRAY, "[선택]") if it.optional else c(RED, "[필수]")
        print(f"  {i}) {tag}  {it.label}  —  {it.detail}")

    print()
    ans = ask("설치하시겠습니까? [Y/n/선택(예: 1,3)] ").strip()

    if ans.lower() == "n":
        print(c(GRAY, "  건너뜀."))
        return

    # 설치 대상 결정
    if ans == "" or ans.lower() == "y":
        targets = need
    else:
        try:
            idxs    = [int(x.strip()) - 1 for x in ans.split(",")]
            targets = [need[i] for i in idxs if 0 <= i < len(need)]
        except ValueError:
            print(c(YELLOW, "  입력 형식 오류 — 전체 설치로 진행합니다."))
            targets = need

    print()
    for it in targets:
        print(f"  설치: {it.label}")
        try:
            ok = it.fix_fn()
            if ok:
                print(f"  {c(GREEN,'[OK]')} 완료")
            else:
                print(f"  {c(YELLOW,'[!!]')} 실패 또는 건너뜀")
        except Exception as e:
            print(f"  {c(RED,'[XX]')} 오류: {e}")

# ---------------------------------------------------------------------------
# mcp-atlassian 사전 캐싱 (별도 제안)
# ---------------------------------------------------------------------------
def offer_atlassian_cache():
    if not shutil.which("uvx"):
        return
    print(f"\n{c(CYAN,'─' * 55)}")
    print("  mcp-atlassian (Jira/Confluence MCP) 사전 캐싱")
    print(f"  {c(GRAY,'최초 실행 시 자동 다운로드되지만 미리 받아두면 빠릅니다.')}")
    ans = ask("  지금 캐싱하시겠습니까? [y/N] ")
    if not ans.lower().startswith("y"):
        print(c(GRAY, "  건너뜀. Claude Code 최초 연결 시 자동 다운로드됩니다."))
        return
    print("  다운로드 중...")
    ret, _ = run_silent(["uvx", "mcp-atlassian", "--help"])
    print(f"  {c(GREEN,'[OK]') if ret == 0 else c(YELLOW,'[!!] 실패 — 나중에 직접: uvx mcp-atlassian --help')}")

# ---------------------------------------------------------------------------
# 완료 안내
# ---------------------------------------------------------------------------
def print_next():
    print(f"""
{c(CYAN, '=' * 45)}
{c(CYAN, ' 환경 설정 완료')}
{c(CYAN, '=' * 45)}

다음 단계:
  1) /sl-init 로 돌아가서 계속 진행
  2) Step 4에서 생성된 .mcp.json 파일 열기
  3) 플레이스홀더를 실제 자격증명으로 교체
       HOST / PORT / USER / PASSWORD / URL / PAT
  4) Claude Code 재시작 → MCP 자동 활성화

DB2 IBM CLI Driver (별도 다운로드):
  https://www.ibm.com/support/pages/db2-odbc-cli-driver-download-and-installation-information
""")

# ---------------------------------------------------------------------------
# 메인
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    AUTO = "--yes" in sys.argv or "-y" in sys.argv
    print(f"{c(CYAN+BOLD, '=== Speclinker MCP 환경 검사 ===')} "
          f"{c(GRAY, f'({OS_NAME} / {ARCH})')}{c(GRAY, ' [--yes]' if AUTO else '')}")

    items = scan()
    print_report(items)
    select_and_install(items, auto=AUTO)
    if not AUTO:
        offer_atlassian_cache()
    print_next()
