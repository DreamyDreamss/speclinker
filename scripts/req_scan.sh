#!/bin/bash
# req_scan.sh — 소스코드 linked_req 주석 스캔 → linked-req-cache.json 생성
# 06_소스코드/src 외에 루트 src·apps/*/src·packages/*/src 도 스캔 (모노레포·웹 패키지)

set -e

PROJECT_ROOT="${1:-.}"
OUTPUT_FILE="$PROJECT_ROOT/.understand-anything/linked-req-cache.json"

mkdir -p "$PROJECT_ROOT/.understand-anything"

SCAN_DIRS=()
add_dir() {
  [ -d "$1" ] && SCAN_DIRS+=("$1")
}

add_dir "$PROJECT_ROOT/06_소스코드/src"
add_dir "$PROJECT_ROOT/src"
# 루트 바로 아래 여러 시스템 구성요소 (예: api/src, web/src, batch/src, nkshop-kdi-api/…)
if [ -d "$PROJECT_ROOT" ]; then
  for d in "$PROJECT_ROOT"/*/src; do
    [ -d "$d" ] && SCAN_DIRS+=("$d")
  done
fi
if [ -d "$PROJECT_ROOT/apps" ]; then
  for d in "$PROJECT_ROOT/apps"/*/src; do
    [ -d "$d" ] && SCAN_DIRS+=("$d")
  done
fi
if [ -d "$PROJECT_ROOT/packages" ]; then
  for d in "$PROJECT_ROOT/packages"/*/src; do
    [ -d "$d" ] && SCAN_DIRS+=("$d")
  done
fi

if [ ${#SCAN_DIRS[@]} -eq 0 ]; then
  echo "{}" > "$OUTPUT_FILE"
  echo "req_scan: 스캔할 src 디렉터리 없음 (06_소스코드/src, src, */src, apps/*/src, packages/*/src) → 빈 캐시"
  exit 0
fi

TMPFILE=$(mktemp)

grep -r "linked_req:" "${SCAN_DIRS[@]}" \
  --include="*.java" --include="*.py" --include="*.ts" \
  --include="*.tsx" --include="*.js" --include="*.jsx" \
  --include="*.go" --include="*.cs" --include="*.vue" \
  -l 2>/dev/null | while IFS= read -r line; do
    if command -v cygpath &>/dev/null; then
      cygpath -w "$line"
    else
      echo "$line"
    fi
  done > "$TMPFILE" || true

if command -v cygpath &>/dev/null; then
  WIN_PROJECT_ROOT=$(cygpath -w "$PROJECT_ROOT")
  WIN_OUTPUT_FILE=$(cygpath -w "$OUTPUT_FILE")
else
  WIN_PROJECT_ROOT="$PROJECT_ROOT"
  WIN_OUTPUT_FILE="$OUTPUT_FILE"
fi

python3 - "$TMPFILE" "$WIN_PROJECT_ROOT" "$WIN_OUTPUT_FILE" << 'PYEOF'
import sys, json, re, os

filelist_path, project_root, output_path = sys.argv[1:]
pattern = re.compile(r'linked_req:\s*(REQ-[A-Z]+-\d+(?:\s*,\s*REQ-[A-Z]+-\d+)*)')
result = {}

with open(filelist_path) as f:
  files = [l.strip() for l in f if l.strip()]

for filepath in files:
  try:
    with open(filepath, encoding='utf-8', errors='ignore') as f:
      content = f.read()
  except OSError as e:
    print(f"  경고: {filepath} 열기 실패 — {e}", file=sys.stderr)
    continue
  matches = pattern.findall(content)
  if matches:
    req_ids = []
    for m in matches:
      req_ids.extend([r.strip() for r in m.split(',')])
    rel = os.path.relpath(filepath, project_root).replace('\\', '/')
    result[rel] = list(dict.fromkeys(req_ids))

with open(output_path, 'w') as f:
  json.dump(result, f, indent=2, ensure_ascii=False)

total = sum(len(v) for v in result.values())
print(f"req_scan 완료: {len(result)}개 파일, {total}개 linked_req 매핑 → {output_path}")
PYEOF

rm -f "$TMPFILE"
