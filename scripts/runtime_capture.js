#!/usr/bin/env node
/**
 * runtime_capture.js — Playwright 기반 실제 dev/staging 서버 캡처
 *
 * 두 가지 모드:
 *   1. node runtime_capture.js --bootstrap [<workspace>]
 *      Chrome GUI 창을 띄워 사용자가 직접 로그인 → storageState.json 저장.
 *      2FA/SSO/CAPTCHA 모두 사용자가 1회만 처리.
 *
 *   2. node runtime_capture.js [<workspace>]
 *      storageState.json을 헤드리스 컨텍스트에 주입 → 인벤토리의 각 라우트 캡처.
 *      만료 감지 (로그인 페이지 리다이렉트 패턴): 임계치 초과 시 bootstrap 재실행 안내.
 *
 * 입력:
 *   project.env:
 *     PREVIEW_BASE_URL=http://localhost:3333          (필수)
 *     PREVIEW_LOGIN_URL_PATTERN=/login,/auth/signin   (선택: 만료 감지 패턴)
 *     PREVIEW_VIEWPORT=1440x900                       (선택)
 *     PREVIEW_WAIT_UNTIL=networkidle                  (선택: load|domcontentloaded|networkidle)
 *     PREVIEW_TIMEOUT_MS=30000                        (선택)
 *     PREVIEW_STORAGE_STATE=./.preview-storage.json   (선택: storageState 저장 경로)
 *
 *   _tmp/screen_inventory.json (인벤토리: route/domain/uisId/entryFile 포함)
 *
 * 출력:
 *   docs/05_설계서/{domain}/UI/{화면ID}/preview.png  (실제 화면 캡처)
 *   _tmp/runtime_capture_report.json                  (성공/실패/만료감지 로그)
 */
'use strict';

const fs   = require('fs');
const path = require('path');

// ── Playwright 의존성 체크 ──
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('━'.repeat(60));
  console.error('Playwright 미설치. 다음 1회 실행:');
  console.error('');
  console.error('  npm install --save-dev playwright');
  console.error('  npx playwright install chromium');
  console.error('');
  console.error('또는 시스템 Chrome 재사용 (가벼움):');
  console.error('  npm install --save-dev playwright-core');
  console.error('  + project.env에 PREVIEW_CHROME_PATH=<chrome.exe 경로>');
  console.error('━'.repeat(60));
  process.exit(2);
}

// ── 인자 파싱 ──
const args = process.argv.slice(2);
const isBootstrap = args.includes('--bootstrap');
const INSPECT     = args.includes('--inspect');
const wsArg = args.find(a => !a.startsWith('--')) || '.';
const WS = path.resolve(wsArg);

