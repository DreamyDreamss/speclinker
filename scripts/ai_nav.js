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
// 내부 탭 시스템 앱: 메뉴 클릭마다 새 frame이 추가되므로
// "가장 최근 navigated된 실제 URL을 가진 non-blank frame"을 반환한다.
async function findContentFrame(page) {
  const mainUrl = page.mainFrame().url();
  const allFrames = page.frames();

  // 실제 .do/.jsp/경로 URL을 가진 non-main frame만 수집
  const candidates = allFrames.filter(f => {
    if (f === page.mainFrame()) return false;
    const u = f.url();
    if (!u || u === 'about:blank' || u.startsWith('data:')) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  // 가장 마지막(최근) 추가된 frame 반환 (내부탭 시스템에서 최신 화면)
  return candidates[candidates.length - 1];
}

// ── 탐색 가능 요소 추출 (모든 frame 검색) ────────────────────────────────────
// href="#" / JavaScript onclick 전용 메뉴도 수집한다.
// 메뉴 클릭 결과(URL 변화)는 snapshot의 activeRoute로 감지한다.
async function extractNavigables(page) {
  const allFrames = page.frames();
  let navigables  = [];

  for (const frame of allFrames) {
    const frameLabel = frame === page.mainFrame()
      ? 'main'
      : (frame.url().split('/').pop().split('?')[0] || 'iframe');

    const items = await frame.evaluate(() => {
      const items = [];

      // ── 1. 전형적인 nav 컨테이너 후보 수집 ──────────────────────────────
      // href="#" 전용 JS 메뉴도 포함하기 위해 a[href] 대신 a 전체를 센다.
      function findNavContainers() {
        const candidates = [];
        const vpW = window.innerWidth  || 1280;
        const vpH = window.innerHeight || 900;

        // ARIA 우선
        for (const s of ['[role="navigation"]', '[role="menubar"]', '[role="tree"]', 'nav']) {
          for (const el of document.querySelectorAll(s)) {
            if (el.querySelectorAll('a').length >= 3) candidates.push({ el, score: 10000 });
          }
        }
        if (candidates.length) return candidates;

        // id/class 키워드 기반 (사이드메뉴, GNB 공통 패턴)
        const NAV_KW = /menu|nav|sidebar|gnb|lnb|leftmenu|sidemenu/i;
        for (const el of document.querySelectorAll('div,ul,nav,aside')) {
          const id  = el.id || '';
          const cls = (el.className && typeof el.className === 'string') ? el.className : '';
          if (!NAV_KW.test(id + ' ' + cls)) continue;
          const links = el.querySelectorAll('a');
          if (links.length < 3) continue;
          // 화면 밖(collapsed 사이드바)도 포함 — 실제 DOM 존재 여부만 확인
          let dominated = false;
          for (const c of el.children) {
            if (c.querySelectorAll('a').length >= links.length * 0.85) { dominated = true; break; }
          }
          if (dominated) continue;
          const r = el.getBoundingClientRect();
          const onScreen = r.width > 0 && r.height > 0;
          const score = links.length * 3 + (onScreen ? 100 : 0);
          candidates.push({ el, score });
        }

        // 위치 + 링크밀도 fallback (화면에 보이는 것만)
        if (!candidates.length) {
          for (const el of document.querySelectorAll('div,ul,nav,aside,section')) {
            const links = el.querySelectorAll('a');
            if (links.length < 3) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 40 || r.height < 40) continue;
            if (r.top > vpH * 0.85 || r.left > vpW * 0.75) continue;
            let dominated = false;
            for (const c of el.children) {
              if (c.querySelectorAll('a').length >= links.length * 0.85) { dominated = true; break; }
            }
            if (dominated) continue;
            const isLeft = r.right < vpW * 0.40;
            const score = links.length * 3 + (isLeft ? 80 : 0);
            candidates.push({ el, score });
          }
        }

        return candidates.sort((a, b) => b.score - a.score).slice(0, 3);
      }

      const navContainers = findNavContainers();

      // ── 2. 각 nav 컨테이너에서 링크 수집 ────────────────────────────────
      const seenInThisFrame = new Set();
      for (const { el: nav } of navContainers) {
        for (const a of nav.querySelectorAll('a')) {
          const label = (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
          const href  = a.getAttribute('href') || '';

          if (!label) continue;
          if (/logout|signout|log-out/i.test(href + label)) continue;
          // href가 완전한 외부 URL이면 제외 (mailto, tel)
          if (/^(mailto:|tel:)/i.test(href)) continue;

          const key = label + '|' + href;
          if (seenInThisFrame.has(key)) continue;
          seenInThisFrame.add(key);

          // 가시성: 실제로 보이는 요소인지 (collapsed 메뉴 내 항목은 hidden일 수 있음)
          const r = a.getBoundingClientRect();
          const visible = r.width > 0 && r.height > 0 && r.top >= -10;

          // depth (li 중첩 수)
          let depth = 0, p = a.closest('li');
          while (p) { p = p.parentElement && p.parentElement.closest('li'); if (p) depth++; }

          // hasChildren: 형제 또는 자식에 서브메뉴가 있는지
          const li = a.closest('li');
          const hasChildren = li
            ? (li.querySelectorAll('ul li, ol li').length > 0 || li.classList.toString().includes('has-child'))
            : false;

          // href가 "#"이면 JS onclick 메뉴 (clickOnly)
          const isHashOnly = href === '#' || href === '' || href.endsWith('#');
          // 실제 .do / 경로가 있는 링크
          const hasRealUrl = !isHashOnly && !/^javascript/i.test(href);

          items.push({
            type:      'nav-link',
            label,
            href:      hasRealUrl ? href : null,
            depth,
            hasChildren,
            visible,   // false = collapsed 영역 (클릭 전 불가)
            clickOnly: isHashOnly, // JS onclick 전용 메뉴
          });
        }
      }

      // ── 3. 탭 수집 ───────────────────────────────────────────────────────
      for (const sel of [
        '[role="tab"]', '.tab-item > a', '.tab-menu li > a',
        '.nav-tabs li > a', '[data-toggle="tab"]', '[data-bs-toggle="tab"]',
      ]) {
        const tabs = Array.from(document.querySelectorAll(sel));
        if (tabs.length < 2) continue;
        tabs.forEach((t, i) => {
          const label = (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
          if (label) items.push({ type: 'tab', label, tabIdx: i, selector: sel, visible: true });
        });
        break;
      }

      return items;
    }).catch(() => []);

    items.forEach(item => { item.frame = frameLabel; });
    navigables = navigables.concat(items);
  }

  // 전역 중복 제거
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
  const url        = page.url();
  const route      = normRoute(url);
  const title      = await page.title().catch(() => '');
  const navigables = await extractNavigables(page);

  // iframe 기반 앱: 콘텐츠 frame의 URL이 실제 "현재 화면" route
  const contentFrame = await findContentFrame(page);
  const contentUrl   = contentFrame ? contentFrame.url() : null;
  const contentRoute = contentUrl ? normRoute(contentUrl) : null;

  // Claude가 화면 매핑 시 사용할 "activeRoute":
  //   iframe 앱이면 contentRoute, 아니면 메인 route
  const activeRoute = contentRoute || route;

  return {
    command:   'snapshot',
    url,
    route,
    title,
    // iframe 앱 대응: 실제 콘텐츠 화면 정보
    contentUrl,
    contentRoute,
    activeRoute,          // ← 화면 매핑은 이 값으로 비교할 것
    isIframeApp: !!contentFrame,
    navigables,
    stats: {
      navLinks: navigables.filter(n => n.type === 'nav-link').length,
      tabs:     navigables.filter(n => n.type === 'tab').length,
    },
  };
}

// ── click ─────────────────────────────────────────────────────────────────────
async function doClick(page, textOrSelector, cdpSession) {
  if (!textOrSelector) {
    return { command: 'click', success: false, error: '클릭 대상 미지정. Usage: click "메뉴명"' };
  }

  // 렌더링 시 XHR/Fetch URL 수집 (화면→INF→도메인 매핑용)
  const apiHints = [];
  const env = parseProjectEnv();
  const baseUrl = env.PREVIEW_BASE_URL || '';
  const baseOrigin = baseUrl
    ? (() => { try { return new URL(baseUrl).origin; } catch (_) { return ''; } })()
    : '';

  let networkHandler = null;
  if (cdpSession) {
    try {
      await cdpSession.send('Network.enable').catch(() => {});
      networkHandler = (params) => {
        const url  = params.request && params.request.url;
        const type = params.type;  // 'XHR' | 'Fetch' | 'Document' | ...
        if (!url || (type !== 'XHR' && type !== 'Fetch')) return;
        if (baseOrigin && !url.startsWith(baseOrigin)) return;
        try {
          const p = normRoute(url);
          if (p && !apiHints.includes(p)) apiHints.push(p);
        } catch (_) {}
      };
      cdpSession.on('Network.requestWillBeSent', networkHandler);
    } catch (_) {}
  }

  const isSel = /^[#.[]/.test(textOrSelector);
  let clicked = false;

  // CSS selector 직접 지정
  if (isSel) {
    for (const frame of page.frames()) {
      try {
        const cnt = await frame.locator(textOrSelector).count();
        if (cnt > 0) {
          await frame.locator(textOrSelector).first().click({ force: true, timeout: 5000 });
          clicked = true;
          break;
        }
      } catch (_) {}
    }
  } else {
    // 텍스트 기반 클릭: 뷰포트 안에 실제로 보이는 요소 우선
    const textRe = new RegExp('^\\s*' + escRe(textOrSelector) + '\\s*$');

    // 1순위: 뷰포트 안의 visible 요소 (정확 일치)
    const visibleEl = await page.evaluate((text) => {
      const re = new RegExp('^\\s*' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$');
      const vw = window.innerWidth, vh = window.innerHeight;
      const candidates = Array.from(document.querySelectorAll('a, button, [role="menuitem"]'))
        .filter(el => {
          if (!re.test(el.textContent.trim())) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.left >= 0 && r.left < vw && r.top >= 0 && r.top < vh * 1.5;
        });
      if (!candidates.length) return null;
      const el = candidates[0];
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, textOrSelector).catch(() => null);

    if (visibleEl) {
      await page.mouse.click(visibleEl.x, visibleEl.y);
      clicked = true;
    }

    // 2순위: 전체 frame에서 force click
    if (!clicked) {
      for (const frame of page.frames()) {
        try {
          const exact = frame.locator('a, button, [role="menuitem"], li > a')
            .filter({ hasText: textRe }).first();
          if (await exact.count() > 0) {
            await exact.click({ force: true, timeout: 5000 });
            clicked = true;
            break;
          }
        } catch (_) {}
      }
    }

    // 3순위: 포함 일치
    if (!clicked) {
      for (const frame of page.frames()) {
        try {
          const contains = frame.locator('a, button, [role="menuitem"]')
            .filter({ hasText: textOrSelector }).first();
          if (await contains.count() > 0) {
            await contains.click({ force: true, timeout: 5000 });
            clicked = true;
            break;
          }
        } catch (_) {}
      }
    }
  }

  if (!clicked) {
    if (networkHandler && cdpSession) {
      try { cdpSession.off('Network.requestWillBeSent', networkHandler); } catch (_) {}
    }
    return { command: 'click', success: false, error: '요소를 찾을 수 없음: ' + textOrSelector };
  }

  // try-finally: doSnapshot() 예외 시에도 핸들러 반드시 해제
  try {
    await page.waitForTimeout(2000);
    const snap = await doSnapshot(page);
    return { ...snap, command: 'click', clicked: textOrSelector, apiHints };
  } finally {
    if (networkHandler && cdpSession) {
      try { cdpSession.off('Network.requestWillBeSent', networkHandler); } catch (_) {}
    }
  }
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

  // 이전 setDeviceMetricsOverride 잔류 제거: 항상 정상 뷰포트로 리셋 후 캡처
  // (이전 캡처에서 높이를 수천px로 올려놓으면 iframe이 css height:100vh로 함께 늘어남)
  if (cdpSession) {
    await cdpSession.send('Emulation.setDeviceMetricsOverride',
      { width: 1920, height: 900, deviceScaleFactor: 1, mobile: false }
    ).catch(() => {});
    await page.waitForTimeout(400);
  }

  const cf     = await findContentFrame(page);
  const outPng = path.join(outDir, 'preview.png');
  let imgBuf;

  if (cf) {
    // iframe 앱: iframe 엘리먼트 영역만 스크린샷 (자동 clip — body.scrollHeight 오염 없음)
    try {
      const iframeEl = await page.locator('iframe').all().then(async (els) => {
        for (const el of els) {
          const fr = await el.contentFrame().catch(() => null);
          if (fr === cf) return el;
        }
        return null;
      });
      if (iframeEl) {
        imgBuf = await iframeEl.screenshot({ timeout: 8000 }).catch(() => null);
      }
    } catch (_) {}

    // iframe 캡처 실패 시 현재 뷰포트 CDP 스크린샷 (fullPage 금지)
    if (!imgBuf && cdpSession) {
      const r = await cdpSession.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
      imgBuf = r ? Buffer.from(r.data, 'base64') : null;
    }
  } else {
    // 일반 페이지: body.scrollHeight 대신 documentElement.scrollHeight, 최대 1800px cap
    // body.scrollHeight는 collapsed 사이드바 DOM을 포함해 수천px로 부풀 수 있음
    const viewH = await page.evaluate(() =>
      window.innerHeight || document.documentElement.clientHeight || 900
    ).catch(() => 900);

    const rawScrollH = await page.evaluate(() =>
      document.documentElement.scrollHeight
    ).catch(() => viewH);

    const captureH = Math.min(Math.max(rawScrollH, viewH), 1800);

    if (cdpSession) {
      await cdpSession.send('Emulation.setDeviceMetricsOverride',
        { width: 1920, height: captureH, deviceScaleFactor: 1, mobile: false }
      ).catch(() => {});
      await page.waitForTimeout(300);

      const r = await cdpSession.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
      imgBuf = r ? Buffer.from(r.data, 'base64') : null;

      // CDP 뷰포트 복원
      await cdpSession.send('Emulation.setDeviceMetricsOverride',
        { width: 1920, height: viewH, deviceScaleFactor: 1, mobile: false }
      ).catch(() => {});
    }

    if (!imgBuf) {
      imgBuf = await page.screenshot({
        clip: { x: 0, y: 0, width: 1920, height: captureH },
      }).catch(() => null);
    }
  }

  // 최종 fallback: 뷰포트만 (fullPage 절대 사용 안 함)
  if (!imgBuf) imgBuf = await page.screenshot().catch(() => null);
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

  // annotate_preview.py (있으면 실행) — screen 디렉토리를 positional arg로 전달
  const env = parseProjectEnv();
  const annotate = path.join(env.PLUGIN_PATH || '', 'scripts', 'annotate_preview.py');
  if (fs.existsSync(annotate)) {
    try {
      const screenDir = path.dirname(outPng);
      execSync(
        'python "' + annotate + '" "' + screenDir + '"',
        { stdio: 'pipe', cwd: WORKSPACE }
      );
    } catch (_) {}
  }

  // iframe 앱 대응: 실제 화면 route를 activeRoute에 포함
  const captureContentFrame = await findContentFrame(page);
  const captureContentUrl   = captureContentFrame ? captureContentFrame.url() : null;
  const captureContentRoute = captureContentUrl ? normRoute(captureContentUrl) : null;

  return {
    command:      'capture',
    screenId:     sid,
    url,
    route,
    activeRoute:  captureContentRoute || route,  // 화면 매핑용 핵심 필드
    contentRoute: captureContentRoute,
    isIframeApp:  !!captureContentRoute,
    title,
    captureFile:  path.relative(WORKSPACE, outPng).replace(/\\/g, '/'),
    captureDir:   path.relative(WORKSPACE, outDir).replace(/\\/g, '/'),
    widgetCount:  widgets.length,
    success:      !!imgBuf,
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
      case 'click':    result = await doClick(page, CMD_ARG, cdpSession);    break;
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
