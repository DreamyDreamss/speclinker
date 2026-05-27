// STATUS: 완료
#!/usr/bin/env node
/**
 * UA 코어 자동 빌드 — SessionStart 훅에서 호출
 * package.json 변경 시에만 재빌드 (매 세션 빠른 스킵)
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, "..");
const dataDir = process.env.CLAUDE_PLUGIN_DATA || path.join(require("os").homedir(), ".claude", "plugins", "data", "speclinker");
const uaDir = path.join(pluginRoot, "ua");
const distFile = path.join(uaDir, "packages", "core", "dist", "index.js");
const bundledPkg = path.join(uaDir, "package.json");
const storedPkg = path.join(dataDir, "ua-package.json");

fs.mkdirSync(dataDir, { recursive: true });

function needsBuild() {
  if (!fs.existsSync(distFile)) return true;
  if (!fs.existsSync(storedPkg)) return true;
  return fs.readFileSync(bundledPkg, "utf8") !== fs.readFileSync(storedPkg, "utf8");
}

if (!needsBuild()) {
  console.log("[speclinker] UA 코어 최신 상태 — 빌드 스킵");
  process.exit(0);
}

console.log("[speclinker] UA 코어 빌드 시작...");
try {
  const opts = { cwd: uaDir, stdio: "inherit" };

  // pnpm 우선, 없으면 npm
  try {
    execSync("pnpm --version", { stdio: "ignore" });
    execSync("pnpm install", opts);
    execSync("pnpm --filter @understand-anything/core build", opts);
  } catch {
    execSync("npm install", opts);
    execSync("npm run build --workspace=packages/core", opts);
  }

  fs.copyFileSync(bundledPkg, storedPkg);
  console.log("[speclinker] UA 코어 빌드 완료");
} catch (err) {
  console.error("[speclinker] UA 코어 빌드 실패:", err.message);
  process.exit(1);
}
