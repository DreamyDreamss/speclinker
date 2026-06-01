#!/usr/bin/env node
/**
 * detect_capture_strategy.js — BFS/UIS 캡처 전략 자동 탐지
 *
 * Usage:
 *   node detect_capture_strategy.js [--workspace=.] [--port=9222] [--force]
 *
 * Output: _tmp/capture_config.json
 *
 * 탐지 우선순위:
 *   1. SPA 프레임워크 (package.json) → strategy: spa
 *   2. Spring MVC + iframe 패턴 (WEB-INF + JSP) → strategy: shell-iframe
 *   3. 실행 중인 Chrome CDP 프로브 → 탐지 보강
 *   4. 기본값 → strategy: mpa
 *
 * capture_config.json의 strategy 값을 직접 수정해 결과를 오버라이드할 수 있습니다.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const http = require('http');

// ── Strategy 기본 프로파일 ────────────────────────────────────────────────────

const STRATEGY_PROFILES = {
  'shell-iframe': {
    strategy: 'shell-iframe',
    description: 'Shell+iframe 앱 (jwork, Spring MVC 등 메인 쉘 + content iframe 구조)',
    shellUrlKeywords: ['/main/', 'index.do', 'main.do'],
    navigationMethod: 'iframe.src',
    contentIframeMethod: 'largest-by-area',
    iframeMinArea: 40000,
    initWaitMs: 8000,
    tabSelector: 'a[href="#tab{N}"]',
    tabWaitMs: 2500,
    authCheckPatterns: ['login', 'signin'],
    playwright: {
      overflowUnlock: true,
      heightMeasure: true,
      viewportWidth: 1920,
      maxHeight: 8000,
    },
  },
  'spa': {
    strategy: 'spa',
    description: 'Single Page Application (React, Vue, Angular, Next.js 등)',
    navigationMethod: 'page.goto',
    waitUntil: 'networkidle',
    initWaitMs: 3000,
    tabSelector: null,
    tabWaitMs: 1500,
    authCheckPatterns: ['login', 'signin', '/auth/'],
    playwright: {
      overflowUnlock: true,
      heightMeasure: true,
      viewportWidth: 1920,
      maxHeight: 8000,
    },
  },
  'mpa': {
    strategy: 'mpa',
    description: 'Multi-page application (전통적인 서버 렌더링, Django, Rails, Flask 등)',
    navigationMethod: 'page.goto',
    waitUntil: 'load',
    initWaitMs: 2000,
    tabSelector: null,
    tabWaitMs: 1000,
    authCheckPatterns: ['login', 'signin'],
    playwright: {
      overflowUnlock: false,
      heightMeasure: true,
      viewportWidth: 1920,
      maxHeight: 8000,
    },
  },
};

const SPA_PACKAGES = [
  'react', 'react-dom', 'vue', '@vue/core', 'angular', '@angular/core',
  'next', 'nuxt', 'svelte', '@sveltejs/kit', 'solid-js', '@solidjs/core',
  'astro', 'remix', '@remix-run/react',
];

const rawArgs = process.argv.slice(2);
function arg(n, d) {
  const f = rawArgs.find(a => a.startsWith('--' + n + '='));
  return f ? f.split('=').slice(1).join('=') : d;
}
const WORKSPACE = path.resolve(arg('workspace', process.cwd()));
const PORT      = arg('port', '9222');
const FORCE     = rawArgs.includes('--force');

// ── 소스 기반 탐지 ───────────────────────────────────────────────────────────

function detectFromSource(workspace) {
  const score = { spa: 0, shellIframe: 0, java: 0 };
  const notes = [];

  // 1. SPA 프레임워크 (package.json)
  const pkgPath = path.join(workspace, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
      const matched = deps.filter(d => SPA_PACKAGES.some(s => d === s || d.startsWith(s + '/')));
      if (matched.length) {
        score.spa += 5;
        notes.push('SPA 패키지: ' + matched.slice(0, 3).join(', '));
      }
    } catch (_) {}
  }

  // 2. Java 빌드 파일
  if (fs.existsSync(path.join(workspace, 'pom.xml'))) {
    score.java += 3; notes.push('pom.xml 발견');
  }
  if (fs.existsSync(path.join(workspace, 'build.gradle')) ||
      fs.existsSync(path.join(workspace, 'build.gradle.kts'))) {
    score.java += 2; notes.push('build.gradle 발견');
  }

  // 3. project.env에서 소스 경로 추출
  const envPath = path.join(workspace, 'project.env');
  let sourcePaths = [workspace];
  if (fs.existsSync(envPath)) {
    try {
      const env = Object.fromEntries(
        fs.readFileSync(envPath, 'utf-8').split('\n')
          .filter(l => l.includes('=') && !l.startsWith('#'))
          .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()]; })
      );
      const count = parseInt(env.SOURCE_COUNT || '1', 10);
      const paths = [];
      for (let i = 1; i <= count; i++) {
        const p = env[`SOURCE_${i}_PATH`];
        if (p && fs.existsSync(p)) paths.push(p);
      }
      if (paths.length) sourcePaths = paths;
    } catch (_) {}
  }

  // 4. WEB-INF 디렉토리 탐색 (최대 depth 5)
  function hasWebInf(dir, depth) {
    if (depth > 5) return false;
    try {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        if (e.name === 'WEB-INF') return true;
        if (['node_modules', '.git', 'target', 'build', 'dist', '.gradle'].includes(e.name)) continue;
        if (hasWebInf(path.join(dir, e.name), depth + 1)) return true;
      }
    } catch (_) {}
    return false;
  }

  for (const src of sourcePaths) {
    if (hasWebInf(src, 0)) {
      score.shellIframe += 4; notes.push('WEB-INF 구조 발견 (Spring MVC)'); break;
    }
  }

  // 5. iframe을 포함한 JSP 탐색 (최대 depth 7, 파일 100개)
  let jspScanned = 0;
  function hasJspWithIframe(dir, depth) {
    if (depth > 7 || jspScanned > 100) return false;
    try {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isFile() && e.name.endsWith('.jsp')) {
          jspScanned++;
          const snippet = fs.readFileSync(path.join(dir, e.name), 'utf-8').slice(0, 8000);
          if (/<iframe/i.test(snippet)) return true;
        }
        if (e.isDirectory() && !['node_modules', '.git', 'target', 'build'].includes(e.name)) {
          if (hasJspWithIframe(path.join(dir, e.name), depth + 1)) return true;
        }
      }
    } catch (_) {}
    return false;
  }

  for (const src of sourcePaths) {
    if (hasJspWithIframe(src, 0)) {
      score.shellIframe += 3; notes.push('JSP에서 <iframe> 패턴 발견'); break;
    }
  }

  return { score, notes };
}

// ── CDP 라이브 프로브 ────────────────────────────────────────────────────────

function cdpProbe(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/json`, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const tabs = JSON.parse(data);
          const pages = tabs.filter(t => t.type === 'page');
          const mainPage =
            pages.find(t => t.url && /\/main\/|index\.do|main\.do/i.test(t.url)) ||
            pages[0];
          resolve({ alive: true, pageCount: pages.length, mainUrl: mainPage?.url || '' });
        } catch (_) { resolve({ alive: false }); }
      });
    });
    req.on('error', () => resolve({ alive: false }));
    req.setTimeout(2000, () => { req.destroy(); resolve({ alive: false }); });
  });
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

async function main() {
  const outPath = path.join(WORKSPACE, '_tmp', 'capture_config.json');
  fs.mkdirSync(path.join(WORKSPACE, '_tmp'), { recursive: true });

  // 기존 config가 있고 --force 없으면 재사용
  if (fs.existsSync(outPath) && !FORCE) {
    const existing = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
    if (!existing._detectedBy) {
      // 이전 세대 수동 생성 파일 — 덮어쓰지 않음
      console.log(`[캡처 전략] 기존 config 유지: strategy=${existing.strategy}`);
      return;
    }
    console.log(`[캡처 전략] 기존 탐지 결과 재사용: strategy=${existing.strategy}`);
    console.log(`  재탐지: --force 옵션 사용`);
    return;
  }

  console.log('[캡처 전략 탐지] 시작...');

  const { score, notes } = detectFromSource(WORKSPACE);
  console.log(`  소스 신호 — spa:${score.spa} shell-iframe:${score.shellIframe} java:${score.java}`);
  notes.forEach(n => console.log(`    · ${n}`));

  // CDP 프로브 (실행 중인 Chrome 확인)
  const probe = await cdpProbe(PORT);
  const cdpNotes = [];
  if (probe.alive) {
    const isShellUrl = /\/main\/|index\.do|main\.do/i.test(probe.mainUrl || '');
    if (isShellUrl) {
      score.shellIframe += 3;
      cdpNotes.push(`CDP 쉘 URL 감지: ${probe.mainUrl.slice(0, 60)}`);
    } else if (probe.mainUrl) {
      cdpNotes.push(`CDP 앱 URL: ${probe.mainUrl.slice(0, 60)}`);
    }
    cdpNotes.forEach(n => console.log(`    · ${n}`));
  }

  // 전략 결정
  let strategyKey;
  if (score.spa >= 5) {
    strategyKey = 'spa';
  } else if (score.shellIframe >= 4) {
    strategyKey = 'shell-iframe';
  } else if (score.java >= 3) {
    // Java지만 iframe 미확인 → mpa가 safer default
    strategyKey = 'mpa';
  } else {
    strategyKey = 'mpa';
  }

  const config = {
    ...STRATEGY_PROFILES[strategyKey],
    _detectedAt: new Date().toISOString(),
    _detectedBy: 'detect_capture_strategy.js',
    _signals: { score, sourceNotes: notes, cdpNotes },
    _editHint: 'strategy를 직접 수정해 전략을 변경할 수 있습니다: shell-iframe | spa | mpa',
  };

  fs.writeFileSync(outPath, JSON.stringify(config, null, 2));

  console.log(`\n  [결과] strategy = ${strategyKey}`);
  if (score.shellIframe > 0 && strategyKey !== 'shell-iframe') {
    console.log(`  ※ shell-iframe 신호가 일부 감지됐지만 점수 미달 (${score.shellIframe}<4)`);
    console.log(`    실제로 shell-iframe 앱이라면 capture_config.json의 strategy를 수정하세요.`);
  }
  console.log(`  → _tmp/capture_config.json 저장 완료`);
}

main().catch(e => { console.error('[detect_capture_strategy]', e.message); process.exit(1); });
