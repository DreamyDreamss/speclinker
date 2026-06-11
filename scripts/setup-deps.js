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
 *   4. DB MCP deps      (pip)  — project.env MCP_DB_*=true 선언 시: mcp·sqlalchemy·pandas·dotenv + 드라이버(oracledb/pymysql/ibm_db)
 *   4b. uv(uvx)         (pip)  — project.env MCP_JIRA/MCP_WIKI=true 선언 시: Atlassian MCP 실행기(`uvx mcp-atlassian`)
 *
 * ※ 자동화 안 되는 항목(설계상): Python·Node 본체(전제), DB 접속 creds/.mcp.json(보안), DB2 IBM CLI Driver(네이티브), 인터넷.
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

// ── 0. PLUGIN_PATH 자가 치유 (업데이트 내성) ──────────────────────────────────
// project.env의 PLUGIN_PATH가 비었거나(미설정) 더 이상 존재하지 않는 경로
// (플러그인 업데이트로 옛 버전 캐시 폴더가 삭제됨)면 → 현재 설치 경로(PLUGIN_ROOT)로 갱신.
// 유효한 경로(개발용 로컬 경로 포함)는 건드리지 않는다 — dev override 존중.
// SessionStart 훅은 현재 설치 버전의 setup-deps.js가 실행되므로 PLUGIN_ROOT가 항상 최신이다.
(function selfHealPluginPath() {
  const candidates = [
    process.env.CLAUDE_PROJECT_DIR ? path.join(process.env.CLAUDE_PROJECT_DIR, 'project.env') : null,
    path.join(process.cwd(), 'project.env'),
  ].filter(Boolean);
  const envFile = candidates.find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } });
  if (!envFile) return;                          // 프로젝트 미초기화 — 스킵
  let text;
  try { text = fs.readFileSync(envFile, 'utf-8'); } catch (_) { return; }

  const m = text.match(/^[ \t]*PLUGIN_PATH[ \t]*=[ \t]*(.+?)[ \t]*$/m);
  const cur = m ? m[1] : undefined;
  const valid = !!cur && (() => { try { return fs.existsSync(cur); } catch (_) { return false; } })();
  if (valid) return;                             // 유효(로컬 dev 포함) — 존중, 변경 안 함

  const fresh = PLUGIN_ROOT.replace(/\\/g, '/');
  const next = (cur === undefined)
    ? text.replace(/\n?$/, '\n') + 'PLUGIN_PATH=' + fresh + '\n'        // 키 없음 → 추가
    : text.replace(/^[ \t]*PLUGIN_PATH[ \t]*=.*$/m, 'PLUGIN_PATH=' + fresh);  // stale → 교체
  try {
    fs.writeFileSync(envFile, next, 'utf-8');
    log('PLUGIN_PATH 자가치유: ' + (cur || '(없음)') + ' → ' + fresh);
  } catch (e) {
    log('[WARN] PLUGIN_PATH 자가치유 실패: ' + e.message);
  }
})();

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
  const jira   = flag('MCP_JIRA');
  const wiki   = flag('MCP_WIKI');
  const wantDB = oracle || db2 || maria;
  if (!(wantDB || jira || wiki)) return;       // MCP 전혀 미사용 — 스킵

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

  // 4a. DB MCP(내장 python 서버) 드라이버
  if (wantDB) {
    ensure('core', ['mcp', 'sqlalchemy', 'pandas', 'dotenv'], '"mcp[cli]" sqlalchemy pandas python-dotenv');
    if (oracle) ensure('oracle', ['oracledb'], 'oracledb');
    if (maria)  ensure('mysql/mariadb', ['pymysql'], 'pymysql');
    if (db2)    ensure('db2', ['ibm_db'], 'ibm_db ibm_db_sa');  // ※ IBM CLI Driver 별도 필요할 수 있음
  }

  // 4b. Atlassian(Jira/Confluence) MCP = `uvx mcp-atlassian` → uv 실행기 자동 설치.
  // (mcp-atlassian 패키지 자체는 uvx가 첫 실행 시 자동 다운로드 — pip 불필요.)
  if (jira || wiki) {
    let hasUvx = false;
    try { hasUvx = spawnSync('uvx', ['--version'], { encoding: 'utf-8', timeout: 5000 }).status === 0; } catch (_) {}
    if (!hasUvx) {
      try { hasUvx = spawnSync('uv', ['--version'], { encoding: 'utf-8', timeout: 5000 }).status === 0; } catch (_) {}
    }
    if (hasUvx) {
      log('uv/uvx OK (Atlassian MCP, skip)');
    } else {
      log('Atlassian MCP용 uv(uvx) 설치 중...');
      try {
        execSync(`${pyCmd} -m pip install --quiet uv`, { stdio: 'inherit', timeout: 120000 });
        log('uv 설치 완료 — uvx mcp-atlassian 사용 가능(패키지는 첫 실행 시 자동 다운로드)');
      } catch (e) {
        log('[WARN] uv 설치 실패: ' + e.message);
        log('       수동: ' + pyCmd + ' -m pip install uv');
      }
    }
  }
})();

