#!/usr/bin/env node
// STATUS: 완료
/**
 * UA 코어 준비 — SessionStart 훅에서 호출
 *
 * dist/ 는 git에 커밋된 상태라 재컴파일 불필요.
 * tree-sitter-* 등 네이티브 런타임 deps는 OS마다 바이너리가 달라
 * 반드시 npm/pnpm install이 필요하다.
 *
 * 로직:
 *   1. node_modules 없으면 → pnpm install (런타임 deps 설치)
 *   2. dist/index.js 없으면 → pnpm build (보험, 일반적으로는 불필요)
 *   3. 둘 다 있으면 → skip
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
const uaDir      = path.join(pluginRoot, 'ua');
const nmDir      = path.join(uaDir, 'node_modules');
const distFile   = path.join(uaDir, 'packages', 'core', 'dist', 'index.js');

// pnpm | npm 감지
function pkgManager() {
  try { execSync('pnpm --version', { stdio: 'ignore' }); return 'pnpm'; } catch (_) {}
  return 'npm';
}

const needsInstall = !fs.existsSync(nmDir) || fs.readdirSync(nmDir).length === 0;
const needsBuild   = !fs.existsSync(distFile);

if (!needsInstall && !needsBuild) {
  console.log('[speclinker] UA 준비 완료 (skip)');
  process.exit(0);
}

const pm   = pkgManager();
const opts = { cwd: uaDir, stdio: 'inherit' };

if (needsInstall) {
  console.log('[speclinker] UA 런타임 deps 설치 중 (tree-sitter 등)...');
  try {
    execSync(`${pm} install`, opts);
    console.log('[speclinker] UA deps 설치 완료');
  } catch (e) {
    console.error('[speclinker] UA deps 설치 실패:', e.message);
    process.exit(1);
  }
}

if (needsBuild) {
  // dist/ 가 없는 경우만 (fresh clone 직후 등 비정상 상황)
  console.log('[speclinker] UA dist 없음 — 빌드 실행...');
  try {
    if (pm === 'pnpm') {
      execSync('pnpm --filter @understand-anything/core build', opts);
    } else {
      execSync('npm run build --workspace=packages/core', opts);
    }
    console.log('[speclinker] UA 빌드 완료');
  } catch (e) {
    console.error('[speclinker] UA 빌드 실패:', e.message);
    process.exit(1);
  }
}
