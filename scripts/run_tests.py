# STATUS: 완료
#!/usr/bin/env python3
"""
run_tests.py — 언어/프레임워크 자동감지 테스트 러너 (크로스플랫폼)

Usage: python run_tests.py [project_root]
  project_root : project.env 가 있는 디렉토리 (기본값: 현재 디렉토리)

결과: docs/08_테스트결과보고서/test_run_{날짜}.json 에 저장
"""

import os, sys, json, subprocess, datetime, glob

PROJECT_ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.getcwd()
TODAY = datetime.date.today().isoformat()

# ── project.env 읽기 ──────────────────────────────────────────────────────────
def read_env() -> dict[str, str]:
    env_path = os.path.join(PROJECT_ROOT, "project.env")
    if not os.path.exists(env_path):
        return {}
    result: dict[str, str] = {}
    for line in open(env_path, encoding="utf-8"):
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.strip().split("=", 1)
            result[k.strip()] = v.strip()
    return result

# ── 소스 경로 목록 ────────────────────────────────────────────────────────────
def get_source_paths(env: dict[str, str]) -> list[tuple[str, str]]:
    """(label, path) 목록 반환"""
    result: list[tuple[str, str]] = []
    count = int(env.get("SOURCE_COUNT", "1") or "1")
    for i in range(1, count + 1):
        label = env.get(f"SOURCE_{i}_LABEL", f"src{i}")
        path  = env.get(f"SOURCE_{i}_PATH",  PROJECT_ROOT)
        if os.path.isdir(path):
            result.append((label, path))
    if not result:
        result.append(("src", PROJECT_ROOT))
    return result

# ── 프로젝트 타입 감지 ────────────────────────────────────────────────────────
def detect_project_type(root: str) -> str:
    """가장 가능성 높은 프로젝트 타입 반환"""
    checks: list[tuple[str, list[str]]] = [
        ("gradle_kotlin", ["build.gradle.kts"]),
        ("gradle_java",   ["build.gradle", "gradlew"]),
        ("maven",         ["pom.xml"]),
        ("node_npm",      ["package.json"]),
        ("node_yarn",     ["yarn.lock"]),
        ("node_pnpm",     ["pnpm-lock.yaml"]),
        ("python_pytest", ["pytest.ini", "pyproject.toml", "setup.py", "requirements.txt"]),
        ("go",            ["go.mod"]),
        ("dotnet",        ["*.csproj", "*.sln"]),
        ("rust",          ["Cargo.toml"]),
        ("php_composer",  ["composer.json"]),
        ("ruby_rspec",    ["Gemfile", "Rakefile"]),
    ]
    for name, markers in checks:
        for marker in markers:
            if "*" in marker:
                if glob.glob(os.path.join(root, marker)):
                    return name
            elif os.path.exists(os.path.join(root, marker)):
                return name
    return "unknown"

# ── 타입별 실행 커맨드 ────────────────────────────────────────────────────────
def build_command(proj_type: str, root: str) -> list[str] | None:
    is_win = sys.platform == "win32"
    gradlew = os.path.join(root, "gradlew.bat" if is_win else "gradlew")
    mvnw    = os.path.join(root, "mvnw.cmd"    if is_win else "mvnw")

    commands: dict[str, list[str]] = {
        "gradle_kotlin": [gradlew, "test"] if os.path.exists(gradlew) else ["gradle", "test"],
        "gradle_java":   [gradlew, "test"] if os.path.exists(gradlew) else ["gradle", "test"],
        "maven":         [mvnw, "test"]    if os.path.exists(mvnw)    else ["mvn", "test"],
        "node_npm":      ["npm", "test", "--", "--passWithNoTests"],
        "node_yarn":     ["yarn", "test", "--passWithNoTests"],
        "node_pnpm":     ["pnpm", "test"],
        "python_pytest": [sys.executable, "-m", "pytest", "--tb=short", "-q"],
        "go":            ["go", "test", "./..."],
        "dotnet":        ["dotnet", "test", "--no-build"],
        "rust":          ["cargo", "test"],
        "php_composer":  ["./vendor/bin/phpunit"],
        "ruby_rspec":    ["bundle", "exec", "rspec"],
    }
    return commands.get(proj_type)

# ── 테스트 실행 ───────────────────────────────────────────────────────────────
def run_tests_for(label: str, root: str) -> dict:
    proj_type = detect_project_type(root)
    cmd = build_command(proj_type, root)

    record: dict = {
        "label":     label,
        "root":      root,
        "type":      proj_type,
        "command":   " ".join(cmd) if cmd else None,
        "status":    None,
        "exit_code": None,
        "stdout":    "",
        "stderr":    "",
        "duration_sec": 0,
    }

    if not cmd:
        record["status"] = "skipped"
        record["stderr"] = f"[{label}] 알 수 없는 프로젝트 타입: {proj_type}"
        print(f"  [{label}] 감지 실패 — 테스트 명령을 알 수 없음 (타입: {proj_type})")
        return record

    print(f"  [{label}] 감지: {proj_type}")
    print(f"  [{label}] 실행: {' '.join(cmd)}")

    import time
    start = time.time()
    try:
        result = subprocess.run(
            cmd, cwd=root, capture_output=True, text=True, timeout=300
        )
        record["exit_code"] = result.returncode
        record["stdout"]    = result.stdout[-8000:] if len(result.stdout) > 8000 else result.stdout
        record["stderr"]    = result.stderr[-2000:] if len(result.stderr) > 2000 else result.stderr
        record["status"]    = "passed" if result.returncode == 0 else "failed"
    except subprocess.TimeoutExpired:
        record["status"] = "timeout"
        record["stderr"] = "테스트가 300초를 초과하여 중단됨"
    except FileNotFoundError as e:
        record["status"] = "error"
        record["stderr"] = f"명령을 찾을 수 없음: {e}. PATH 또는 패키지 설치 확인 필요"
    record["duration_sec"] = round(time.time() - start, 1)

    icon = "✅" if record["status"] == "passed" else "❌"
    print(f"  [{label}] {icon} {record['status']} ({record['duration_sec']}s)")
    return record

# ── 메인 ──────────────────────────────────────────────────────────────────────
env = read_env()
source_paths = get_source_paths(env)

print(f"\n[run_tests] 소스 {len(source_paths)}곳 테스트 시작\n")

results = []
for label, src_path in source_paths:
    results.append(run_tests_for(label, src_path))

# 06_소스코드/tests 도 실행 (sl-dev 생성 테스트)
gen_test = os.path.join(PROJECT_ROOT, "06_소스코드", "tests")
if os.path.isdir(gen_test) and detect_project_type(gen_test) != "unknown":
    results.append(run_tests_for("generated", gen_test))

# ── 결과 저장 ─────────────────────────────────────────────────────────────────
out_dir = os.path.join(PROJECT_ROOT, "docs", "08_테스트결과보고서")
os.makedirs(out_dir, exist_ok=True)
out_path = os.path.join(out_dir, f"test_run_{TODAY}.json")

summary = {
    "date":       TODAY,
    "total":      len(results),
    "passed":     sum(1 for r in results if r["status"] == "passed"),
    "failed":     sum(1 for r in results if r["status"] == "failed"),
    "skipped":    sum(1 for r in results if r["status"] in ("skipped", "error", "timeout")),
    "results":    results,
}
json.dump(summary, open(out_path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)

print(f"\n[run_tests] 완료: {summary['passed']}/{summary['total']} 통과")
print(f"  결과 저장: {out_path}")

# RTM 업데이트용 exit code
sys.exit(0 if summary["failed"] == 0 else 1)
