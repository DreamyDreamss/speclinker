#!/usr/bin/env node
// STATUS: 완료
/**
 * bfs_navigator.js — N-depth 메뉴 BFS 탐색 + 선택적 캡처
 *
 * 기능:
 *   - N뎁스 메뉴 계층 자동 탐색 (iframe / SPA / MPA 모두 지원)
 *   - 각 화면 내 탭 자동 감지 + 순회
 *   - 스코프 제한 (특정 L1/L2/... 경로만 탐색)
 *   - 선택적 스크린샷 캡처 + 위젯 어노테이션
 *
 * Usage:
 *   node bfs_navigator.js [options]
 *
 * Options:
 *   --port=9222          CDP 포트 (기본: 9222)
 *   --out=<dir>          출력 디렉토리 (기본: _tmp)
 *   --scope=<path>       탐색 범위, '/' 구분 (예: "상품관리" 또는 "상품관리/상품등록")
 *   --max-depth=<n>      최대 메뉴 뎁스 (기본: 6)
 *   --capture            탐색과 동시에 각 화면 캡처
 *   --workspace=<dir>    워크스페이스 루트 (기본: cwd)
 *   --frame-url=<key>    content iframe URL 키워드 (iframe 앱 자동 감지 실패 시)
 *
 * Output:
 *   {out}/screen_hierarchy.json   계층 트리 + flat 목록
 *   (--capture 시) docs/05_설계서/{domain}/UI/{screenId}/preview_*.png
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { execSync }  = require('child_process');

// ── CLI 파싱 ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(n, d) {
  const f = args.find(a => a.startsWith('--' + n + '='));
  return f ? f.split('=').slice(1).join('=') : d;
}
function flag(n) { return args.includes('--' + n); }

const PORT                = arg('port', '9222');
const OUT_DIR             = path.resolve(arg('out', '_tmp'));
const SCOPE_RAW           = arg('scope', '');
const MAX_DEPTH           = parseInt(arg('max-depth', '6'), 10);
const DO_CAPTURE          = flag('capture');
const TREE_ONLY           = flag('tree-only');    // 정적 트리 추출만, 클릭/탐색 없음
const CONFIRMED_FILE      = arg('confirmed', ''); // 확정 목록 기반 캡처 모드
const WORKSPACE           = path.resolve(arg('workspace', process.cwd()));
const FRAME_URL           = arg('frame-url', '');
const NAV_SELECTOR_OVERRIDE = arg('nav-selector', '');

fs.mkdirSync(OUT_DIR, { recursive: true });

// ── 상수 ─────────────────────────────────────────────────────────────────────

// nav 컨테이너 fallback 후보 (우선순위 순) — 휴리스틱 탐색 실패 시 사용
const FALLBACK_SELECTORS = [
  '.lnb', '#lnb', '.snb', '#snb', '.gnb', '#gnb',
  '.sidebar', '#sidebar', '.left-menu', '.side-menu',
  '.nav-menu', '.menu-wrap', '#menu-wrap', '.main-nav',
  '.aside-menu', '#asideMenu', '.left-nav', '.leftNav',
  '.navigation-menu', '#navigationMenu',
  // 한국 어드민 공통
  '#leftMenu', '#leftmenu', '#left-menu', '.left-menu-area',
  '#leftArea', '#left_area', '.lnb-wrap', '#lnbWrap',
  '#menuArea', '#menu_area', '.menu-area', '.menuArea',
  '#menuList', '#menu_list', '.menuList', '.menu-list',
  '#menuBox', '#menu_box', '#navArea', '#nav_area',
  'ul.menu', 'ul#menu', '#sideMenu', '#side_menu',
  'nav[role="navigation"]', 'aside nav',
  '[role="navigation"]', 'aside',
];

// 탭 후보 셀렉터 (우선순위 순)
const TAB_SELECTORS = [
  '[role="tab"]',
  'a[href^="#tab"]', 'a[href^="#Tab"]', 'a[href^="#TAB"]',
  '.tab-item > a', '.tab-menu > li > a', '.tabmenu > li > a',
  '.nav-tabs > li > a', '.tab-nav > li > a',
  'ul.tabs > li > a', '.tab-list > li > a',
  '.tabbable .nav a', '.tab-content-nav a',
  '[data-toggle="tab"]', '[data-bs-toggle="tab"]',
];

// 무시할 URL/이벤트 패턴
const SKIP_PATTERNS = [
  /^javascript:/i, /^#$/, /^mailto:/, /^tel:/,
  /logout/i, /signout/i, /log-out/i, /sign-out/i,
  /popup/i, /window\.open/i,
  /^https?:\/\/(?!.*localhost|.*127\.0\.0\.1)/,  // 외부 URL
];

// ── scope 파싱 ────────────────────────────────────────────────────────────────
// "상품관리/상품등록" → ['상품관리', '상품등록']
const SCOPE_PATH = SCOPE_RAW
  ? SCOPE_RAW.split('/').map(s => s.trim()).filter(Boolean)
  : [];

// ── 유틸 ─────────────────────────────────────────────────────────────────────
let _idSeq = 0;
function nextId() { return `N${String(++_idSeq).padStart(4, '0')}`; }

function normRoute(url) {
  try {
    const u = new URL(url);
    return u.pathname + (u.search ? u.search : '');
  } catch (_) { return url; }
}

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function indent(depth) { return '  '.repeat(Math.max(0, depth - 1)); }

function shouldSkip(href, onclick) {
  const combined = (href || '') + '|' + (onclick || '');
  return SKIP_PATTERNS.some(p => p.test(combined));
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

// ── 앱 타입 감지 ──────────────────────────────────────────────────────────────
async function detectAppType(page) {
  return page.evaluate(() => {
    const iframes = Array.from(document.querySelectorAll('iframe')).filter(f => {
      const r = f.getBoundingClientRect();
      return r.width > 400 && r.height > 300;
    });
    return {
      iframeCount: iframes.length,
      iframeSrcs: iframes.slice(0, 3).map(f => f.src || f.getAttribute('src') || ''),
      hasReact:   !!(window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || document.querySelector('[data-reactroot]')),
      hasVue:     !!(window.__vue_devtools_global_hook__   || document.querySelector('[data-v-app]')),
      hasAngular: !!(window.ng || document.querySelector('[ng-version]')),
    };
  }).then(info => {
    let type = 'mpa';
    if (info.iframeCount > 0) type = 'iframe';
    else if (info.hasReact || info.hasVue || info.hasAngular) type = 'spa';
    return { type, ...info };
  });
}

// ── content frame 탐색 ────────────────────────────────────────────────────────
async function findContentFrame(page) {
  const frames = page.frames();
  if (FRAME_URL) {
    return frames.find(f => f.url().includes(FRAME_URL)) || null;
  }
  // 가장 넓은 iframe을 content frame으로 판정
  const iframes = await page.locator('iframe').all();
  if (iframes.length === 0) return null;

  let best = null, bestArea = 0;
  for (const ifEl of iframes) {
    const box  = await ifEl.boundingBox().catch(() => null);
    if (!box) continue;
    const area = box.width * box.height;
    if (area > bestArea) {
      bestArea = area;
      const src = (await ifEl.getAttribute('src').catch(() => '')) || '';
      const key = src.split('/').pop().split('?')[0];
      best = frames.find(f => key ? f.url().includes(key) : f !== page.mainFrame()) || null;
    }
  }
  return best;
}

// ── 휴리스틱 nav 탐색 (CSS 클래스 무관) ──────────────────────────────────────
async function findNavByHeuristic(frame) {
  const sel = await frame.evaluate(() => {
    function bestSel(el) {
      if (el.id) return '#' + el.id;
      const cls = typeof el.className === 'string'
        ? el.className.trim().split(/\s+/)[0] : '';
      return cls ? el.tagName.toLowerCase() + '.' + CSS.escape(cls) : el.tagName.toLowerCase();
    }

    // 1순위: ARIA semantic roles
    for (const s of ['[role="navigation"]', '[role="menubar"]', '[role="tree"]', 'nav']) {
      const el = document.querySelector(s);
      if (el && el.querySelectorAll('a').length >= 3) return bestSel(el);
    }

    // 2순위: 위치 + 링크밀도 휴리스틱
    const vpW = window.innerWidth  || 1200;
    const vpH = window.innerHeight || 900;
    const scored = [];

    for (const el of document.querySelectorAll('div,nav,aside,ul,section,header')) {
      const links = el.querySelectorAll('a[href]');
      if (links.length < 3) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 60)  continue;
      if (rect.top  > vpH * 0.75) continue;      // footer 제외
      if (rect.left > vpW * 0.70) continue;      // 우측 위젯 제외

      // 직계 자식이 같은 링크 80% 이상 포함 → 더 구체적인 컨테이너가 있음
      let dominated = false;
      for (const c of el.children) {
        if (c.querySelectorAll('a[href]').length >= links.length * 0.8) {
          dominated = true; break;
        }
      }
      if (dominated) continue;

      const isLeft    = rect.right  < vpW * 0.38;
      const isTopBar  = rect.top    < 80 && rect.width > vpW * 0.5;
      const nestedUl  = el.querySelectorAll('ul,ol').length;
      const areaScore = Math.min(rect.width * rect.height / 300000, 5); // 너무 넓으면 패널티

      const score = links.length * 3
                  + (isLeft   ? 60 : 0)
                  + (isTopBar ? 25 : 0)
                  + nestedUl  *  5
                  - areaScore;

      scored.push({ sel: bestSel(el), score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.length ? scored[0].sel : null;
  }).catch(() => null);

  if (!sel) return null;
  try {
    if ((await frame.locator(sel).count()) > 0) return sel;
  } catch (_) {}
  return null;
}

// ── nav 컨테이너 탐색 ─────────────────────────────────────────────────────────
async function findNavContainer(page, contentFrame) {
  // 0. 사용자 지정 override (PREVIEW_NAV_SELECTOR → --nav-selector)
  if (NAV_SELECTOR_OVERRIDE) {
    for (const frame of page.frames()) {
      try {
        if ((await frame.locator(NAV_SELECTOR_OVERRIDE).count()) > 0) {
          console.error(`[bfs] nav override: ${NAV_SELECTOR_OVERRIDE}`);
          return { frame, sel: NAV_SELECTOR_OVERRIDE };
        }
      } catch (_) {}
    }
  }

  // 1. 모든 frame에서 휴리스틱 시도
  for (const frame of page.frames()) {
    const sel = await findNavByHeuristic(frame);
    if (sel) {
      const label = frame === page.mainFrame() ? 'main' : (frame.url().split('/').pop() || 'iframe');
      console.error(`[bfs] nav 발견 (휴리스틱): frame=${label} sel=${sel}`);
      return { frame, sel };
    }
  }

  // 2. fallback: 알려진 셀렉터 리스트
  for (const frame of page.frames()) {
    for (const sel of FALLBACK_SELECTORS) {
      try {
        if ((await frame.locator(sel).count()) > 0) {
          console.error(`[bfs] nav 발견 (fallback): sel=${sel}`);
          return { frame, sel };
        }
      } catch (_) {}
    }
  }

  return null;
}

// ── 현재 상태 스냅샷 (URL 변화 감지용) ────────────────────────────────────────
async function getState(page, cf) {
  const pu = page.url();
  // 모든 프레임 URL을 포함하여 새 iframe 추가 감지
  const allUrls = page.frames().map(f => { try { return f.url(); } catch(_) { return ''; } })
    .filter(u => u && u !== 'about:blank').sort().join('|');
  return `${pu}|${allUrls}`;
}

// ── 클릭 후 실제 컨텐츠 프레임 URL 추출 ────────────────────────────────────────
// iframe이 동적으로 교체되는 앱에서 새로 로드된 컨텐츠 프레임을 찾는다
async function getActiveContentUrl(page, cf, knownUrls) {
  const frames = page.frames();
  const mainUrl = page.url().split('#')[0];
  // knownUrls에 없던 새 URL 우선
  for (const f of [...frames].reverse()) {
    try {
      const u = f.url();
      if (!u || u === 'about:blank' || u.startsWith('about:')) continue;
      if (u.split('#')[0] === mainUrl) continue;
      if (!knownUrls.has(u)) return u;
    } catch(_) {}
  }
  // 새 URL 없으면 cf URL (기존 방식)
  return cf ? cf.url() : page.url();
}

// ── DOM에서 메뉴 트리 정적 추출 (클릭 없이) ────────────────────────────────────
// nav 컨테이너의 ul > li 계층을 재귀 분석
async function extractMenuTree(navFrame, navSel, maxD) {
  return navFrame.evaluate(({ sel, maxD }) => {
    function extractLinks(el, depth) {
      if (depth > maxD) return [];
      const items = [];

      // 직계 li, 또는 직계 a (flat nav 대응)
      const candidates = el.querySelectorAll(
        ':scope > li, :scope > ul > li, :scope > ol > li, :scope > a'
      );

      for (const child of candidates) {
        const isAnchor = child.tagName === 'A';
        const link = isAnchor
          ? child
          : (child.querySelector(':scope > a')
             || child.querySelector(':scope > span > a')
             || child.querySelector(':scope > div > a'));

        const text = ((link || child).textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        if (!text || text.length < 1) continue;

        const href    = link ? (link.getAttribute('href')    || '') : '';
        const onclick = link ? (link.getAttribute('onclick') || '') : '';

        // 서브메뉴: ul, ol, div[class*=sub|child|depth]
        const subMenuEl = isAnchor ? null : (
          child.querySelector(':scope > ul')
          || child.querySelector(':scope > ol')
          || child.querySelector(':scope > div > ul')
          || child.querySelector(':scope > div[class*="sub"]')
          || child.querySelector(':scope > div[class*="child"]')
          || child.querySelector(':scope > div[class*="depth"]')
        );

        const children = subMenuEl ? extractLinks(subMenuEl, depth + 1) : [];

        // aria / class 힌트
        const expanded = (child.getAttribute('aria-expanded')
          || (link && link.getAttribute('aria-expanded'))
          || '') === 'true';
        const active = /\bactive\b|\bon\b|\bcurrent\b/i.test(child.className || '');

        items.push({ text, href, onclick, children, expanded, active, depth });
      }
      return items;
    }

    const nav = document.querySelector(sel);
    if (!nav) return [];
    return extractLinks(nav, 1);
  }, { sel: navSel, maxD });
}

// ── scope 필터 ────────────────────────────────────────────────────────────────
function filterByScope(nodes, scopePath, depthOffset = 0) {
  if (scopePath.length === 0) return nodes;

  const want = scopePath[depthOffset]?.toLowerCase();
  if (!want) return nodes;

  return nodes.reduce((acc, node) => {
    const label = node.text.toLowerCase();
    const match = label.includes(want) || want.includes(label);

    if (!match) return acc;

    // 더 깊은 scope가 있으면 children도 필터
    const children = filterByScope(node.children || [], scopePath, depthOffset + 1);
    acc.push({ ...node, children });
    return acc;
  }, []);
}

// ── 탭 감지 ──────────────────────────────────────────────────────────────────
async function detectTabs(frame) {
  for (const sel of TAB_SELECTORS) {
    const items = await frame.locator(sel).all();
    if (items.length < 2) continue;

    const tabs = [];
    for (const item of items) {
      const text = ((await item.textContent().catch(() => '')) || '').trim();
      const href  = await item.getAttribute('href').catch(() => '');
      if (text && text.length < 40) tabs.push({ label: text, selector: sel, href: href || '' });
    }
    if (tabs.length >= 2) return tabs;
  }
  return [];
}

// ── 메뉴 클릭 경로 네비게이션 ─────────────────────────────────────────────────
// pathStack 에 따라 L1→L2→... 순서로 클릭해서 화면에 도달
async function navigateByPath(navFrame, navSel, pathStack, page) {
  for (let i = 0; i < pathStack.length; i++) {
    const label = pathStack[i];
    try {
      const loc = navFrame
        .locator(`${navSel} a, ${navSel} span, ${navSel} li`)
        .filter({ hasText: new RegExp(`^\\s*${escRe(label)}\\s*$`) })
        .first();
      await loc.click({ force: true, timeout: 4000 });
      await page.waitForTimeout(i < pathStack.length - 1 ? 500 : 2000);
    } catch (_) {
      // text-is 실패 시 contains fallback
      try {
        const loc2 = navFrame
          .locator(`${navSel} a`)
          .filter({ hasText: label })
          .first();
        await loc2.click({ force: true, timeout: 3000 });
        await page.waitForTimeout(i < pathStack.length - 1 ? 500 : 2000);
      } catch (_2) {}
    }
  }
}

// ── 단일 화면 캡처 ────────────────────────────────────────────────────────────
async function captureScreen(page, cf, screenNode, cdpSession) {
  const capFrame   = cf || page;
  const ifrHandle  = cf ? await cf.frameElement().catch(() => null) : null;
  const env        = parseProjectEnv();
  const plugin     = env.PLUGIN_PATH || '';

  // 출력 폴더: 나중에 domain_plan 으로 domain 배정되므로 일단 _tmp/captures/{screenId}
  const outDir = path.join(OUT_DIR, 'captures', screenNode.screenId);
  fs.mkdirSync(outDir, { recursive: true });

  const tabs = (screenNode.tabs || []).length > 1
    ? screenNode.tabs.map((t, i) => ({ ...t, suffix: `_tab${i + 1}_${t.label}`, skipClick: false }))
    : [{ label: 'main', suffix: '', skipClick: true }];

  let globalSeq  = 0;
  const captured = [];

  for (const tab of tabs) {
    // 탭 클릭
    if (!tab.skipClick) {
      try {
        await capFrame.locator(tab.selector)
          .filter({ hasText: new RegExp(`^\\s*${escRe(tab.label)}\\s*$`) })
          .first()
          .click({ force: true, timeout: 3000 });
        await page.waitForTimeout(1200);
      } catch (_) {}
    }

    // 스크롤 높이 측정
    const { scrollH } = await capFrame.evaluate(() => {
      let best = document.body.scrollHeight;
      for (const el of document.body.querySelectorAll('*')) {
        if (el.scrollHeight > best && el.clientHeight > 100 && el.clientWidth > 200)
          best = el.scrollHeight;
      }
      return { scrollH: best };
    }).catch(() => ({ scrollH: 900 }));

    const targetH = scrollH + 220;

    if (ifrHandle) {
      await ifrHandle.evaluate((el, h) => { el.style.height = h + 'px'; }, targetH).catch(() => {});
    }
    if (cdpSession) {
      await cdpSession.send('Emulation.setDeviceMetricsOverride',
        { width: 1920, height: targetH, deviceScaleFactor: 1, mobile: false }
      ).catch(() => {});
      await page.waitForTimeout(700);
    }

    const outPng = path.join(outDir, `preview${tab.suffix}.png`);

    // 스크린샷
    let imgBuf;
    if (cdpSession) {
      const r = await cdpSession.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
      imgBuf = r ? Buffer.from(r.data, 'base64') : null;
    }
    if (!imgBuf) {
      imgBuf = await page.screenshot({ fullPage: false }).catch(() => null);
    }
    if (!imgBuf) continue;
    fs.writeFileSync(outPng, imgBuf);

    // 위젯 자동 마킹
    const { widgets, nextSeq } = await capFrame.evaluate((startSeq) => {
      const SELS = [
        'button:not([disabled])', 'a[href]', 'input', 'select', 'textarea',
        '[role="button"]', '[role="link"]', '[role="menuitem"]',
        '[onclick]', '.btn', '.button',
      ];
      const seen = new Set();
      const results = [];
      let seq = startSeq + 1;
      for (const sel of SELS) {
        for (const el of document.querySelectorAll(sel)) {
          const r = el.getBoundingClientRect();
          if (r.width < 5 || r.height < 5 || r.top < 0) continue;
          const key = `${Math.round(r.left)},${Math.round(r.top)},${el.tagName}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const label = (
            el.textContent || el.getAttribute('aria-label') ||
            el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('value') || ''
          ).replace(/\s+/g, ' ').trim().slice(0, 50);
          results.push({
            number: seq++,
            bbox: { x: Math.round(r.left), y: Math.round(r.top),
                    w: Math.round(r.width), h: Math.round(r.height) },
            tag: el.tagName.toLowerCase(),
            type: el.getAttribute('type') || '',
            label,
          });
        }
      }
      return { widgets: results, nextSeq: seq };
    }, globalSeq).catch(() => ({ widgets: [], nextSeq: globalSeq }));

    globalSeq = nextSeq;

    const widgetsPath = outPng.replace('.png', '_widgets.json');
    fs.writeFileSync(widgetsPath, JSON.stringify(widgets, null, 2));

    // annotate_preview.py 호출
    const annotate = path.join(plugin, 'scripts', 'annotate_preview.py');
    if (fs.existsSync(annotate)) {
      try {
        execSync(
          `python "${annotate}" "${outPng}" "${widgetsPath}"`,
          { stdio: 'pipe', cwd: WORKSPACE }
        );
      } catch (_) {}
    }

    captured.push({
      tab: tab.label,
      png: path.relative(WORKSPACE, outPng).replace(/\\/g, '/'),
      widgets: widgets.length,
    });
  }

  return captured;
}

// ── 트리 순회 (재귀) ──────────────────────────────────────────────────────────
// navTree: extractMenuTree + filterByScope 결과 (정적)
// 실제 클릭은 navigateByPath 로 수행
async function traverseTree(nodes, page, cf, navFrame, navSel, ctx) {
  const { seenRoutes, flat, cdpSession } = ctx;
  const results = [];

  for (const node of nodes) {
    const pathStack = [...ctx.pathStack, node.text];
    const id = nextId();

    if (node.children && node.children.length > 0) {
      // ── 메뉴 그룹 (펼칠 수 있는 노드) ────────────────────────────────
      console.error(`${indent(pathStack.length)}▷ [${node.text}] (하위 ${node.children.length}개)`);

      // L1 클릭 (서브메뉴 펼치기)
      try {
        const loc = navFrame
          .locator(`${navSel} a, ${navSel} span`)
          .filter({ hasText: new RegExp(`^\\s*${escRe(node.text)}\\s*$`) })
          .first();
        await loc.click({ force: true, timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(400);
      } catch (_) {}

      const children = await traverseTree(node.children, page, cf, navFrame, navSel, {
        ...ctx, pathStack,
      });

      results.push({ id, label: node.text, type: 'menu-group',
                     depth: pathStack.length, path: pathStack, children });

    } else {
      // ── 리프 노드 (실제 화면) ─────────────────────────────────────────
      // href/onclick 무시 대상
      if (shouldSkip(node.href, node.onclick)) {
        console.error(`${indent(pathStack.length)}⊘ [${node.text}] 스킵 (외부/로그아웃 패턴)`);
        continue;
      }

      const stateBefore = await getState(page, cf);
      // 클릭 전 알려진 frame URL 목록 저장
      const urlsBefore = new Set(page.frames().map(f => { try { return f.url(); } catch(_) { return ''; } }).filter(Boolean));

      // 전체 경로 클릭 (L1 재펼침 포함)
      await navigateByPath(navFrame, navSel, pathStack, page);

      const stateAfter = await getState(page, cf);
      const didNavigate = stateAfter !== stateBefore;

      const currentUrl  = await getActiveContentUrl(page, cf, urlsBefore);
      const route       = normRoute(currentUrl);
      const isDuplicate = seenRoutes.has(route);

      if (didNavigate && !isDuplicate) {
        seenRoutes.add(route);

        // 탭 감지 — 동적 iframe 교체 앱: currentUrl과 일치하는 frame 우선 사용
        const activeFrame = page.frames().find(f => { try { return f.url() === currentUrl; } catch(_) { return false; } })
                            || cf || page;
        const capFrame = activeFrame;
        const tabs = await detectTabs(capFrame);

        const rawName  = route.split('/').pop().split('.')[0].replace(/[^a-zA-Z0-9]/g, '_') || id;
        const screenId = `${rawName}_${id}`;

        console.error(
          `${indent(pathStack.length)}✓ [${node.text}] ${route}` +
          (tabs.length > 0 ? ` (탭 ${tabs.length}개: ${tabs.map(t => t.label).join(', ')})` : '')
        );

        const screenNode = {
          id,
          screenId,
          label: node.text,
          type: 'screen',
          depth: pathStack.length,
          path: pathStack,
          route,
          fullUrl: currentUrl,
          tabs: tabs.map((t, i) => ({ index: i, label: t.label, selector: t.selector, captureFile: null })),
          captureStatus: 'none',
          domain: '',   // screen_inventory.py 에서 _domain_plan.json 보고 배정
        };

        if (DO_CAPTURE) {
          const captured = await captureScreen(page, activeFrame, screenNode, cdpSession);
          screenNode.captureStatus = captured.length > 0 ? 'done' : 'fail';
          screenNode.tabs = screenNode.tabs.map((t, i) => ({
            ...t, captureFile: captured[i]?.png || null,
          }));
          console.error(`${indent(pathStack.length)}  → 캡처 ${captured.length}개 파일`);
        }

        flat.push(screenNode);
        results.push(screenNode);

      } else if (isDuplicate) {
        console.error(`${indent(pathStack.length)}↩ [${node.text}] 중복 (${route})`);
        results.push({ id, label: node.text, type: 'screen-duplicate',
                       depth: pathStack.length, path: pathStack, route });
      } else {
        // 이동 없음 — onclick 분기, 팝업 등
        console.error(`${indent(pathStack.length)}− [${node.text}] 이동 없음 (href: ${node.href || '없음'})`);
        results.push({ id, label: node.text, type: 'no-navigation',
                       depth: pathStack.length, path: pathStack,
                       href: node.href, onclick: node.onclick });
      }
    }
  }

  return results;
}

// ── preActions 실행 ───────────────────────────────────────────────────────────
// confirmed.json의 각 화면에 첨부된 preActions를 순서대로 실행
// action.type: navigate | click | wait | input | scroll
async function executePreActions(page, cf, actions) {
  for (const action of (actions || [])) {
    const frame = cf || page;
    const wait  = action.wait || 800;
    try {
      switch (action.type) {
        case 'navigate': {
          const url = action.url || action.href || '';
          if (!url) break;
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => {});
          await page.waitForTimeout(action.wait || 1500);
          break;
        }
        case 'click': {
          const sel = action.selector || '';
          if (!sel || sel === 'MANUAL') {
            console.error(`  [WARN] click selector=${sel || '미지정'} → 스킵`);
            break;
          }
          await frame.locator(sel).first().click({ force: true, timeout: 6000 });
          await page.waitForTimeout(wait);
          break;
        }
        case 'wait':
          await page.waitForTimeout(action.ms || wait);
          break;
        case 'input': {
          await frame.locator(action.selector || 'input').first()
            .fill(action.value || '', { timeout: 4000 });
          await page.waitForTimeout(action.wait || 300);
          break;
        }
        case 'scroll': {
          const sel = action.selector || 'body';
          await frame.evaluate(s => {
            const el = document.querySelector(s);
            if (el) el.scrollIntoView({ block: 'center' });
          }, sel).catch(() => {});
          await page.waitForTimeout(action.wait || 400);
          break;
        }
        default:
          console.error(`  [WARN] 알 수 없는 action.type: ${action.type}`);
      }
    } catch (e) {
      console.error(`  [WARN] preAction 실패 (type=${action.type}): ${e.message}`);
    }
  }
}

// ── 확정 목록 기반 캡처 (--confirmed 모드) ────────────────────────────────────
// confirmed.json: { screens: [...], additions: [...] }
// 각 항목: { screenId, label, route, path, tabs, include, preActions, notes }
async function captureConfirmed(page, cf, navFrame, navSel, confirmedData, cdpSession) {
  const allScreens = [
    ...(confirmedData.screens   || []).filter(s => s.include !== false),
    ...(confirmedData.additions || []).filter(s => s.include !== false),
  ];

  const results = [];
  for (const screen of allScreens) {
    console.error(`\n[확정 캡처] ${screen.label}  (${screen.route || '경로 없음'})`);

    if (screen.preActions && screen.preActions.length > 0) {
      // 사용자 지정 preActions 실행
      console.error(`  → preActions ${screen.preActions.length}개 실행`);
      await executePreActions(page, cf, screen.preActions);

    } else if (screen.path && screen.path.length > 0) {
      // BFS 발견 경로로 메뉴 클릭 재현
      await navigateByPath(navFrame, navSel, screen.path, page);

    } else if (screen.route) {
      // route로 직접 이동 (SPA / 직접 URL 접근)
      const base = page.url().split('/').slice(0, 3).join('/');
      const dest = screen.route.startsWith('http') ? screen.route : base + screen.route;
      await page.goto(dest, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1200);
    }

    // 탭 감지 (additions 신규 화면은 탭 미지정일 수 있음)
    const capFrame = cf || page;
    const tabs = (screen.tabs && screen.tabs.length > 0)
      ? screen.tabs
      : await detectTabs(capFrame);

    const screenNode = {
      id:            screen.screenId,
      screenId:      screen.screenId,
      label:         screen.label,
      type:          'screen',
      depth:         (screen.path || []).length,
      path:          screen.path || [],
      route:         screen.route || normRoute(capFrame.url()),
      fullUrl:       screen.fullUrl || capFrame.url(),
      tabs:          tabs.map((t, i) => ({
        index: i, label: t.label || `탭${i+1}`, selector: t.selector || '', captureFile: null,
      })),
      captureStatus: 'none',
      domain:        screen.domain || '',
      notes:         screen.notes  || '',
    };

    const captured = await captureScreen(page, cf, screenNode, cdpSession);
    screenNode.captureStatus = captured.length > 0 ? 'done' : 'fail';
    console.error(`  → ${screenNode.captureStatus} (${captured.length}개 파일)`);
    results.push(screenNode);
  }

  return results;
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
(async () => {
  console.error(
    `[bfs_navigator] port=${PORT}  scope="${SCOPE_RAW || '(전체)'}"` +
    `  maxDepth=${MAX_DEPTH}  capture=${DO_CAPTURE}`
  );

  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://localhost:${PORT}`);
  } catch (e) {
    console.error(`[ERROR] CDP 연결 실패: ${e.message}`);
    console.error(`  Chrome을 --remote-debugging-port=${PORT} 옵션으로 실행하고 로그인 후 재시도하세요.`);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const page    = context.pages()[0];
  console.error(`[bfs] 현재 탭: ${page.url()}`);

  // project.env의 PREVIEW_BASE_URL이 있고, 현재 탭이 다른 도메인이면 자동 이동
  // (로그인은 사용자가 미리 완료한 상태여야 함)
  const env = parseProjectEnv();
  const baseUrl = env.PREVIEW_BASE_URL || '';
  if (baseUrl) {
    const currentHost = (() => { try { return new URL(page.url()).hostname; } catch(_) { return ''; } })();
    const targetHost  = (() => { try { return new URL(baseUrl).hostname; } catch(_) { return ''; } })();
    if (currentHost !== targetHost) {
      console.error(`[bfs] 현재 탭(${currentHost})이 타겟(${targetHost})과 다름 → ${baseUrl} 로 이동`);
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(e => {
        console.error(`[WARN] 자동 이동 실패: ${e.message} — 현재 탭 그대로 사용`);
      });
      await page.waitForTimeout(2000);
      console.error(`[bfs] 이동 후 탭: ${page.url()}`);
      console.error(`[주의] 로그인이 필요한 경우 Chrome 창에서 직접 로그인 후 Enter를 눌러주세요.`);
      // 사용자가 로그인할 시간을 주기 위해 대기 (로그인 페이지로 리디렉션된 경우)
      const afterUrl = page.url();
      const isLoginPage = /login|signin|auth|sso/i.test(afterUrl);
      if (isLoginPage) {
        console.error(`[bfs] 로그인 페이지 감지됨: ${afterUrl}`);
        console.error(`[bfs] Chrome 창에서 로그인 완료 후 Claude에게 "계속"이라고 말해주세요.`);
        console.error(`[bfs] (이 프로세스는 로그인 대기 없이 현재 상태로 진행합니다)`);
      }
    }
  }

  const appInfo = await detectAppType(page);
  console.error(`[bfs] 앱 타입: ${appInfo.type}  iframe 수: ${appInfo.iframeCount}`);

  const cdpSession = await context.newCDPSession(page).catch(() => null);
  const cf         = await findContentFrame(page);
  console.error(`[bfs] content frame: ${cf ? cf.url() : '(없음 — main frame 사용)'}`);

  const navContainer = await findNavContainer(page, cf);
  if (!navContainer) {
    console.error('[ERROR] nav 컨테이너를 찾을 수 없습니다.');
    console.error('  --frame-url 옵션으로 content iframe URL 키워드를 지정해 보세요.');
    await browser.close();
    process.exit(1);
  }

  const { frame: navFrame, sel: navSel } = navContainer;
  console.error(`[bfs] nav: ${navSel}  (${navFrame === page ? 'main frame' : 'content frame'})`);

  // 1. 정적 메뉴 트리 추출
  const rawTree = await extractMenuTree(navFrame, navSel, MAX_DEPTH);
  console.error(`[bfs] L1 메뉴 ${rawTree.length}개 추출 완료`);

  // 2. scope 필터
  const filteredTree = filterByScope(rawTree, SCOPE_PATH);
  const scopeMsg = SCOPE_PATH.length > 0
    ? `${SCOPE_PATH.join(' > ')} 범위로 필터됨`
    : '전체 탐색';
  console.error(`[bfs] ${scopeMsg}`);

  // 3. TREE_ONLY 모드: 정적 트리만 저장하고 종료 (클릭·탐색 없음)
  if (TREE_ONLY) {
    function countNodes(nodes) {
      return nodes.reduce((s, n) => s + 1 + countNodes(n.children || []), 0);
    }
    const output = {
      version: 2,
      generatedAt: new Date().toISOString(),
      rootUrl: page.url(),
      appType: appInfo.type,
      scope: SCOPE_RAW || null,
      maxDepth: MAX_DEPTH,
      captureMode: false,
      treeOnly: true,
      stats: {
        l1Count: rawTree.length,
        filteredL1Count: filteredTree.length,
        totalNodes: countNodes(filteredTree),
        screens: 0,
        captured: 0,
        noNavigation: 0,
        duplicate: 0,
      },
      tree: filteredTree,
      flat: [],
    };
    const outPath = path.join(OUT_DIR, 'screen_hierarchy.json');
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.error(`\n[bfs 트리 추출 완료] L1 ${rawTree.length}개 / 노드 ${output.stats.totalNodes}개`);
    console.error(`  저장: ${outPath}`);
    await browser.close();
    process.exit(0);
  }

  // 4. CONFIRMED 모드: 확정 목록 기반 캡처 후 기존 screen_hierarchy.json 업데이트
  if (CONFIRMED_FILE) {
    const confirmedPath = path.resolve(CONFIRMED_FILE);
    if (!fs.existsSync(confirmedPath)) {
      console.error(`[ERROR] confirmed 파일 없음: ${confirmedPath}`);
      await browser.close();
      process.exit(1);
    }
    const confirmedData = JSON.parse(fs.readFileSync(confirmedPath, 'utf-8'));
    const capturedResults = await captureConfirmed(page, cf, navFrame, navSel, confirmedData, cdpSession);

    // 기존 screen_hierarchy.json 업데이트 (captureStatus 반영 + additions 추가)
    const outPath = path.join(OUT_DIR, 'screen_hierarchy.json');
    const existing = fs.existsSync(outPath)
      ? JSON.parse(fs.readFileSync(outPath, 'utf-8'))
      : { version: 2, flat: [] };

    const resultMap = Object.fromEntries(capturedResults.map(r => [r.screenId, r]));
    existing.flat = existing.flat.map(s =>
      resultMap[s.screenId] ? { ...s, captureStatus: resultMap[s.screenId].captureStatus } : s
    );
    for (const r of capturedResults) {
      if (!existing.flat.find(s => s.screenId === r.screenId)) {
        existing.flat.push(r);  // additions (BFS에 없던 화면)
      }
    }
    existing.stats = {
      screens:   existing.flat.filter(s => s.type === 'screen').length,
      captured:  existing.flat.filter(s => s.captureStatus === 'done').length,
    };

    fs.writeFileSync(outPath, JSON.stringify(existing, null, 2));
    const doneCount = capturedResults.filter(r => r.captureStatus === 'done').length;
    console.error(`\n[확정 캡처 완료] ${capturedResults.length}개 처리 / ${doneCount}개 성공`);
    console.error(`  저장: ${outPath}`);
    await browser.close();
    process.exit(0);
  }

  // 5. 트리 순회 (클릭 + 선택적 캡처)
  const seenRoutes = new Set();
  const flat       = [];

  const tree = await traverseTree(filteredTree, page, cf, navFrame, navSel, {
    pathStack: [], seenRoutes, flat, cdpSession,
  });

  // 6. 결과 저장
  const screens   = flat.filter(n => n.type === 'screen');
  const captured  = flat.filter(n => n.captureStatus === 'done');
  const noNav     = flat.filter(n => n.type === 'no-navigation');
  const duplicate = flat.filter(n => n.type === 'screen-duplicate');

  const output = {
    version: 2,
    generatedAt: new Date().toISOString(),
    rootUrl: page.url(),
    appType: appInfo.type,
    scope: SCOPE_RAW || null,
    maxDepth: MAX_DEPTH,
    captureMode: DO_CAPTURE,
    stats: {
      screens: screens.length,
      captured: captured.length,
      noNavigation: noNav.length,
      duplicate: duplicate.length,
    },
    tree,
    flat,
  };

  const outPath = path.join(OUT_DIR, 'screen_hierarchy.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.error('\n[bfs 완료] ─────────────────────────────');
  console.error(`  화면:     ${screens.length}개`);
  console.error(`  캡처:     ${captured.length}개`);
  console.error(`  이동없음: ${noNav.length}개`);
  console.error(`  중복:     ${duplicate.length}개`);
  console.error(`  저장:     ${outPath}`);

  await browser.close();
  process.exit(0);
})();