// ── 환경 변수 로드 ──
function loadEnv() {
  const p = path.join(WS, 'project.env');
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const ln of fs.readFileSync(p, 'utf-8').split(/\r?\n/)) {
    const t = ln.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

const env = loadEnv();
const BASE_URL = env.PREVIEW_BASE_URL;
const STORAGE_STATE = path.resolve(WS, env.PREVIEW_STORAGE_STATE || '.preview-storage.json');
const VIEWPORT = (env.PREVIEW_VIEWPORT || '1440x900').split('x').map(Number);
const WAIT_UNTIL = env.PREVIEW_WAIT_UNTIL || 'networkidle';
const TIMEOUT_MS = parseInt(env.PREVIEW_TIMEOUT_MS || '30000', 10);
const CHROME_PATH = env.PREVIEW_CHROME_PATH || '';
const LOGIN_PATTERNS = (env.PREVIEW_LOGIN_URL_PATTERN || '/login,/auth/login,/auth/signin,/sso,/account/login')
  .split(',').map(s => s.trim()).filter(Boolean);

if (!BASE_URL) {
  console.error('PREVIEW_BASE_URL 미설정. project.env에 다음 추가:');
  console.error('  PREVIEW_BASE_URL=http://localhost:3333');
  process.exit(2);
}

// ── 브라우저 launch 옵션 ──
function launchOptions(headless) {
  const opts = { headless };
  if (CHROME_PATH && fs.existsSync(CHROME_PATH)) {
    opts.executablePath = CHROME_PATH;
  }
  return opts;
}

// ── 컨텐츠 iframe 자동 선택 (jwork·SPA SPA 패턴) ──
// hint:
//   'auto'              자동 — main 아닌 frame 중 route 매칭 우선, 그 다음 가장 큰 frame
//   CSS selector string main 페이지에서 해당 selector 의 iframe 잡음
//   false / 'page'      iframe 무시
// routeHint: route 키워드 (예: '/product/prdreg/pr201Form' → 'pr201Form')
//            jwork 처럼 메뉴 클릭마다 새 frame 추가되는 패턴에서 — URL 매칭으로 진짜 화면 frame 선택
async function pickContentFrame(page, hint, routeHint) {
  if (hint && hint !== 'auto' && typeof hint === 'string' && hint.startsWith('iframe')) {
    try {
      const h = await page.locator(hint).elementHandle({ timeout: 1500 });
      if (h) return await h.contentFrame();
    } catch (_) { return null; }
  }
  // 보조 frame (download·preview 등) 제외
  const cands = page.frames().filter(f =>
    f !== page.mainFrame() &&
    !f.url().startsWith('about:') &&
    !/grid-file-download|jfile-download|arsFile|hidden|preview/i.test(f.name() || '')
  );
  if (cands.length === 0) return null;
  // 1) route 키워드 매칭 우선 — jwork 처럼 메뉴 클릭으로 새 frame 추가되는 패턴
  if (routeHint) {
    const key = routeHint.split('/').filter(Boolean).pop().replace(/\.\w+$/, '');  // 'pr201Form'
    if (key) {
      const matched = cands.find(f => f.url().toLowerCase().includes(key.toLowerCase()));
      if (matched) return matched;
    }
  }
  // 2) 가장 늦게 생성된 frame (최근 클릭으로 추가된 거) — page.frames() 순서 = 생성 순
  if (cands.length > 1) return cands[cands.length - 1];
  // 3) fallback: 가장 큰 viewport
  let best = null, bestArea = 0;
  for (const f of cands) {
    try {
      const handle = await f.frameElement();
      if (!handle) continue;
      const box = await handle.boundingBox();
      if (!box) continue;
      const area = box.width * box.height;
      if (area > bestArea) { best = f; bestArea = area; }
    } catch (_) {}
  }
  return best || cands[0];
}

// ── 만료 감지 ──
function isLoginPage(currentUrl, finalUrl) {
  // 캡처 대상 URL이 아닌 로그인 URL로 리다이렉트된 경우
  if (finalUrl && finalUrl !== currentUrl) {
    const finalPath = (() => { try { return new URL(finalUrl).pathname.toLowerCase(); } catch (_) { return ''; } })();
    for (const pat of LOGIN_PATTERNS) {
      if (finalPath.includes(pat.toLowerCase())) return true;
    }
  }
  return false;
}

// ── capture_plan.json 로드 ──
function loadCapturePlan() {
  const p = path.join(WS, '_tmp', 'capture_plan.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    console.error(`capture_plan.json 파싱 실패: ${e.message} — 기본 goto 모드 사용`);
    return null;
  }
}

// ── preActions 실행기 ──
async function executePreActions(page, actions) {
  for (const a of actions) {
    const tag = `[${a.action}]`;
    try {
      if (a.action === 'goto') {
        const target = a.url && a.url.startsWith('http') ? a.url : BASE_URL.replace(/\/$/, '') + (a.url || '');
        await page.goto(target, { waitUntil: a.waitUntil || WAIT_UNTIL, timeout: a.timeoutMs || TIMEOUT_MS });
      } else if (a.action === 'click') {
        // Phase 6.2+: force/hover 옵션 추가 (좌측 접힌 메뉴 등 visibility 문제 우회)
        await page.click(a.selector, {
          timeout: a.timeoutMs || 5000,
          force: a.force === true,
        });
      } else if (a.action === 'hover') {
        await page.hover(a.selector, { timeout: a.timeoutMs || 5000, force: a.force === true });
      } else if (a.action === 'type' || a.action === 'fill') {
        await page.fill(a.selector, a.value || '');
      } else if (a.action === 'select') {
        await page.selectOption(a.selector, a.value);
      } else if (a.action === 'wait') {
        if (a.selector) {
          await page.waitForSelector(a.selector, { timeout: a.timeoutMs || 5000, state: a.state || 'visible' });
        } else if (a.ms) {
          await page.waitForTimeout(a.ms);
        }
      } else if (a.action === 'press') {
        await page.keyboard.press(a.key);
      } else if (a.action === 'evaluate') {
        // jwork 자체 함수 호출 (예: openMenu('PR201'))
        await page.evaluate(a.script);
      } else {
        console.error(`  ⚠️  ${tag} 알 수 없는 action: ${a.action}`);
      }
    } catch (e) {
      // preAction 실패는 화면 캡처 실패로 이어지지만 명확한 사유 기록
      throw new Error(`preAction ${tag} 실패: ${e.message.slice(0, 150)}`);
    }
  }
}

// ── BOOTSTRAP 모드 (사용자 Enter 키 → storageState 저장) ──
async function bootstrap() {
  console.error('━'.repeat(60));
  console.error(`Bootstrap 모드 시작: ${BASE_URL}`);
  console.error('1. 열린 Chrome 창에서 로그인 (2FA/SSO/CAPTCHA 포함)');
  console.error('2. 메인 메뉴 1~2개 열어서 정상 접근 확인');
  console.error('3. 이 터미널에서 Enter 키를 누르면 storageState 저장 + 브라우저 종료');
  console.error('━'.repeat(60));

  const browser = await chromium.launch(launchOptions(false));
  const ctx = await browser.newContext({ viewport: { width: VIEWPORT[0], height: VIEWPORT[1] } });
  const page = await ctx.newPage();
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: TIMEOUT_MS }).catch(e => {
    console.error('초기 페이지 로드 실패 (브라우저는 열려있음):', e.message);
  });

  // Enter 키 대기 (TTY) 또는 시간 대기 (background — Bash run_in_background 등)
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    await new Promise(resolve => {
      process.stdin.once('data', resolve);
    });
    process.stdin.setRawMode(false);
    process.stdin.pause();
  } else {
    // TTY 아님 (background 실행) — BOOTSTRAP_WAIT_SEC (기본 300초) 대기 후 자동 저장
    // 사용자가 GUI Chrome에서 로그인하는 동안 카운트다운
    const wait = parseInt(process.env.BOOTSTRAP_WAIT_SEC || '300', 10);
    console.error(`[non-TTY] ${wait}초 대기 후 자동 storageState 저장 — 그동안 Chrome 창에서 로그인 완료해주세요`);
    await new Promise(r => setTimeout(r, wait * 1000));
  }

  // storageState 저장
  await ctx.storageState({ path: STORAGE_STATE });
  console.error(`storageState 저장: ${STORAGE_STATE}`);

  await browser.close();
  console.error('Bootstrap 완료. 이제 인자 없이 실행하면 자동 캡처됩니다.');
}

