#!/usr/bin/env node
// screenshot.js — preview.html → preview.png
// 우선순위: puppeteer-core → Chrome CLI headless

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const [, , htmlPath, pngPath] = process.argv;
if (!htmlPath || !pngPath) {
  console.error('사용법: node screenshot.js <input.html> <output.png>');
  process.exit(1);
}

const absHtml = path.resolve(htmlPath);
const absPng  = path.resolve(pngPath);

if (!fs.existsSync(absHtml)) {
  console.error(`HTML 파일 없음: ${absHtml}`);
  process.exit(1);
}

// ── Chrome 실행 파일 탐색 ──────────────────────────────────────
function findChrome() {
  const candidates = [
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean);

  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (_) {}
  }
  return null;
}

// ── 방법 1: puppeteer-core (설치된 경우) ──────────────────────
async function tryPuppeteer() {
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch (_) { return false; }

  const chrome = findChrome();
  if (!chrome) return false;

  const browser = await puppeteer.launch({
    executablePath: chrome,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    const fileUrl = 'file:///' + absHtml.replace(/\\/g, '/');
    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 10000 });
    await page.screenshot({ path: absPng, fullPage: true });
    return true;
  } finally {
    await browser.close();
  }
}

// ── 방법 2: Chrome CLI --screenshot ───────────────────────────
function tryChromeCliScreenshot() {
  const chrome = findChrome();
  if (!chrome) throw new Error('Chrome 실행 파일을 찾을 수 없습니다.');

  const fileUrl = 'file:///' + absHtml.replace(/\\/g, '/');

  const result = spawnSync(
    chrome,
    [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--disable-extensions',
      `--screenshot=${absPng}`,
      '--window-size=1440,900',
      fileUrl,
    ],
    { timeout: 15000, encoding: 'utf8' }
  );

  if (!fs.existsSync(absPng)) {
    const errMsg = result.stderr ? result.stderr.slice(0, 300) : '알 수 없는 오류';
    throw new Error(`Chrome CLI 실패: ${errMsg}`);
  }
}

// ── 실행 ─────────────────────────────────────────────────────
(async () => {
  try {
    const ok = await tryPuppeteer();
    if (ok) {
      console.log(`스크린샷 저장 (puppeteer-core): ${absPng}`);
      process.exit(0);
    }
  } catch (e) {
    // puppeteer 실패 → CLI fallback
  }

  try {
    tryChromeCliScreenshot();
    console.log(`스크린샷 저장 (Chrome CLI): ${absPng}`);
    process.exit(0);
  } catch (e) {
    console.error(`스크린샷 실패: ${e.message}`);
    process.exit(1);
  }
})();
