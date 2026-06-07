#!/usr/bin/env node
/**
 * sl_board_cdp.js — SpecLens SR 작업보드 ↔ /sl-viewer 세션 CDP 다리
 *
 * 별도 서버 없음. 기존 캡처와 동일한 CDP(9222) 채널로 SpecLens 탭과 통신한다.
 *   inject <board.json>  : window.__slBoard 주입 + SlViewer.renderBoard()
 *   drift  <drift.json>  : window.__slDrift 주입 + SlViewer.onDrift() (변경 점검 결과)
 *   status <status.json> : window.__slStatus 병합 + 재렌더 (진행상태 갱신)
 *   poll                 : window.__slQueue 읽어 비우고 JSON 출력(버튼 클릭 요청)
 *
 * Usage:
 *   node sl_board_cdp.js inject sr_board.json [--port=9222]
 *   node sl_board_cdp.js status _tmp/board_status.json
 *   node sl_board_cdp.js poll
 *
 * 전제: SpecLens를 띄운 Chrome이 --remote-debugging-port=9222 로 떠 있어야 함(캡처와 동일).
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const http = require('http');

const rawArgs = process.argv.slice(2);
const CMD  = rawArgs[0] || '';
const FILE = rawArgs.find(a => !a.startsWith('--') && a !== CMD) || '';
function arg(n, d) {
  const f = rawArgs.find(a => a.startsWith('--' + n + '='));
  return f ? f.split('=').slice(1).join('=') : d;
}
const PORT = arg('port', '9222');

function out(obj) { console.log(JSON.stringify(obj)); }

function isChromeAlive() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:' + PORT + '/json/version', (r) => {
      r.resume(); resolve(r.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2500, () => { req.destroy(); resolve(false); });
  });
}

function readJson(p) {
  if (!p) throw new Error('파일 인자 없음');
  return JSON.parse(fs.readFileSync(path.resolve(p), 'utf-8'));
}

async function findViewerPage(browser) {
  for (const ctx of browser.contexts()) {
    const pages = ctx.pages();
    const hit = pages.find(p => p.url().includes('docs/viewer/index.html'))
             || pages.find(p => p.url().includes('/docs/viewer/'));
    if (hit) return hit;
  }
  return null;
}

(async () => {
  if (!['inject', 'drift', 'status', 'poll'].includes(CMD)) {
    out({ error: 'usage: sl_board_cdp.js <inject|drift|status|poll> [file] [--port=9222]' });
    process.exit(1);
  }
  if (!(await isChromeAlive())) {
    out({ error: 'Chrome CDP 미동작 — SpecLens를 --remote-debugging-port=' + PORT + ' Chrome으로 띄우세요', port: PORT });
    process.exit(1);
  }

  const PW = path.join(__dirname, '..', 'node_modules', 'playwright-core');
  let chromium;
  try { ({ chromium } = require(PW)); }
  catch (e) { out({ error: 'playwright-core 없음 — npm install 필요: ' + e.message }); process.exit(1); }

  const browser = await chromium.connectOverCDP('http://localhost:' + PORT);
  try {
    const page = await findViewerPage(browser);
    if (!page) { out({ error: 'SpecLens 탭 없음 — http://localhost:5173/docs/viewer/index.html 를 여세요' }); process.exit(2); }

    if (CMD === 'inject') {
      const data = readJson(FILE);
      await page.evaluate((d) => {
        window.__slBoard = d;
        if (window.SlViewer && window.SlViewer.renderBoard && document.querySelector('#sl-main .sl-board')) {
          window.SlViewer.renderBoard();
        }
      }, data);
      out({ ok: true, injected: (data.srs || []).length });

    } else if (CMD === 'drift') {
      const data = readJson(FILE);
      await page.evaluate((d) => {
        window.__slDrift = d;
        if (window.SlViewer && window.SlViewer.onDrift) window.SlViewer.onDrift();
      }, data);
      out({ ok: true, drift: (data.items || []).length });

    } else if (CMD === 'status') {
      const st = readJson(FILE);
      await page.evaluate((s) => {
        window.__slStatus = Object.assign(window.__slStatus || {}, s);
        if (window.SlViewer && window.SlViewer.renderBoard && document.querySelector('#sl-main .sl-board')) {
          window.SlViewer.renderBoard();
        }
      }, st);
      out({ ok: true, updated: Object.keys(st).length });

    } else { // poll
      const q = await page.evaluate(() => {
        const arr = window.__slQueue || [];
        window.__slQueue = [];
        return arr;
      });
      out({ ok: true, requests: q || [] });
    }
  } catch (e) {
    out({ error: String(e && e.message || e) });
    process.exit(3);
  } finally {
    try { await browser.close(); } catch (_) {}
  }
})();