// ── INSPECT 헬퍼: 탭 셀렉터 탐지 (프레임워크 무관) ──
async function findTabSelector(frame) {
  // 우선순위: 명시적 role/ARIA > 공통 클래스 패턴 > 프레임워크별 > jwork
  const candidates = [
    // ARIA (React/Vue/Angular/Svelte — 모든 modern SPA)
    '[role=tab]',
    // Bootstrap 4/5
    '.nav-tabs .nav-link',
    '.nav-pills .nav-link',
    // Ant Design (React)
    '.ant-tabs-tab',
    // Element UI / Element Plus (Vue)
    '.el-tabs__item',
    // Material UI (React) — data-value 탭
    '.MuiTab-root',
    // Vuetify
    '.v-tab',
    // jwork (사내 Java Spring MVC)
    '#tabArea a',
    '.tabArea a',
    '.tab-menu a',
    '.tab-menu > li > a',
    // 범용 패턴
    '[class*="tab"] > [class*="item"]:not([style*="display:none"])',
    'ul.tabs > li > a',
    '.tab-list a',
    '.tab > ul > li > a',
    // data 속성 기반
    '[data-tab]',
    '[data-toggle=tab]',
    '[data-bs-toggle=tab]',
  ];
  for (const sel of candidates) {
    try {
      const cnt = await frame.locator(sel).count();
      if (cnt > 1) return { selector: sel, count: cnt };
    } catch (_) {}
  }
  return null;
}

