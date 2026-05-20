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
        await page.click(a.selector, { timeout: a.timeoutMs || 5000 });
      } else if (a.action === 'type' || a.action === 'fill') {
        await page.fill(a.selector, a.value || '');
      } else if (a.action === 'select') {
        await page.selectOption(a.selector, a.value);
      } else if (a.action === 'wait') {
        if (a.selector) {
          await page.waitForSelector(a.selector, { timeout: a.timeoutMs || 5000 });
        } else if (a.ms) {
          await page.waitForTimeout(a.ms);
        }
      } else if (a.action === 'press') {
        await page.keyboard.press(a.key);
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

  // Enter 키 대기
  process.stdin.setRawMode(true);
  process.stdin.resume();
  await new Promise(resolve => {
    process.stdin.once('data', resolve);
  });
  process.stdin.setRawMode(false);
  process.stdin.pause();

  // storageState 저장
  await ctx.storageState({ path: STORAGE_STATE });
  console.error(`storageState 저장: ${STORAGE_STATE}`);

  await browser.close();
  console.error('Bootstrap 완료. 이제 인자 없이 실행하면 자동 캡처됩니다.');
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
        await page.screenshot({ path: outPng, fullPage: true });
        captureOk = true;
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
