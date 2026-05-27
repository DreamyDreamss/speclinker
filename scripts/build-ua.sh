# STATUS: 완료
#!/usr/bin/env bash
# UA 코어 자동 빌드 — package.json 변경 시에만 재빌드
# SessionStart 훅에서 ${CLAUDE_PLUGIN_ROOT}/scripts/build-ua.sh 로 호출됨

set -e

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
DATA_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data/speclinker}"
UA_DIR="$PLUGIN_ROOT/ua"
DIST_FILE="$UA_DIR/packages/core/dist/index.js"
BUNDLED_PKG="$UA_DIR/package.json"
STORED_PKG="$DATA_DIR/ua-package.json"

mkdir -p "$DATA_DIR"

# dist가 없거나 package.json이 바뀐 경우에만 빌드
if [ ! -f "$DIST_FILE" ] || ! diff -q "$BUNDLED_PKG" "$STORED_PKG" > /dev/null 2>&1; then
  echo "[speclinker] UA 코어 빌드 시작..."
  cd "$UA_DIR"

  # pnpm 없으면 npm으로 fallback
  if command -v pnpm &> /dev/null; then
    pnpm install --frozen-lockfile 2>/dev/null || pnpm install
    pnpm --filter @understand-anything/core build
  else
    npm install
    npm run build --workspace=packages/core
  fi

  cp "$BUNDLED_PKG" "$STORED_PKG"
  echo "[speclinker] UA 코어 빌드 완료"
else
  echo "[speclinker] UA 코어 최신 상태 — 빌드 스킵"
fi
