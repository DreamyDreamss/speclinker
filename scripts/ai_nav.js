#!/usr/bin/env node
// STATUS: 완료
/**
 * ai_nav.js — Claude 세션 주도 브라우저 탐색 도구
 *
 * Claude가 세션에서 직접 호출하며 판단한다.
 * 이 스크립트는 DOM 조작 / 스크린샷만 수행하고 JSON을 stdout으로 반환한다.
 *
 * Usage:
 *   node ai_nav.js [--port=9222] [--workspace=<dir>] [--out=<dir>] <command> [arg]
 *
 * Commands:
 *   snapshot              현재 페이지 탐색 가능 요소 → JSON stdout
 *   click <text|#sel>     요소 클릭 후 snapshot 반환
 *   goto <url>            URL 이동 후 snapshot 반환
 *   capture [screenId]    스크린샷 + 위젯 저장 → 파일 경로 반환
 *   status                URL + 제목만 반환 (빠른 확인)
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── CLI ──────────────────────────────────────────────────────────────────────
const rawArgs = process.argv.slice(2);
function arg(n, d) {
  const f = rawArgs.find(a => a.startsWith('--' + n + '='));
  return f ? f.split('=').slice(1).join('=') : d;
}

const PORT      = arg('port', '9222');
const WORKSPACE = path.resolve(arg('workspace', process.cwd()));
const OUT_DIR   = path.resolve(arg('out', path.join(WORKSPACE, '_tmp')));

const posArgs = rawArgs.filter(a => !a.startsWith('--'));
const COMMAND = (posArgs[0] || 'snapshot').toLowerCase();
// Strip surrounding quotes from arg (shell may or may not strip them)
const CMD_ARG = posArgs.slice(1).join(' ').replace(/^["']|["']$/g, '').trim();

fs.mkdirSync(OUT_DIR, { recursive: true });

// ── 유틸 ─────────────────────────────────────────────────────────────────────
function normRoute(url) {
  try {
    const u = new URL(url);
    return u.pathname + (u.search || '');
  } catch (_) { return url; }
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

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ── content frame 탐색 ────────────────────────────────────────────────────────
async function findContentFrame(page) {
  const iframes = await page.locator('iframe').all();
  if (iframes.length === 0) return null;
  let best = null, bestArea = 0;
  for (const ifEl of iframes) {
    const box = await ifEl.boundingBox().catch(() => null);
    if (!box) continue;
    const area = box.width * box.height;
    if (area > bestArea) {
      bestArea = area;
      const src  = (await ifEl.getAttribute('src').catch(() => '')) || '';
      const key  = src.split('/').pop().split('?')[0];
      const found = page.frames().find(f =>
        key ? f.url().includes(key) : f !== page.mainFrame()
      ) || null;
      if (found) best = found;
    }
  }
  return best;
}

// ── 탐색 가능 요소 추출 (모든 frame 검색) ────────────────────────────────────
async function extractNavigables(page) {
  const allFrames = page.frames();
  let navigables  = [];

  for (const frame of allFrames) {
    const frameLabel = frame === page.mainFrame()
      ? 'main'
      : (frame.url().split('/').pop().split('?')[0] || 'iframe');

    const items = await frame.evaluate(() => {
      // nav 컨테이너 찾기 (heuristic: ARIA 우선 → 위치/링크밀도)
      function findNav() {
        for (const s of ['[role="navigation"]', '[role="menubar"]', '[role="tree"]', 'nav']) {
          const el = document.querySelector(s);
          if (el && el.querySelectorAll('a[href]').length >= 3) return el;
        }
        const vpW = window.innerWidth  || 1200;
        const vpH = window.innerHeight || 900;
        let best = null, bestScore = 0;
        for (const el of document.querySelectorAll('div,nav,aside,ul,section')) {
          const links = el.querySelectorAll('a[href]');
          if (links.length < 3) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 40 || r.height < 60) continue;
          if (r.top  > vpH * 0.75) continue;
          if (r.left > vpW * 0.70) continue;
          let dominated = false;
          for (const c of el.children) {
            if (c.querySelectorAll('a[href]').length >= links.length * 0.8) {
              dominated = true; break;
            }
          }
          if (dominated) continue;
          const isLeft = r.right < vpW * 0.38;
          const score  = links.length * 3
                       + (isLeft ? 60 : 0)
                       + el.querySelectorAll('ul,ol').length * 5;
          if (score > bestScore) { bestScore = score; best = el; }
        }
        return best;
      }

      const items = [];
      const nav = findNav();

      // nav 링크
      if (nav) {
        for (const a of nav.querySelectorAll('a[href]')) {
          const label = (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
          const href  = a.getAttribute('href') || '';
          if (!label) continue;
          if (/^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
          if (/logout|signout|log-out/i.test(href + label)) continue;

          // depth (li 중첩 수)
          let depth = 0, p = a.closest('li');
          while (p) { p = p.parentElement && p.parentElement.closest('li'); if (p) depth++; }

          const li = a.closest('li');
          const hasChildren = li ? li.querySelectorAll('ul li, ol li').length > 0 : false;

          items.push({ type: 'nav-link', label, href, depth, hasChildren });
        }
      }

      // 탭
      let tabFound = false;
      for (const sel of [
        '[role="tab"]', '.tab-item > a', '.tab-menu li > a',
        '.nav-tabs li > a', '[data-toggle="tab"]', '[data-bs-toggle="tab"]',
      ]) {
        const tabs = Array.from(document.querySelectorAll(sel));
        if (tabs.length < 2) continue;
        tabs.forEach((t, i) => {
          const label = (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
          if (label) items.push({ type: 'tab', label, tabIdx: i, selector: sel });
        });
        tabFound = true;
        break;
      }

      return items;
    }).catch(() => []);

    items.forEach(item => { item.frame = frameLabel; });
    navigables = navigables.concat(items);
  }

  // 중복 제거 (label + href 기준)
  const seen = new Set();
  navigables = navigables.filter(n => {
    const key = n.label + '|' + (n.href || n.selector || '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  navigables.forEach((n, i) => { n.idx = i + 1; });
  return navigables;
}

// ── snapshot ─────────────────────────────────────────────────────────────────
async function doSnapshot(page) {
  const url       = page.url();
  const route     = normRoute(url);
  const title     = await page.title().catch(() => '');
  const navigables = await extractNavigables(page);

  return {
    command:   'snapshot',
    url,
    route,
    title,
    navigables,
    stats: {
      navLinks: navigables.filter(n => n.type === 'nav-link').length,
      tabs:     navigables.filter(n => n.type === 'tab').length,
    },
  };
}

// ── click ─────────────────────────────────────────────────────────────────────
async function doClick(page, textOrSelector) {
  if (!textOrSelector) {
    return { command: 'click', success: false, error: '클릭 대상 미지정. Usage: click "메뉴명"' };
  }

  const isSel = /^[#.[]/.test(textOrSelector);
  const allFrames = page.frames();
  let clicked = false;

  for (const frame of allFrames) {
    try {
      if (isSel) {
        const cnt = await frame.locator(textOrSelector).count();
        if (cnt > 0) {
          await frame.locator(textOrSelector).first().click({ force: true, timeout: 5000 });
          clicked = true;
          break;
        }
      } else {
        // 정확 일치 먼저
        const exact = frame.locator('a, button, [role="menuitem"], [role="tab"], li > span, li > a')
          .filter({ hasText: new RegExp('^\\s*' + escRe(textOrSelector) + '\\s*$') })
          .first();
        if (await exact.count() > 0) {
          await exact.click({ force: true, timeout: 5000 });
          clicked = true;
          break;
        }
        // 포함 일치 fallback
        const contains = frame.locator('a, [role="menuitem"]')
          .filter({ hasText: textOrSelector })
          .first();
        if (await contains.count() > 0) {
          await contains.click({ force: true, timeout: 5000 });
          clicked = true;
          break;
        }
      }
    } catch (_) {}
  }

  if (!clicked) {
    return { command: 'click', success: false, error: '요소를 찾을 수 없음: ' + textOrSelector };
  }

  await page.waitForTimeout(2000);
  const snap = await doSnapshot(page);
  return { ...snap, command: 'click', clicked: textOrSelector };
}

// ── goto ──────────────────────────────────────────────────────────────────────
async function doGoto(page, url) {
  if (!url) {
    return { command: 'goto', success: false, error: 'URL 미지정. Usage: goto /경로' };
  }
  const base = (() => { try { const u = new URL(page.url()); return u.origin; } catch(_){ return ''; } })();
  const dest = url.startsWith('http') ? url : base + (url.startsWith('/') ? url : '/' + url);

  await page.goto(dest, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(e => {
    process.stderr.write('[WARN] goto: ' + e.message + '\n');
  });
  await page.waitForTimeout(1500);

  const snap = await doSnapshot(page);
  return { ...snap, command: 'goto', navigatedTo: dest };
}

// ── capture ───────────────────────────────────────────────────────────────────
async function doCapture(page, screenId, cdpSession) {
  const url   = page.url();
  const route = normRoute(url);
  const title = await page.title().catch(() => '');

  const sid = screenId
    || route.replace(/[^a-zA-Z0-9가-힣]/g, '_').replace(/^_+|_+$/g, '').slice(0, 50)
    || 'screen';

  const outDir = path.join(OUT_DIR, 'captures', sid);
  fs.mkdirSync(outDir, { recursive: true });

  // content frame 찾기 (iframe 앱 대응)
  const cf = await findContentFrame(page);

  // 전체 스크롤 높이
  const scrollH = await (cf || page).evaluate(() =>
    Math.max(document.body.scrollHeight, window.innerHeight)
  ).catch(() => 900);

  if (cdpSession) {
    await cdpSession.send('Emulation.setDeviceMetricsOverride',
      { width: 1920, height: scrollH + 200, deviceScaleFactor: 1, mobile: false }
    ).catch(() => {});
    await page.waitForTimeout(500);
  }

  const outPng = path.join(outDir, 'preview.png');

  // 스크린샷
  let imgBuf;
  if (cdpSession) {
    const r = await cdpSession.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
    imgBuf = r ? Buffer.from(r.data, 'base64') : null;
  }
  if (!imgBuf) imgBuf = await page.screenshot({ fullPage: true }).catch(() => null);
  if (imgBuf) fs.writeFileSync(outPng, imgBuf);

  // 위젯 감지
  const capFrame = cf || page;
  const { widgets } = await capFrame.evaluate(() => {
    const SELS = [
      'button:not([disabled])', 'a[href]', 'input', 'select', 'textarea',
      '[role="button"]', '[role="link"]', '[onclick]', '.btn',
    ];
    const seen = new Set();
    const results = [];
    let seq = 1;
    for (const sel of SELS) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width < 5 || r.height < 5 || r.top < 0) continue;
        const key = Math.round(r.left) + ',' + Math.round(r.top) + ',' + el.tagName;
        if (seen.has(key)) continue;
        seen.add(key);
        const label = (
          el.textContent || el.getAttribute('aria-label') ||
          el.getAttribute('placeholder') || el.getAttribute('title') || ''
        ).replace(/\s+/g, ' ').trim().slice(0, 50);
        results.push({
          number: seq++,
          bbox: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
          tag:   el.tagName.toLowerCase(),
          type:  el.getAttribute('type') || '',
          label,
        });
      }
    }
    return { widgets: results };
  }).catch(() => ({ widgets: [] }));

  const widgetsPath = outPng.replace('.png', '_widgets.json');
  fs.writeFileSync(widgetsPath, JSON.stringify(widgets, null, 2));

  // annotate_preview.py (있으면 실행)
  const env = parseProjectEnv();
  const annotate = path.join(env.PLUGIN_PATH || '', 'scripts', 'annotate_preview.py');
  if (fs.existsSync(annotate)) {
    try {
      execSync(
        'python "' + annotate + '" "' + outPng + '" "' + widgetsPath + '"',
        { stdio: 'pipe', cwd: WORKSPACE }
      );
    } catch (_) {}
  }

  return {
    command:     'capture',
    screenId:    sid,
    url,
    route,
    title,
    captureFile: path.relative(WORKSPACE, outPng).replace(/\\/g, '/'),
    captureDir:  path.relative(WORKSPACE, outDir).replace(/\\/g, '/'),
    widgetCount: widgets.length,
    success:     !!imgBuf,
  };
}

// ── status ────────────────────────────────────────────────────────────────────
async function doStatus(page) {
  return {
    command: 'status',
    url:     page.url(),
    route:   normRoute(page.url()),
    title:   await page.title().catch(() => ''),
  };
}

// ── main ──────────────────────────────────────────────────────────────────────
(async () => {
  let chromium;
  try {
    chromium = require('playwright').chromium;
  } catch (_) {
    try {
      chromium = require('playwright-core').chromium;
    } catch (_2) {
      process.stdout.write(JSON.stringify({ error: 'playwright 미설치. npm install playwright 실행 후 재시도' }) + '\n');
      process.exit(1);
    }
  }

  let browser;
  try {
    browser = await chromium.connectOverCDP('http://localhost:' + PORT);
  } catch (e) {
    process.stdout.write(JSON.stringify({
      error: 'CDP 연결 실패: ' + e.message,
      hint:  'Chrome을 --remote-debugging-port=' + PORT + ' 로 실행하고 로그인 완료 후 재시도',
    }) + '\n');
    process.exit(1);
  }

  const context    = browser.contexts()[0];
  const page       = context.pages()[0];
  const cdpSession = await context.newCDPSession(page).catch(() => null);

  let result;
  try {
    switch (COMMAND) {
      case 'snapshot': result = await doSnapshot(page);                     break;
      case 'click':    result = await doClick(page, CMD_ARG);               break;
      case 'goto':     result = await doGoto(page, CMD_ARG);                break;
      case 'capture':  result = await doCapture(page, CMD_ARG, cdpSession); break;
      case 'status':   result = await doStatus(page);                       break;
      default:
        result = { error: '알 수 없는 명령: ' + COMMAND, usage: 'snapshot | click <text> | goto <url> | capture [screenId] | status' };
    }
  } catch (e) {
    result = { error: e.message, command: COMMAND };
  }

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');

  await browser.close();
  process.exit(0);
})();
