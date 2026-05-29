#!/usr/bin/env node
// STATUS: 완료
/**
 * setup-deps.js — speclinker 의존성 자동 설치 (SessionStart)
 *
 * 처음 실행 시 설치, 이후엔 fast-skip.
 *
 * 체크 항목:
 *   1. playwright-core  (npm)  — ai_nav.js / capture.js CDP 연결
 *   2. Pillow           (pip)  — annotate_preview.py 마커 이미지 생성
 *   3. UA core          (build) — build-ua.js에 위임
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const os   = require('os');

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT
  || path.resolve(__dirname, '..');

function log(msg) {
  process.stdout.write('[speclinker] ' + msg + '\n');
}

// ── 1. playwright-core ────────────────────────────────────────────────────────
const nmPlaywright = path.join(PLUGIN_ROOT, 'node_modules', 'playwright-core');
if (!fs.existsSync(nmPlaywright)) {
  log('playwright-core 설치 중...');
  try {
    // 브라우저 바이너리 다운로드 없이 패키지만 설치
    execSync('npm install', {
      cwd: PLUGIN_ROOT,
      stdio: 'inherit',
      env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
    });
    log('playwright-core 설치 완료');
  } catch (e) {
    log('[WARN] playwright-core 설치 실패: ' + e.message);
    log('       수동: cd ' + PLUGIN_ROOT + ' && npm install');
  }
} else {
  log('playwright-core OK (skip)');
}

// ── 2. Pillow ─────────────────────────────────────────────────────────────────
const pyCmd = (function detectPython() {
  for (const cmd of ['python', 'python3', 'py']) {
    try {
      const r = spawnSync(cmd, ['--version'], { encoding: 'utf-8', timeout: 3000 });
      if (r.status === 0) return cmd;
    } catch (_) {}
  }
  return null;
})();

if (!pyCmd) {
  log('[WARN] Python을 찾을 수 없음 — Pillow 설치 스킵');
  log('       Python 3.8+ 설치 후 재실행하거나 수동으로 pip install Pillow');
} else {
  const pillow = spawnSync(pyCmd, ['-c', 'import PIL'], { encoding: 'utf-8', timeout: 5000 });
  if (pillow.status !== 0) {
    log('Pillow 설치 중...');
    try {
      execSync(`${pyCmd} -m pip install Pillow --quiet`, { stdio: 'inherit', timeout: 60000 });
      log('Pillow 설치 완료');
    } catch (e) {
      log('[WARN] Pillow 설치 실패: ' + e.message);
      log('       수동: ' + pyCmd + ' -m pip install Pillow');
    }
  } else {
    log('Pillow OK (skip)');
  }
}

// ── 3. UA core 빌드 — build-ua.js에 위임 ─────────────────────────────────────
try {
  const buildUa = path.join(PLUGIN_ROOT, 'scripts', 'build-ua.js');
  if (fs.existsSync(buildUa)) {
    // 같은 프로세스 내에서 실행 (stdio inherit)
    execSync(`node "${buildUa}"`, {
      stdio: 'inherit',
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
    });
  }
} catch (e) {
  log('[WARN] UA 빌드 실패: ' + e.message);
}