// ── INSPECT 헬퍼: DOM 위젯 추출 ──
async function extractWidgetsFromFrame(frame, tabName) {
  try {
    return await frame.evaluate((tabName) => {
      const widgets = [];
      let counter = 1;
      // 공통 입력 요소 + 프레임워크별 버튼 패턴
      const sel = [
        'input:not([type=hidden])', 'select', 'textarea',
        'button', 'input[type=button]', 'input[type=submit]',
        // 링크형 버튼 (범용)
        'a.btn', 'a.button', 'a[onclick]',
        // ARIA 버튼 (React/Vue/Angular 컴포넌트)
        '[role=button]:not(button)',
        // Ant Design
        '.ant-btn', '.ant-input', '.ant-select', '.ant-checkbox-input', '.ant-radio-input',
        // Material UI
        '.MuiButton-root', '.MuiTextField-root input', '.MuiSelect-root',
        // Element UI / Plus
        '.el-button', '.el-input__inner', '.el-select',
        // Bootstrap
        '.btn:not(button)', '.form-control', '.form-select',
        // jwork
        '[class*="jbtn"]', '[class*="j-btn"]',
      ].join(',');
      document.querySelectorAll(sel).forEach(el => {
        try {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return;
          let label = '';
          if (el.labels && el.labels[0]) label = el.labels[0].textContent.trim();
          if (!label) {
            const row = el.closest('tr,li,dd,div');
            if (row) label = (row.querySelector('label,th') || {}).textContent || '';
            label = label.trim();
          }
          if (!label) label = (el.placeholder || el.textContent || el.value || '').trim();
          label = label.slice(0, 50);
          const tagLc = el.tagName.toLowerCase();
          let typeHint = 'text';
          if (tagLc === 'select') typeHint = 'select';
          else if (tagLc === 'textarea') typeHint = 'textarea';
          else if (tagLc === 'button' || tagLc === 'a') typeHint = 'button';
          else if (['button', 'submit', 'image', 'reset'].includes(el.type)) typeHint = 'button';
          else if (el.type === 'checkbox') typeHint = 'checkbox';
          else if (el.type === 'radio') typeHint = 'radio';
          else if (el.type === 'date') typeHint = 'date';
          else if (el.type === 'number') typeHint = 'number';
          else if (el.type === 'file') typeHint = 'file';
          const apiHints = [];
          if (typeHint === 'button') {
            const oc = el.getAttribute('onclick') || '';
            const urlRe = /['"](\/[^'"]*(?:list|save|delete|update|get|post|info|do|json|api)[^'"]*)['"]/gi;
            for (const m of oc.matchAll(urlRe)) apiHints.push(m[1]);
            const da = el.getAttribute('data-url') || el.getAttribute('data-action') || '';
            if (da) apiHints.push(da);
          }
          widgets.push({
            id: `WG-${String(counter).padStart(2, '0')}`,
            number: String(counter),
            tag: tagLc,
            type_hint: typeHint,
            type: el.type || '',
            name: el.name || '',
            dom_id: el.id || '',
            label,
            placeholder: el.placeholder || '',
            default_value: el.defaultValue || '',
            required: el.required || false,
            readonly: el.readOnly || false,
            disabled: el.disabled || false,
            pattern: el.pattern || '',
            maxlength: el.maxLength > 0 ? el.maxLength : null,
            bbox: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.right), Math.round(rect.bottom)],
            api_hints: apiHints,
            form_method: ((el.form && el.form.method) || '').toUpperCase(),
            condition_hints: [],
            tab: tabName,
          });
          counter++;
        } catch (_) {}
      });
      return widgets;
    }, tabName);
  } catch (e) {
    console.error(`  [inspect] extractWidgets 실패 (${tabName}): ${e.message.slice(0, 100)}`);
    return [];
  }
}

