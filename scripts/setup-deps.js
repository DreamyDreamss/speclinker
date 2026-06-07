#!/usr/bin/env node
// STATUS: 완료
/**
 * setup-deps.js — speclinker 의존성 자동 설치 (SessionStart)
 *
 * 처음 실행 시 설치, 이후엔 fast-skip.
 *
 * 체크 항목:
 *   1. playwright-core  (npm)  — capture_screen_dom.js CDP 연결
 *   2. tree-sitter      (npm)  — scan_source.js AST 파싱 (미설치 시 regex fallback)
 *   3. Pillow           (pip)  — annotate_preview.py 마커 이미지 생성
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

// ── 3. tree-sitter (선택적 — 미설치 시 scan_source.js가 regex로 fallback) ────
const nmTreeSitter = path.join(PLUGIN_ROOT, 'node_modules', 'tree-sitter');
if (!fs.existsSync(nmTreeSitter)) {
  log('tree-sitter 설치 중...');
  try {
    execSync('npm install', {
      cwd: PLUGIN_ROOT,
      stdio: 'inherit',
      env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
    });
    log('tree-sitter 설치 완료');
  } catch (e) {
    log('[WARN] tree-sitter 설치 실패 (regex fallback 사용): ' + e.message);
    log('       수동: cd ' + PLUGIN_ROOT + ' && npm install');
  }
} else {
  log('tree-sitter OK (skip)');
}

// ── 4. DB MCP 의존성 (project.env에 MCP_DB_* = true 선언 시에만) ───────────────
// /sl-init이 쓰는 MCP_DB_oracle/db2/mariadb 플래그를 보고, 선언된 DB의 드라이버 + 공통
// 코어(mcp·sqlalchemy·pandas·python-dotenv)만 설치. (등록 .mcp.json + 접속 creds는 보안상 수동.)
// DB MCP 미사용 프로젝트엔 pandas/oracledb/ibm_db를 깔지 않는다(가벼움·ibm_db 빌드실패 회피).
(function setupMcpDeps() {
  if (!pyCmd) return;
  const candidates = [
    path.join(process.cwd(), 'project.env'),
    process.env.CLAUDE_PROJECT_DIR ? path.join(process.env.CLAUDE_PROJECT_DIR, 'project.env') : null,
  ].filter(Boolean);
  const envFile = candidates.find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } });
  if (!envFile) return;                       // 프로젝트 미초기화 — 스킵
  let text = '';
  try { text = fs.readFileSync(envFile, 'utf-8'); } catch (_) { return; }
  const flag = (name) => new RegExp('^\\s*' + name + '\\s*=\\s*true\\s*$', 'im').test(text);
  const oracle = flag('MCP_DB_oracle');
  const db2    = flag('MCP_DB_db2');
  const maria  = flag('MCP_DB_mariadb') || flag('MCP_DB_mysql');
  if (!(oracle || db2 || maria)) return;      // DB MCP 미사용 — 스킵

  const pyHas = (mod) => {
    try {
      return spawnSync(pyCmd, ['-c', 'import ' + mod], { encoding: 'utf-8', timeout: 8000 }).status === 0;
    } catch (_) { return false; }
  };
  const ensure = (label, mods, pkgs) => {
    if (mods.every(pyHas)) { log('MCP deps OK (' + label + ', skip)'); return; }
    log('MCP deps 설치 중 (' + label + ')...');
    try {
      execSync(`${pyCmd} -m pip install --quiet ${pkgs}`, { stdio: 'inherit', timeout: 180000 });
      log('MCP deps 설치 완료 (' + label + ')');
    } catch (e) {
      log('[WARN] MCP deps 설치 실패 (' + label + '): ' + e.message);
      log('       수동: ' + pyCmd + ' -m pip install ' + pkgs);
    }
  };

  ensure('core', ['mcp', 'sqlalchemy', 'pandas', 'dotenv'], '"mcp[cli]" sqlalchemy pandas python-dotenv');
  if (oracle) ensure('oracle', ['oracledb'], 'oracledb');
  if (maria)  ensure('mysql/mariadb', ['pymysql'], 'pymysql');
  if (db2)    ensure('db2', ['ibm_db'], 'ibm_db ibm_db_sa');  // ※ IBM CLI Driver 별도 필요할 수 있음
})();
