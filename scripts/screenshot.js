#!/usr/bin/env node
// screenshot.js — preview.html → preview.png (Chrome headless, 추가 설치 불필요)

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

const chrome = findChrome();
if (!chrome) {
  console.error('Chrome을 찾을 수 없습니다. Google Chrome을 설치해주세요.');
  process.exit(1);
}

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

if (fs.existsSync(absPng)) {
  console.log(`스크린샷 저장: ${absPng}`);
  process.exit(0);
} else {
  const errMsg = result.stderr ? result.stderr.slice(0, 300) : '알 수 없는 오류';
  console.error(`스크린샷 실패: ${errMsg}`);
  process.exit(1);
}
