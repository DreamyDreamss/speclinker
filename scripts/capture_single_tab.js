#!/usr/bin/env node
/**
 * capture_single_tab.js — 전략 기반 캡처 (capture_config.json 구동)
 *
 * Usage:
 *   node capture_single_tab.js --url=<URL> --screenId=<id> --workspace=<dir> [--port=9222]
 *
 * 전략 선택 (읽기: _tmp/capture_config.json):
 *   shell-iframe — jwork/Spring MVC 쉘 + content iframe 구조
 *                  Phase 1: raw CDP로 iframe.src 변경
 *                  Phase 2: Playwright iframeEl.screenshot()
 *   spa          — React/Vue/Angular 등 SPA
 *                  Playwright page.goto() + fullPage screenshot
 *   mpa          — 전통적 서버 렌더링 (Django, Rails, Spring MVC 직접)
 *                  Playwright page.goto() + screenshot
 *
 * capture_config.json 생성:
 *   node detect_capture_strategy.js --workspace=.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const http = require('http');
const { execSync, spawn } = require('child_process');
const os   = require('os');

const rawArgs = process.argv.slice(2);
function arg(n, d) {
  const f = rawArgs.find(a => a.startsWith('--' + n + '='));
  return f ? f.split('=').slice(1).join('=') : d;
}

const PORT       = arg('port', '9222');
const URL_ARG    = arg('url', '');
const SCREEN_ID  = arg('screenId', '');
const WORKSPACE  = path.resolve(arg('workspace', process.cwd()));
const TAB_INDEX  = arg('tab', '');
const OUT_DIR    = path.join(WORKSPACE, '_tmp', 'captures', SCREEN_ID);

if (!URL_ARG || !SCREEN_ID) {
  console.error(JSON.stringify({ error: '--url and --screenId are required' }));
  process.exit(1);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

function isChromeAlive() {
  return new Promise(resolve => {
    http.get('http://localhost:' + PORT + '/json/version', res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { JSON.parse(d); resolve(true); } catch(_) { resolve(false); } });
    }).on('error', () => resolve(false));
  });
}

function parseProjectEnv() {
  const p = path.join(WORKSPACE, 'project.env');
  if (!fs.existsSync(p)) return {};
  return Object.fromEntries(
    fs.readFileSync(p, 'utf-8').split('\n')
      .filter(l => l.includes('=') && !l.startsWith('#'))
      .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()]; })
  );
}

// ── 캡처 전략 설정 로드 ──────────────────────────────────────────────────────

const STRATEGY_DEFAULTS = {
  'shell-iframe': {
    strategy: 'shell-iframe',
    navigationMethod: 'iframe.src',
    contentIframeMethod: 'largest-by-area',
    iframeMinArea: 40000,
    initWaitMs: 8000,
    tabSelector: 'a[href="#tab{N}"]',
    tabWaitMs: 2500,
    authCheckPatterns: ['login', 'signin'],
    playwright: { overflowUnlock: true, heightMeasure: true, viewportWidth: 1920, maxHeight: 8000 },
  },
  'spa': {
    strategy: 'spa',
    navigationMethod: 'page.goto',
    waitUntil: 'networkidle',
    initWaitMs: 3000,
    tabSelector: null,
    tabWaitMs: 1500,
    authCheckPatterns: ['login', 'signin', '/auth/'],
    playwright: { overflowUnlock: true, heightMeasure: true, viewportWidth: 1920, maxHeight: 8000 },
  },
  'mpa': {
    strategy: 'mpa',
    navigationMethod: 'page.goto',
    waitUntil: 'load',
    initWaitMs: 2000,
    tabSelector: null,
    tabWaitMs: 1000,
    authCheckPatterns: ['login', 'signin'],
    playwright: { overflowUnlock: false, heightMeasure: true, viewportWidth: 1920, maxHeight: 8000 },
  },
};

function loadCaptureConfig() {
  const configPath = path.join(WORKSPACE, '_tmp', 'capture_config.json');
  if (fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const strategy = cfg.strategy || 'shell-iframe';
      const defaults = STRATEGY_DEFAULTS[strategy] || STRATEGY_DEFAULTS['shell-iframe'];
      // config values override defaults, but nested objects are merged
      return {
        ...defaults,
        ...cfg,
        playwright: { ...defaults.playwright, ...(cfg.playwright || {}) },
      };
    } catch(_) {}
  }
  // fallback: detect from project structure
  if (fs.existsSync(path.join(WORKSPACE, 'package.json'))) {
    return STRATEGY_DEFAULTS['spa'];
  }
  return STRATEGY_DEFAULTS['shell-iframe'];
}

// ── Chrome 재시작 ────────────────────────────────────────────────────────────

async function restartChrome(baseUrl) {
  console.error('[capture_single_tab] Chrome down — restarting...');
  try {
    if (os.platform() === 'win32') execSync('taskkill /F /IM chrome.exe /T 2>nul', { stdio: 'ignore' });
    else execSync('pkill -f chrome', { stdio: 'ignore' });
  } catch(_) {}
  await sleep(2000);

  const debugProfile = path.join(os.tmpdir(), 'speclinker-chrome-debug');
  let chromeBin = '';
  if (os.platform() === 'win32') {
    const candidates = [
      path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    ];
    chromeBin = candidates.find(p => fs.existsSync(p)) || 'chrome';
  } else if (os.platform() === 'darwin') {
    chromeBin = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  } else {
    chromeBin = 'google-chrome';
  }

  const startUrl = baseUrl ? baseUrl + '/main/index.do' : 'about:blank';
  spawn(chromeBin, [
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + debugProfile,
    startUrl,
  ], { detached: true, stdio: 'ignore' }).unref();

  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    if (await isChromeAlive()) {
      console.error('[capture_single_tab] Chrome restarted successfully');
      return true;
    }
  }
  return false;
}

// ── raw CDP WebSocket 클라이언트 ─────────────────────────────────────────────

function createCdpClient(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const callbacks = new Map();
    const eventHandlers = new Map();

    ws.onopen = () => {
      const client = {
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const id = msgId++;
            callbacks.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params }));
            setTimeout(() => {
              if (callbacks.has(id)) {
                callbacks.delete(id);
                rej(new Error('CDP timeout: ' + method));
              }
            }, 25000);
          });
        },
        on(event, handler) {
          if (!eventHandlers.has(event)) eventHandlers.set(event, []);
          eventHandlers.get(event).push(handler);
        },
        close() { try { ws.close(); } catch(_) {} }
      };
      resolve(client);
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && callbacks.has(msg.id)) {
        const { res, rej } = callbacks.get(msg.id);
        callbacks.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      } else if (msg.method) {
        const handlers = eventHandlers.get(msg.method) || [];
        handlers.forEach(h => h(msg.params));
      }
    };
    ws.onerror = () => reject(new Error('WS error'));
    setTimeout(() => reject(new Error('Connection timeout')), 10000);
  });
}

// ── 위젯 추출 ────────────────────────────────────────────────────────────────

const WIDGET_EXPR = `(function() {
  const SELS = ['button:not([disabled])','a[href]','input','select','textarea','[onclick]','.btn'];
  const seen = new Set();
  const res = [];
  let seq = 1;
  for (const sel of SELS) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width < 5 || r.height < 5) continue;
      const key = Math.round(r.left)+','+Math.round(r.top)+','+el.tagName;
      if (seen.has(key)) continue;
      seen.add(key);
      const lbl = (el.textContent||el.getAttribute('aria-label')||el.getAttribute('placeholder')||'')
        .replace(/\\s+/g,' ').trim().slice(0,50);
      res.push({number:seq++,bbox:{x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)},tag:el.tagName.toLowerCase(),type:el.getAttribute('type')||'',label:lbl});
    }
  }
  return JSON.stringify(res);
})()`;

// ── 공통 Playwright 유틸리티 ─────────────────────────────────────────────────

async function measureAndExpandHeight(evalTarget, pwPage, hasIframe, maxHeight) {
  // overflow 해제
  if (evalTarget) {
    await evalTarget.evaluate(`(function(){
      var skip = new Set(['SCRIPT','STYLE','HEAD','META','LINK']);
      document.querySelectorAll('*').forEach(function(el){
        if(skip.has(el.tagName)) return;
        var cs = window.getComputedStyle(el);
        var ov = cs.overflow, ovY = cs.overflowY;
        if(ov==='hidden'||ovY==='hidden'||ovY==='scroll'||ovY==='auto'||ov==='scroll'||ov==='auto'){
          el.style.overflow='visible'; el.style.overflowY='visible'; el.style.maxHeight='none';
          var h = cs.height;
          if(h&&h!=='auto'&&parseInt(h,10)<2000){ el.style.height='auto'; }
        }
      });
    })()`).catch(() => {});
    await pwPage.waitForTimeout(500);
  }

  // 높이 측정
  let contentH = await (evalTarget || pwPage.mainFrame()).evaluate(`(function(){
    var docH=Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0);
    var maxB=0;
    document.querySelectorAll('input,select,textarea,button,th,td,label,div,form').forEach(function(el){
      if(el.offsetWidth<5||el.offsetHeight<5) return;
      var r=el.getBoundingClientRect(); if(r.bottom>maxB) maxB=r.bottom;
    });
    return Math.min(Math.max(docH,maxB+80,900),${maxHeight});
  })()`).catch(() => 1080);
  contentH = Math.max(Math.round(contentH || 1080), 900);
  return contentH;
}

// ── 전략별 캡처 함수 ─────────────────────────────────────────────────────────

// shell-iframe 전략: raw CDP iframe.src → Playwright iframeEl.screenshot()
async function captureShellIframe(cfg, envVars, pageTabs) {
  const { initWaitMs, tabSelector, tabWaitMs, authCheckPatterns, playwright: pwCfg } = cfg;
  const maxHeight = parseInt(arg('maxHeight', String(pwCfg.maxHeight || 8000)), 10);
  const baseUrl = (envVars.PREVIEW_BASE_URL || '').replace(/\/$/, '');
  const shellUrl = baseUrl ? baseUrl + '/main/index.do' : '';

  // 탭 선택: /main/ 우선 → 동일 호스트 → 첫 번째 페이지
  let shellTab = pageTabs.find(t => t.url && t.url.includes('/main/'));
  if (!shellTab && baseUrl) {
    let baseHost = '';
    try { baseHost = new URL(baseUrl).host; } catch(_) {}
    if (baseHost) {
      shellTab = pageTabs.find(t => {
        try { return new URL(t.url).host === baseHost; } catch(_) { return false; }
      });
    }
  }
  if (!shellTab) {
    shellTab = pageTabs.find(t => !t.url.startsWith('about:') && !t.url.startsWith('chrome:'));
  }
  if (!shellTab) {
    return { error: 'Cannot find browser tab. Open the app main page first.', screenId: SCREEN_ID };
  }

  // Phase 1 — raw CDP: 쉘 복원 + iframe.src 변경
  const tabCdp = await createCdpClient(shellTab.webSocketDebuggerUrl);
  await tabCdp.send('Page.enable').catch(() => {});
  await tabCdp.send('Runtime.enable').catch(() => {});

  const isAtShell = shellTab.url.includes('/main/');
  if (!isAtShell && shellUrl) {
    await tabCdp.send('Page.navigate', { url: shellUrl }).catch(() => {});
    await new Promise(resolve => {
      const t = setTimeout(resolve, 12000);
      tabCdp.on('Page.loadEventFired', () => { clearTimeout(t); setTimeout(resolve, 3000); });
    });
    await sleep(1000);
  }

  const navResult = await tabCdp.send('Runtime.evaluate', {
    expression: `(function(){
      var iframes = Array.from(document.querySelectorAll('iframe'));
      var largest = iframes.sort(function(a,b){
        var ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();
        return rb.width*rb.height-ra.width*ra.height;
      })[0];
      if(largest){ largest.src='${URL_ARG.replace(/'/g, "\\'")}'; return 'ok:'+largest.src; }
      return 'no iframe';
    })()`,
    awaitPromise: false,
  }).catch(() => ({ result: { value: 'eval-error' } }));
  console.error('[nav] iframe.src:', (navResult.result || {}).value);
  await sleep(initWaitMs);

  // 로그인 리다이렉트 확인
  const { result: urlResult } = await tabCdp.send('Runtime.evaluate', {
    expression: `(function(){var iframes=Array.from(document.querySelectorAll('iframe')).sort(function(a,b){var ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();return rb.width*rb.height-ra.width*ra.height;});return iframes.length?iframes[0].src:location.href;})()`,
  }).catch(() => ({ result: { value: '' } }));
  const currentUrl = urlResult.value || '';
  const isAuthRedirect = authCheckPatterns.some(p => currentUrl.includes(p));
  if (isAuthRedirect) {
    tabCdp.close();
    return { error: 'login redirect', url: currentUrl, screenId: SCREEN_ID };
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  tabCdp.close(); // raw CDP 세션 종료 → Playwright가 이어받음

  // Phase 2 — Playwright: iframeEl.screenshot()
  const PW_MODULE = path.join(__dirname, '..', 'node_modules', 'playwright-core');
  const { chromium } = require(PW_MODULE);
  const browser = await chromium.connectOverCDP('http://localhost:' + PORT);

  let imgBuf = null, contentH = 1080, widgets = [];

  try {
    let pwPage = null;
    for (const ctx of browser.contexts()) {
      const pages = ctx.pages();
      pwPage = pages.find(p => p.url().includes('/main/')) ||
               (baseUrl ? pages.find(p => { try { return new URL(p.url()).host === new URL(baseUrl).host; } catch(_){return false;} }) : null) ||
               pages[0];
      if (pwPage) break;
    }
    if (!pwPage) throw new Error('No Playwright page found');

    // 가장 큰 iframe 선택 (contentFrame() 사용 — URL 매칭 불필요)
    const iframes = await pwPage.$$('iframe');
    let largestIframeEl = null, largestArea = 0;
    for (const el of iframes) {
      const box = await el.boundingBox().catch(() => null);
      if (box && box.width * box.height > largestArea) {
        largestArea = box.width * box.height;
        largestIframeEl = el;
      }
    }
    const contentFrame = largestIframeEl ? await largestIframeEl.contentFrame().catch(() => null) : null;
    const evalTarget = contentFrame || pwPage.mainFrame();

    // 탭 클릭
    if (TAB_INDEX && tabSelector) {
      const sel = tabSelector.replace('{N}', TAB_INDEX);
      await evalTarget.evaluate(`(function(){var el=document.querySelector('${sel}');if(el){el.click();}})()`)
        .catch(() => {});
      await pwPage.waitForTimeout(tabWaitMs);
    }

    contentH = await measureAndExpandHeight(evalTarget, pwPage, !!contentFrame, maxHeight);

    // iframe 높이 확장 (parent page에서)
    if (contentFrame) {
      await pwPage.evaluate(`(function(h){
        var iframe=Array.from(document.querySelectorAll('iframe')).sort(function(a,b){
          var ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();
          return rb.width*rb.height-ra.width*ra.height;
        })[0];
        if(!iframe) return;
        iframe.style.height=h+'px'; iframe.style.minHeight=h+'px';
        var p=iframe.parentElement;
        while(p&&p!==document.body){
          p.style.overflow='visible'; p.style.overflowY='visible'; p.style.maxHeight='none';
          var cs=window.getComputedStyle(p);
          if(cs.height!=='auto'&&parseInt(cs.height)<h) p.style.height='auto';
          p=p.parentElement;
        }
      })(${contentH})`).catch(() => {});
    }

    await pwPage.setViewportSize({ width: pwCfg.viewportWidth || 1920, height: Math.min(contentH + 100, maxHeight) }).catch(() => {});
    await pwPage.waitForTimeout(500);

    if (contentFrame && largestIframeEl) {
      imgBuf = await largestIframeEl.screenshot({ timeout: 15000 }).catch(() => null);
    }
    if (!imgBuf) {
      imgBuf = await pwPage.screenshot({ fullPage: true, timeout: 15000 }).catch(() => null);
    }

    const widgetJson = await evalTarget.evaluate(WIDGET_EXPR).catch(() => '[]');
    widgets = JSON.parse(widgetJson || '[]');

  } finally {
    await browser.close().catch(() => {});
  }

  return { imgBuf, contentH, widgets, isIframeApp: true };
}

// spa/mpa 전략: Playwright page.goto() + fullPage screenshot
async function capturePageGoto(cfg, envVars, pageTabs) {
  const { waitUntil, initWaitMs, tabSelector, tabWaitMs, authCheckPatterns, playwright: pwCfg } = cfg;
  const maxHeight = parseInt(arg('maxHeight', String(pwCfg.maxHeight || 8000)), 10);
  const baseUrl = (envVars.PREVIEW_BASE_URL || '').replace(/\/$/, '');

  const PW_MODULE = path.join(__dirname, '..', 'node_modules', 'playwright-core');
  const { chromium } = require(PW_MODULE);
  const browser = await chromium.connectOverCDP('http://localhost:' + PORT);

  let imgBuf = null, contentH = 1080, widgets = [];

  try {
    let pwPage = null;
    for (const ctx of browser.contexts()) {
      const pages = ctx.pages();
      pwPage = (baseUrl ? pages.find(p => { try { return new URL(p.url()).host === new URL(baseUrl).host; } catch(_){return false;} }) : null) ||
               pages.find(p => !p.url().startsWith('about:') && !p.url().startsWith('chrome:')) ||
               pages[0];
      if (pwPage) break;
    }
    if (!pwPage) {
      // create a new page if none found
      const ctx = browser.contexts()[0] || await browser.newContext();
      pwPage = await ctx.newPage();
    }

    await pwPage.setViewportSize({ width: pwCfg.viewportWidth || 1920, height: 1080 });
    await pwPage.goto(URL_ARG, { waitUntil: waitUntil || 'load', timeout: 30000 }).catch(() => {});
    await pwPage.waitForTimeout(initWaitMs);

    // 로그인 리다이렉트 확인
    const currentUrl = pwPage.url();
    const isAuthRedirect = authCheckPatterns.some(p => currentUrl.includes(p));
    if (isAuthRedirect) {
      await browser.close().catch(() => {});
      return { error: 'login redirect', url: currentUrl, screenId: SCREEN_ID };
    }

    // 탭 클릭
    if (TAB_INDEX && tabSelector) {
      const sel = tabSelector.replace('{N}', TAB_INDEX);
      await pwPage.evaluate(`(function(){var el=document.querySelector('${sel}');if(el){el.click();}})()`)
        .catch(() => {});
      await pwPage.waitForTimeout(tabWaitMs);
    }

    const evalTarget = pwPage.mainFrame();
    contentH = await measureAndExpandHeight(
      pwCfg.overflowUnlock ? evalTarget : null,
      pwPage,
      false,
      maxHeight
    );

    await pwPage.setViewportSize({ width: pwCfg.viewportWidth || 1920, height: Math.min(contentH + 100, maxHeight) }).catch(() => {});
    await pwPage.waitForTimeout(300);

    imgBuf = await pwPage.screenshot({ fullPage: true, timeout: 20000 }).catch(() => null);

    const widgetJson = await evalTarget.evaluate(WIDGET_EXPR).catch(() => '[]');
    widgets = JSON.parse(widgetJson || '[]');

  } finally {
    await browser.close().catch(() => {});
  }

  return { imgBuf, contentH, widgets, isIframeApp: false };
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

(async () => {
  if (!(await isChromeAlive())) {
    const envVars = parseProjectEnv();
    const baseUrl = (envVars.PREVIEW_BASE_URL || '').replace(/\/$/, '');
    const ok = await restartChrome(baseUrl);
    if (!ok) {
      console.log(JSON.stringify({ error: 'Chrome could not be started', hint: 'Start Chrome manually with --remote-debugging-port=' + PORT }));
      process.exit(1);
    }
    await sleep(2000);
  }

  const tabs = JSON.parse(await httpGet('http://localhost:' + PORT + '/json'));
  const pageTabs = tabs.filter(t => t.type === 'page' && t.webSocketDebuggerUrl);

  if (pageTabs.length === 0) {
    console.log(JSON.stringify({ error: 'No open browser tabs.', screenId: SCREEN_ID }));
    process.exit(1);
  }

  const envVars = parseProjectEnv();
  const cfg = loadCaptureConfig();
  console.error('[capture] strategy=' + cfg.strategy + ' url=' + URL_ARG.slice(0, 80));

  fs.mkdirSync(OUT_DIR, { recursive: true });

  let result;
  if (cfg.strategy === 'shell-iframe') {
    result = await captureShellIframe(cfg, envVars, pageTabs);
  } else {
    // spa or mpa
    result = await capturePageGoto(cfg, envVars, pageTabs);
  }

  if (result.error) {
    console.log(JSON.stringify({ error: result.error, url: result.url, screenId: SCREEN_ID }));
    process.exit(1);
  }

  const { imgBuf, contentH, widgets, isIframeApp } = result;

  if (!imgBuf) {
    console.log(JSON.stringify({ error: 'Screenshot failed', screenId: SCREEN_ID }));
    process.exit(1);
  }

  const outPng = path.join(OUT_DIR, 'preview.png');
  fs.writeFileSync(outPng, imgBuf);

  const activeRoute = URL_ARG.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  console.log(JSON.stringify({
    command: 'capture',
    screenId: SCREEN_ID,
    strategy: cfg.strategy,
    activeRoute,
    tabIndex: TAB_INDEX || null,
    captureHeight: contentH,
    captureDir: OUT_DIR,
    captureFile: outPng,
    widgetCount: widgets.length,
    isIframeApp,
    success: true,
  }));
  process.exit(0);
})().catch(e => {
  console.log(JSON.stringify({ error: e.message, screenId: SCREEN_ID }));
  process.exit(1);
});
