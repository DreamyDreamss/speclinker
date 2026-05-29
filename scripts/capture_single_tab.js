#!/usr/bin/env node
/**
 * capture_single_tab.js — 단일 탭 방식 캡처 (메모리 안전)
 *
 * Usage:
 *   node capture_single_tab.js --url=<URL> --screenId=<id> --workspace=<dir> [--port=9222]
 *
 * 기존 iframe 누적 방식 대신 탭을 하나씩 열고 닫아 Chrome 메모리를 보호한다.
 * Chrome이 다운된 경우 자동으로 재시작을 시도한다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync, spawn } = require('child_process');
const os = require('os');

const rawArgs = process.argv.slice(2);
function arg(n, d) {
  const f = rawArgs.find(a => a.startsWith('--' + n + '='));
  return f ? f.split('=').slice(1).join('=') : d;
}

const PORT      = arg('port', '9222');
const URL_ARG   = arg('url', '');
const SCREEN_ID = arg('screenId', '');
const WORKSPACE = path.resolve(arg('workspace', process.cwd()));
const TAB_INDEX = arg('tab', '');   // e.g. --tab=2 clicks a[href="#tab2"] before screenshot
const MAX_HEIGHT = parseInt(arg('maxHeight', '8000'), 10);
const OUT_DIR   = path.join(WORKSPACE, '_tmp', 'captures', SCREEN_ID);

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

async function restartChrome() {
  console.error('[capture_single_tab] Chrome down — restarting...');

  // Kill existing Chrome
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

  const env = parseProjectEnv();
  const baseUrl = env.PREVIEW_BASE_URL || 'about:blank';

  spawn(chromeBin, [
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + debugProfile,
    baseUrl,
  ], { detached: true, stdio: 'ignore' }).unref();

  // Wait up to 15s for Chrome to start
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    if (await isChromeAlive()) {
      console.error('[capture_single_tab] Chrome restarted successfully');
      return true;
    }
  }
  return false;
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
            }, 15000);
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

const WIDGET_EXPR = `(function() {
  const SELS = ['button:not([disabled])','a[href]','input','select','textarea','[onclick]','.btn'];
  const seen = new Set();
  const res = [];
  let seq = 1;
  for (const sel of SELS) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width < 5 || r.height < 5 || r.top < 0) continue;
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

(async () => {
  // Check Chrome, restart if needed
  if (!(await isChromeAlive())) {
    const ok = await restartChrome();
    if (!ok) {
      console.log(JSON.stringify({ error: 'Chrome could not be started', hint: 'Start Chrome manually with --remote-debugging-port=' + PORT }));
      process.exit(1);
    }
    await sleep(1500);
  }

  const versionData = JSON.parse(await httpGet('http://localhost:' + PORT + '/json/version'));
  const browserWsUrl = versionData.webSocketDebuggerUrl;
  const browser = await createCdpClient(browserWsUrl);

  // Create new tab
  const newTarget = await browser.send('Target.createTarget', { url: URL_ARG });
  await sleep(500);

  const freshTabs = JSON.parse(await httpGet('http://localhost:' + PORT + '/json'));
  const newTab = freshTabs.find(t => t.id === newTarget.targetId);
  if (!newTab || !newTab.webSocketDebuggerUrl) {
    console.log(JSON.stringify({ error: 'Tab WS URL not found', screenId: SCREEN_ID }));
    browser.close();
    process.exit(1);
  }

  const tabCdp = await createCdpClient(newTab.webSocketDebuggerUrl);
  await tabCdp.send('Page.enable').catch(() => {});
  await tabCdp.send('Runtime.enable').catch(() => {});

  // Initial viewport at standard size — let jwork calculate natural layout
  await tabCdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false
  }).catch(() => {});

  // Wait for load
  await new Promise(resolve => {
    const t = setTimeout(resolve, 8000);
    tabCdp.on('Page.loadEventFired', () => { clearTimeout(t); resolve(); });
    tabCdp.on('Page.domContentEventFired', () => { clearTimeout(t); setTimeout(resolve, 1500); });
  });
  await sleep(1500);

  // Check URL
  const { result: urlResult } = await tabCdp.send('Runtime.evaluate', { expression: 'location.href' }).catch(() => ({ result: { value: '' } }));
  const currentUrl = urlResult.value || '';
  if (currentUrl.includes('login') || currentUrl.includes('signin')) {
    browser.send('Target.closeTarget', { targetId: newTarget.targetId }).catch(() => {});
    console.log(JSON.stringify({ error: 'login redirect', url: currentUrl, screenId: SCREEN_ID }));
    tabCdp.close();
    browser.close();
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Click specific tab if --tab=N supplied, then unlock that tab's overflow:hidden
  if (TAB_INDEX) {
    const tabSelector = `a[href="#tab${TAB_INDEX}"]`;
    await tabCdp.send('Runtime.evaluate', {
      expression: `(function(){var el=document.querySelector('${tabSelector}');if(el){el.click();return true;}return false;})()`
    }).catch(() => {});
    await sleep(900);

    // Unlock the active tab container and all overflow:hidden ancestors
    await tabCdp.send('Runtime.evaluate', {
      expression: `(function(){
        var tab = document.querySelector('#tab${TAB_INDEX}');
        if(!tab) return;
        // Unlock tab itself
        tab.style.overflow  = 'visible';
        tab.style.overflowY = 'visible';
        tab.style.height    = 'auto';
        tab.style.maxHeight = 'none';
        // Unlock overflow:hidden ancestors up to body
        var el = tab.parentElement;
        while(el && el !== document.body) {
          var cs = window.getComputedStyle(el);
          if(cs.overflow === 'hidden' || cs.overflowY === 'hidden' || cs.overflowY === 'scroll' || cs.overflowY === 'auto') {
            el.style.overflow  = 'visible';
            el.style.overflowY = 'visible';
            el.style.height    = 'auto';
            el.style.maxHeight = 'none';
          }
          el = el.parentElement;
        }
      })()`
    }).catch(() => {});
    await sleep(400);
  }

  // Measure true content height
  const tabSel = TAB_INDEX ? `#tab${TAB_INDEX}` : null;
  const heightR = await tabCdp.send('Runtime.evaluate', {
    expression: `(function(){
      // 1. If specific tab: use that tab's internal scrollHeight (ignores overflow:hidden clipping)
      ${tabSel ? `
      var tabEl = document.querySelector('${tabSel}');
      if(tabEl) {
        // Force measure: temporarily remove height constraint
        var origH = tabEl.style.height;
        var origOv = tabEl.style.overflow;
        tabEl.style.height = 'auto';
        tabEl.style.overflow = 'visible';
        var sh = tabEl.scrollHeight;
        tabEl.style.height = origH;
        tabEl.style.overflow = origOv;
        // Tab top offset (distance from page top to tab container)
        var tabTop = tabEl.getBoundingClientRect().top;
        if(sh > 100) return Math.min(tabTop + sh + 80, ${MAX_HEIGHT});
      }` : ''}
      // 2. Fallback: max getBoundingClientRect bottom of content elements
      var maxB = 0;
      document.querySelectorAll('input,select,textarea,button,th,td,label,h1,h2,h3,h4,h5').forEach(function(el){
        if(el.offsetWidth < 5 || el.offsetHeight < 5) return;
        var r = el.getBoundingClientRect();
        if(r.bottom > maxB) maxB = r.bottom;
      });
      if(maxB < 200) maxB = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 900);
      return Math.min(maxB + 80, ${MAX_HEIGHT});
    })()`
  }).catch(() => ({ result: { value: 1080 } }));
  const captureH = Math.max(Math.round(heightR.result.value || 1080), 900);

  // Resize viewport to exact content height so screenshot has no blank bottom
  await tabCdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1920, height: captureH, deviceScaleFactor: 1, mobile: false
  }).catch(() => {});
  await sleep(300);

  const { data } = await tabCdp.send('Page.captureScreenshot', { format: 'png' });
  const imgBuf = Buffer.from(data, 'base64');
  const outPng = path.join(OUT_DIR, 'preview.png');
  fs.writeFileSync(outPng, imgBuf);

  // Widgets
  const { result: wResult } = await tabCdp.send('Runtime.evaluate', { expression: WIDGET_EXPR }).catch(() => ({ result: { value: '[]' } }));
  const widgets = JSON.parse(wResult.value || '[]');
  fs.writeFileSync(path.join(OUT_DIR, 'preview_widgets.json'), JSON.stringify(widgets, null, 2));

  // Close tab
  await browser.send('Target.closeTarget', { targetId: newTarget.targetId }).catch(() => {});
  tabCdp.close();
  browser.close();

  const activeRoute = URL_ARG.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  console.log(JSON.stringify({
    command: 'capture',
    screenId: SCREEN_ID,
    activeRoute,
    tabIndex: TAB_INDEX || null,
    captureHeight: captureH,
    captureDir: OUT_DIR,
    captureFile: outPng,
    widgetCount: widgets.length,
    success: true,
  }));
  process.exit(0);
})().catch(e => {
  console.log(JSON.stringify({ error: e.message, screenId: SCREEN_ID }));
  process.exit(1);
});
