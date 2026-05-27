# STATUS: 완료
#!/usr/bin/env python3
"""
req_scan.py — 크로스플랫폼 소스 스캔 (Windows/Mac/Linux)
linked_req: REQ-F-XXX  →  linked-req-cache.json
linked_func: FUNC-XXX  →  linked-func-cache.json

Usage: python req_scan.py [project_root]
  project_root : project.env 가 있는 디렉토리 (기본값: 현재 디렉토리)
"""

import os, sys, re, json

PROJECT_ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.getcwd()
UA_DIR       = os.path.join(PROJECT_ROOT, ".understand-anything")
os.makedirs(UA_DIR, exist_ok=True)

REQ_CACHE  = os.path.join(UA_DIR, "linked-req-cache.json")
FUNC_CACHE = os.path.join(UA_DIR, "linked-func-cache.json")

EXTS = {".java", ".kt", ".ts", ".tsx", ".js", ".jsx", ".py",
        ".go", ".cs", ".php", ".rb", ".swift", ".rs", ".vue"}
SKIP = {"node_modules", ".git", "dist", "build", "__pycache__",
        ".gradle", "target", "vendor", ".next", ".idea", ".vscode"}

REQ_PAT  = re.compile(r'linked[_\s]req\s*:\s*(REQ-[A-Z]+-\d+(?:\s*,\s*REQ-[A-Z]+-\d+)*)',  re.IGNORECASE)
FUNC_PAT = re.compile(r'linked[_\s]func\s*:\s*(FUNC-[\w-]+(?:\s*,\s*FUNC-[\w-]+)*)', re.IGNORECASE)

# ── 스캔 대상 디렉토리 결정 ────────────────────────────────────────────────────
def collect_scan_dirs() -> list[str]:
    dirs: list[str] = []

    def add(p: str):
        if os.path.isdir(p):
            dirs.append(p)

    # project.env에서 SOURCE_N_PATH 읽기
    env_path = os.path.join(PROJECT_ROOT, "project.env")
    if os.path.exists(env_path):
        env: dict[str, str] = {}
        for line in open(env_path, encoding="utf-8"):
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.strip().split("=", 1)
                env[k.strip()] = v.strip()
        count = int(env.get("SOURCE_COUNT", "0") or "0")
        for i in range(1, count + 1):
            p = env.get(f"SOURCE_{i}_PATH", "")
            if p:
                add(p)

    # 관례적 경로
    add(os.path.join(PROJECT_ROOT, "06_소스코드", "src"))
    add(os.path.join(PROJECT_ROOT, "src"))
    # 루트 바로 아래 */src
    for entry in os.scandir(PROJECT_ROOT):
        if entry.is_dir() and not entry.name.startswith("."):
            add(os.path.join(PROJECT_ROOT, entry.name, "src"))
    # apps/*/src, packages/*/src (모노레포)
    for top in ("apps", "packages"):
        top_dir = os.path.join(PROJECT_ROOT, top)
        if os.path.isdir(top_dir):
            for entry in os.scandir(top_dir):
                if entry.is_dir():
                    add(os.path.join(top_dir, entry.name, "src"))

    # 중복 제거 (os.path 정규화 기준)
    seen: set[str] = set()
    result: list[str] = []
    for d in dirs:
        norm = os.path.normcase(os.path.normpath(d))
        if norm not in seen:
            seen.add(norm)
            result.append(d)
    return result

# ── 재귀 스캔 ─────────────────────────────────────────────────────────────────
def scan_dir(base_dir: str, req_map: dict, func_map: dict, counter: list[int]):
    try:
        entries = list(os.scandir(base_dir))
    except PermissionError:
        return
    for e in entries:
        if counter[0] > 10_000:
            return
        if e.is_dir(follow_symlinks=False):
            if e.name not in SKIP:
                scan_dir(e.path, req_map, func_map, counter)
        elif e.is_file():
            _, ext = os.path.splitext(e.name)
            if ext.lower() not in EXTS:
                continue
            counter[0] += 1
            try:
                lines = open(e.path, encoding="utf-8", errors="ignore").readlines()
            except OSError:
                continue
            rel = os.path.relpath(e.path, PROJECT_ROOT).replace("\\", "/")
            for lineno, line in enumerate(lines, 1):
                for m in REQ_PAT.finditer(line):
                    ids = [x.strip() for x in m.group(1).split(",") if x.strip()]
                    for rid in ids:
                        req_map.setdefault(rel, [])
                        if rid not in req_map[rel]:
                            req_map[rel].append(rid)
                for m in FUNC_PAT.finditer(line):
                    ids = [x.strip() for x in m.group(1).split(",") if x.strip()]
                    for fid in ids:
                        func_map.setdefault(rel, [])
                        if fid not in func_map[rel]:
                            func_map[rel].append(fid)

# ── 메인 ──────────────────────────────────────────────────────────────────────
scan_dirs = collect_scan_dirs()
if not scan_dirs:
    json.dump({}, open(REQ_CACHE,  "w", encoding="utf-8"))
    json.dump({}, open(FUNC_CACHE, "w", encoding="utf-8"))
    print("req_scan: 스캔할 src 디렉토리 없음 → 빈 캐시 생성")
    sys.exit(0)

req_map: dict[str, list[str]] = {}
func_map: dict[str, list[str]] = {}
counter = [0]

for d in scan_dirs:
    scan_dir(d, req_map, func_map, counter)

json.dump(req_map,  open(REQ_CACHE,  "w", encoding="utf-8"), indent=2, ensure_ascii=False)
json.dump(func_map, open(FUNC_CACHE, "w", encoding="utf-8"), indent=2, ensure_ascii=False)

req_total  = sum(len(v) for v in req_map.values())
func_total = sum(len(v) for v in func_map.values())
print(f"req_scan 완료: {counter[0]}개 파일 스캔")
print(f"  linked_req  → {len(req_map)}개 파일, {req_total}개 REQ-ID  ({REQ_CACHE})")
print(f"  linked_func → {len(func_map)}개 파일, {func_total}개 FUNC-ID ({FUNC_CACHE})")