// ── 5. 전역 MCP 안정화 (버전 캐시 경로 → 고정 경로) ────────────────────────────
// ~/.claude.json(user scope)에 등록된 내장 DB MCP 서버 경로가 버전 캐시(.../speclinker/<ver>/mcp-servers/..)를
// 가리키면 /plugin update로 옛 캐시가 지워질 때 깨진다. mcp-servers/*.py를 **버전 무관 고정 경로**
// (~/.claude/speclinker-mcp/)로 복사·갱신하고, ~/.claude.json의 stale 버전경로를 그 고정 경로로 self-heal한다.
// → 한 번 고정경로로 등록되면 이후 update가 경로를 깨지 않는다(내용만 매 세션 갱신).
(function stabilizeGlobalMcp() {
  const os = require('os');
  const SRC = path.join(PLUGIN_ROOT, 'mcp-servers');
  if (!fs.existsSync(SRC)) return;
  const STABLE = path.join(os.homedir(), '.claude', 'speclinker-mcp');

  // 5-1. 서버 *.py 고정 경로로 복사·갱신 (내용 다를 때만)
  let copied = 0;
  try {
    fs.mkdirSync(STABLE, { recursive: true });
    for (const f of fs.readdirSync(SRC).filter((x) => x.endsWith('.py'))) {
      const sBuf = fs.readFileSync(path.join(SRC, f));
      const dst = path.join(STABLE, f);
      let same = false;
      try { same = fs.readFileSync(dst).equals(sBuf); } catch (_) {}
      if (!same) { fs.writeFileSync(dst, sBuf); copied++; }
    }
  } catch (e) { log('[WARN] 전역 MCP 서버 복사 실패: ' + e.message); return; }
  if (copied) log('전역 MCP 서버 갱신: ' + copied + '개 → ' + STABLE);

  // 5-2. ~/.claude.json self-heal: 버전 캐시 경로 → 고정 경로 (안전 쓰기)
  const cfgPath = path.join(os.homedir(), '.claude.json');
  if (!fs.existsSync(cfgPath)) return;
  let raw, cfg;
  try { raw = fs.readFileSync(cfgPath, 'utf-8'); cfg = JSON.parse(raw); }
  catch (_) { return; }                          // 파싱 불가 — 건드리지 않음
  if (!cfg.mcpServers || typeof cfg.mcpServers !== 'object') return;
  const reVerCache = /speclinker[\\/]+speclinker[\\/]+[^\\/]+[\\/]+mcp-servers[\\/]+([\w.-]+\.py)$/i;
  let healed = 0;
  for (const name of Object.keys(cfg.mcpServers)) {
    const srv = cfg.mcpServers[name];
    if (!srv || !Array.isArray(srv.args)) continue;
    for (let i = 0; i < srv.args.length; i++) {
      const a = srv.args[i];
      if (typeof a !== 'string') continue;
      const m = a.match(reVerCache);
      if (m) {
        const fixed = path.join(STABLE, m[1]);
        if (a !== fixed && fs.existsSync(fixed)) { srv.args[i] = fixed; healed++; }
      }
    }
  }
  if (!healed) return;
  try {
    const out = JSON.stringify(cfg, null, 2);
    JSON.parse(out);                             // 직렬화 결과 재검증(파손 방지)
    try { fs.writeFileSync(cfgPath + '.speclinker-bak', raw); } catch (_) {}   // 1회 백업
    fs.writeFileSync(cfgPath + '.tmp', out);
    fs.renameSync(cfgPath + '.tmp', cfgPath);    // 원자적 교체
    log('전역 MCP 경로 self-heal: ' + healed + '건 → 고정 경로(' + STABLE + ')');
  } catch (e) { log('[WARN] ~/.claude.json self-heal 실패(미변경): ' + e.message); }
})();