// ── CAPTURE 모드 ──
async function captureAll() {
  if (!fs.existsSync(STORAGE_STATE)) {
    console.error(`storageState 없음: ${STORAGE_STATE}`);
    console.error('먼저 다음 명령으로 1회 수동 로그인:');
    console.error(`  node ${path.basename(__filename)} --bootstrap "${WS}"`);
    process.exit(3);
  }

  const invPath = path.join(WS, '_tmp', 'screen_inventory.json');
  if (!fs.existsSync(invPath)) {
    console.error(`_tmp/screen_inventory.json 없음 — sl-recon STEP 5 먼저 실행 필요`);
    process.exit(1);
  }
  const inventory = JSON.parse(fs.readFileSync(invPath, 'utf-8'));

  const browser = await chromium.launch(launchOptions(true));
  const ctx = await browser.newContext({
    storageState: STORAGE_STATE,
    viewport: { width: VIEWPORT[0], height: VIEWPORT[1] },
  });

  const capturePlanData = loadCapturePlan();
  const planByUisId = (capturePlanData && capturePlanData.byUisId) || {};
  if (capturePlanData) {
    console.error(`capture_plan.json 로드: ${Object.keys(planByUisId).length}개 화면 시나리오 정의됨`);
  } else {
    console.error('capture_plan.json 없음 — 모든 화면 기본 goto 모드로 캡처');
  }

  const results = [];
  let okCount = 0, failCount = 0, skipCount = 0, expiredCount = 0;
  let preActionCount = 0;  // preActions로 캡처한 화면 수
  const EXPIRED_THRESHOLD = 3;  // 만료 의심 N건 이상이면 중단

  for (let i = 0; i < inventory.length; i++) {
    const item = inventory[i];
    const route = item.route;
    if (!route) {
      skipCount++;
      results.push({ item, status: 'skip', reason: 'route 없음' });
      continue;
    }

    const url = BASE_URL.replace(/\/$/, '') + (route.startsWith('/') ? route : '/' + route);
    const domain = item.domain || 'unknown';
    let uisId = item.uisId || '';
    if (uisId && !String(uisId).startsWith('UIS-F-')) {
      const n = parseInt(uisId, 10);
      if (!isNaN(n)) uisId = `UIS-F-${String(n).padStart(3, '0')}`;
    }
    const entryBase = path.basename(item.entryFile || '', path.extname(item.entryFile || ''));
    const screenId = item.screenId || (entryBase ? entryBase.charAt(0).toUpperCase() + entryBase.slice(1) : `Screen${uisId}`);
    const outDir = path.join(WS, 'docs', '05_설계서', domain, 'UI', screenId);
    const outPng = path.join(outDir, 'preview.png');
    fs.mkdirSync(outDir, { recursive: true });

    if (fs.existsSync(outPng) && process.env.FORCE !== '1') {
      skipCount++;
      results.push({ item, status: 'skip', reason: '이미 존재', outPng: path.relative(WS, outPng) });
      continue;
    }

    const plan = planByUisId[uisId];
    const usePreActions = !!(plan && Array.isArray(plan.preActions) && plan.preActions.length > 0);
    const planType = plan ? plan.type : 'standalone';
    const modeTag = usePreActions ? `[${planType}]` : '[goto]';
    console.error(`[${i + 1}/${inventory.length}] ${modeTag} ${url} → ${path.relative(WS, outPng)}`);

    const page = await ctx.newPage();
    const interceptedUrls = [];
    if (INSPECT) {
      page.on('request', req => {
        try {
          const rt = req.resourceType();
          if (rt === 'xhr' || rt === 'fetch') {
            const pu = new URL(req.url());
            interceptedUrls.push({ method: req.method(), path: pu.pathname + pu.search });
          }
        } catch (_) {}
      });
    }
    let finalUrl = '';
    let captureOk = false;
    let isExpired = false;
    let errMsg = '';

    try {
      if (usePreActions) {
        await executePreActions(page, plan.preActions);
        preActionCount++;
      } else {
        await page.goto(url, { waitUntil: WAIT_UNTIL, timeout: TIMEOUT_MS });
      }
      finalUrl = page.url();

      if (isLoginPage(url, finalUrl)) {
        isExpired = true;
        expiredCount++;
        errMsg = `로그인 페이지로 리다이렉트 (${finalUrl})`;
      } else {
        // Phase 6.2 — 트릭 0. 순수 Playwright fullPage.
        // capture_plan.tabCaptures 가 있으면 — 한 진입 후 각 탭 클릭 + 캡처.
        // 컨텐츠 iframe 안의 탭을 클릭해야 하므로 contentFrame 우선 시도.
        if (Array.isArray(plan && plan.tabCaptures) && plan.tabCaptures.length > 0) {
          const cf = await pickContentFrame(page, 'auto', item.route);
          console.error(`  선택된 frame: ${cf ? cf.url() : 'null'}`);
          if (cf) {
            const tabsCount = await cf.locator("a:has-text('기초정보')").count();
            console.error(`  iframe 안 '기초정보' 매칭 갯수: ${tabsCount}`);
          }
          for (const tab of plan.tabCaptures) {
            const tabOut = outPng.replace(/\.png$/i, (tab.suffix || `_${tab.name}`) + '.png');
            try {
              if (!tab.skipClick && tab.frameSelector && cf) {
                const cnt = await cf.locator(tab.frameSelector).count();
                console.error(`    tab '${tab.name}' selector 매칭: ${cnt}`);
                await cf.locator(tab.frameSelector).first().click({ force: true, timeout: 5000 });
              }
              if (tab.waitMs) await page.waitForTimeout(tab.waitMs);
              // iframe content 면 frame body element screenshot (element 전체)
              if (cf) {
                await cf.locator('body').screenshot({ path: tabOut });
              } else {
                await page.screenshot({ path: tabOut, fullPage: true });
              }
              console.error(`  tab '${tab.name}' → ${path.relative(WS, tabOut)}`);
            } catch (te) {
              console.error(`  tab '${tab.name}' 실패: ${te.message}`);
            }
          }
        } else {
          await page.screenshot({ path: outPng, fullPage: true });
        }
        captureOk = true;
      }
      // ── INSPECT 모드: 탭 탐색 + 위젯 추출 + 네트워크 기록 ──
      if (INSPECT && captureOk) {
        try {
          const cf = await pickContentFrame(page, 'auto', item.route);
          const fi = cf || page.mainFrame();
          const tabSel = await findTabSelector(fi);
          const tabData = [];

          if (tabSel) {
            for (let ti = 0; ti < tabSel.count; ti++) {
              let tabName = `tab${ti + 1}`;
              try {
                tabName = (await fi.locator(tabSel.selector).nth(ti).textContent({ timeout: 1000 }))
                  .trim().slice(0, 20).replace(/[/\\:*?"<>|\s]+/g, '_') || `tab${ti + 1}`;
              } catch (_) {}
              const tabPng  = path.join(outDir, `preview_tab${ti + 1}_${tabName}.png`);
              const tabJson = path.join(outDir, `preview_tab${ti + 1}_${tabName}_widgets.json`);
              try {
                await fi.locator(tabSel.selector).nth(ti).click({ force: true, timeout: 3000 });
                await page.waitForTimeout(600);
                if (cf) await cf.locator('body').screenshot({ path: tabPng });
                else await page.screenshot({ path: tabPng, fullPage: true });
              } catch (te) {
                console.error(`  [inspect] tab${ti + 1} 클릭/캡처 실패: ${te.message.slice(0, 80)}`);
              }
              const widgets = await extractWidgetsFromFrame(fi, tabName);
              tabData.push({ tabName, widgets, tabJson });
            }
          } else {
            const widgets = await extractWidgetsFromFrame(fi, 'main');
            tabData.push({ tabName: 'main', widgets, tabJson: path.join(outDir, 'widgets.json') });
          }

          // 네트워크 인터셉트 URL → 버튼 위젯 api_hints 보완
          const apiPaths = [...new Set(interceptedUrls.map(r => r.path))];
          if (apiPaths.length > 0) {
            for (const { widgets } of tabData) {
              for (const w of widgets) {
                if (w.type_hint === 'button' && w.api_hints.length === 0) {
                  w.api_hints = apiPaths;
                }
              }
            }
          }

          // 탭별 JSON 저장
          for (const { tabName, widgets, tabJson } of tabData) {
            fs.writeFileSync(tabJson, JSON.stringify(widgets, null, 2));
            console.error(`  [inspect] tab '${tabName}': ${widgets.length}위젯 → ${path.basename(tabJson)}`);
          }

          // 네트워크 로그 저장
          if (interceptedUrls.length > 0) {
            fs.writeFileSync(
              path.join(outDir, 'network_requests.json'),
              JSON.stringify(interceptedUrls, null, 2)
            );
            console.error(`  [inspect] network: ${interceptedUrls.length}건 → network_requests.json`);
          }
        } catch (ie) {
          console.error(`  [inspect] 위젯 추출 오류: ${ie.message.slice(0, 150)}`);
        }
      }
      // 옛 트릭 코드 보존 (불사용) — Phase 6.2 휴리스틱
      if (false) {
        const wantFrame = plan && plan.captureFrame !== undefined ? plan.captureFrame : 'auto';
        let captured = false;
        if (wantFrame !== false && wantFrame !== 'page') {
          const contentFrame = await pickContentFrame(page, wantFrame, item.route);
          if (contentFrame) {
            try {
              console.error(`  ★ frame: ${contentFrame.url()}`);
              // 1. body overflow:hidden 해제 + 명시 width/height 제거 → 진짜 컨텐츠 크기 측정
              const sz = await contentFrame.evaluate(() => {
                document.body.style.overflow = 'visible';
                document.body.style.height   = 'auto';
                document.documentElement.style.overflow = 'visible';
                document.documentElement.style.height   = 'auto';
                // 자식 중 height 차지하는 모든 컨테이너의 max 측정
                const all = Array.from(document.body.querySelectorAll('*'));
                let maxBottom = 0;
                for (const el of all) {
                  const r = el.getBoundingClientRect();
                  const bottom = r.bottom + window.scrollY;
                  if (bottom > maxBottom && r.width > 100) maxBottom = bottom;
                }
                return {
                  w: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
                  h: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, maxBottom),
                  bodyW: document.body.offsetWidth,
                  bodyH: document.body.offsetHeight,
                };
              });
              console.error(`  body offset: ${sz.bodyW} x ${sz.bodyH} / scroll+children max: ${sz.w} x ${sz.h}`);

              // 2. iframe element 자체를 진짜 크기로 강제 확대 (부모 layout 무시)
              //    + 부모 페이지의 메뉴/헤더 hide. 단 iframe ancestor chain 은 보존.
              const iframeHandle = await contentFrame.frameElement();
              if (iframeHandle) {
                // 우선 충분히 큰 임시 height 으로 iframe 확대 (lazy 자식 렌더링 트리거)
                await iframeHandle.evaluate((iframeEl, sz) => {
                  iframeEl.style.position = 'fixed';
                  iframeEl.style.top = '0px';
                  iframeEl.style.left = '0px';
                  iframeEl.style.width  = sz.w + 'px';
                  iframeEl.style.height = (sz.h * 2 + 2000) + 'px';  // 임시 큰 height
                  iframeEl.style.zIndex = '999999';
                  iframeEl.style.border = 'none';
                  iframeEl.style.display = 'block';

                  const ancestors = new Set();
                  let p = iframeEl;
                  while (p) { ancestors.add(p); p = p.parentElement; }
                  function hideSiblings(el) {
                    const parent = el.parentElement;
                    if (!parent || parent === document.documentElement) return;
                    for (const sibling of parent.children) {
                      if (!ancestors.has(sibling)) sibling.style.display = 'none';
                    }
                    hideSiblings(parent);
                  }
                  hideSiblings(iframeEl);

                  document.body.style.overflow = 'hidden';
                  document.body.style.margin = '0';
                  document.body.style.padding = '0';
                }, sz);
                await page.waitForTimeout(1200);

                // 3. iframe 확대 후 — frame 안 진짜 컨텐츠 재측정 (lazy·tab 다 렌더된 상태)
                const finalSz = await contentFrame.evaluate(() => {
                  // body overflow 풀고 재측정
                  document.body.style.overflow = 'visible';
                  document.documentElement.style.overflow = 'visible';
                  // 자식 모든 element 의 bottom 최대값
                  const all = document.body.getElementsByTagName('*');
                  let maxBottom = 0;
                  for (const el of all) {
                    const r = el.getBoundingClientRect();
                    const bottom = r.bottom;
                    if (bottom > maxBottom && r.width > 50) maxBottom = bottom;
                  }
                  return {
                    w: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, 1920),
                    h: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, maxBottom),
                  };
                });
                console.error(`  최종 컨텐츠 크기: ${finalSz.w} x ${finalSz.h}`);

                // 4. iframe 정확한 크기로 재설정
                await iframeHandle.evaluate((iframeEl, sz) => {
                  iframeEl.style.width  = sz.w + 'px';
                  iframeEl.style.height = sz.h + 'px';
                }, finalSz);
                await page.waitForTimeout(500);

                // 5. fullPage 캡처 — iframe만 보이는 상태라 정확히 iframe 영역만
                await page.screenshot({ path: outPng, fullPage: true });
                captured = true;
              } else {
                await page.screenshot({
                  path: outPng,
                  clip: { x: 0, y: 0, width: sz.w, height: sz.h },
                });
                captured = true;
              }
            } catch (frameErr) {
              console.error(`  [WARN] frame body screenshot 실패 — page fullPage 폴백: ${frameErr.message}`);
            }
          }
        }
        if (!captured) {
          await page.screenshot({ path: outPng, fullPage: true });
        }
        captureOk = true;

        // Phase 6.2 (2026-05-26): capture_plan.json에 widgets 가 있으면
        // selector별 boundingBox()를 수집해 preview_widgets.json 으로 저장.
        // annotate_preview.py 가 이 JSON + preview.png 를 합성해 preview_annotated.png 생성.
        if (plan && Array.isArray(plan.widgets) && plan.widgets.length > 0) {
          const collected = [];
          for (const w of plan.widgets) {
            if (!w.selector) continue;
            try {
              const el = await page.$(w.selector);
              if (!el) continue;
              const box = await el.boundingBox();
              if (!box) continue;
              collected.push({
                id:       w.id || '',
                number:   w.number || '',
                selector: w.selector,
                label:    w.label || '',
                bbox: [
                  Math.round(box.x),
                  Math.round(box.y),
                  Math.round(box.x + box.width),
                  Math.round(box.y + box.height),
                ],
              });
            } catch (_) { /* selector 매칭 실패는 무시 — 한 화면에 모든 위젯이 항상 존재하지는 않음 */ }
          }
          if (collected.length > 0) {
            const widgetsOut = path.join(outDir, 'preview_widgets.json');
            try {
              fs.writeFileSync(widgetsOut, JSON.stringify(collected, null, 2));
            } catch (e) {
              console.error(`  [WARN] preview_widgets.json 저장 실패: ${e.message}`);
            }
          }
        }
      }
    } catch (e) {
      errMsg = e.message.slice(0, 200);
    } finally {
      await page.close();
    }

    if (captureOk) {
      okCount++;
      results.push({ item, status: 'ok', url, finalUrl, outPng: path.relative(WS, outPng), mode: usePreActions ? planType : 'goto' });
    } else if (isExpired) {
      failCount++;
      results.push({ item, status: 'expired', url, finalUrl, error: errMsg });
      if (expiredCount >= EXPIRED_THRESHOLD) {
        console.error('━'.repeat(60));
        console.error(`만료 의심 ${expiredCount}건 — storageState 만료로 추정. 캡처 중단.`);
        console.error('Bootstrap 재실행:');
        console.error(`  node ${path.basename(__filename)} --bootstrap "${WS}"`);
        console.error('━'.repeat(60));
        break;
      }
    } else {
      failCount++;
      results.push({ item, status: 'fail', url, finalUrl, error: errMsg });
      if (fs.existsSync(outPng)) { try { fs.unlinkSync(outPng); } catch (_) {} }
    }
  }

  await browser.close();

  // 리포트
  const reportPath = path.join(WS, '_tmp', 'runtime_capture_report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({
    baseUrl:         BASE_URL,
    viewport:        VIEWPORT.join('x'),
    storageState:    STORAGE_STATE,
    capturePlanUsed: !!capturePlanData,
    total:           inventory.length,
    ok:              okCount,
    fail:            failCount,
    skip:            skipCount,
    expired:         expiredCount,
    preActionUsed:   preActionCount,
    results,
  }, null, 2), 'utf-8');

  console.error('━'.repeat(60));
  console.error(`완료: 성공 ${okCount} (preActions ${preActionCount}) | 실패 ${failCount} (만료 ${expiredCount}) | 스킵 ${skipCount}`);
  console.error(`리포트: ${path.relative(WS, reportPath)}`);

  if (expiredCount > 0) {
    console.error('\n만료 의심 화면. storageState 갱신 필요:');
    console.error(`  node ${path.basename(__filename)} --bootstrap "${WS}"`);
  }

  process.exit(failCount === inventory.length && inventory.length > 0 ? 1 : 0);
}

// ── 엔트리 ──
(async () => {
  try {
    if (isBootstrap) {
      await bootstrap();
    } else {
      await captureAll();
    }
  } catch (e) {
    console.error('실행 오류:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();
