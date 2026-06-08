#!/usr/bin/env node
/**
 * sl_board_cdp.js — SpecLens SR 작업보드 ↔ /sl-viewer 세션 CDP 다리
 *
 * 별도 서버 없음. 기존 캡처와 동일한 CDP(9222) 채널로 SpecLens 탭과 통신한다.
 *   inject <board.json>  : window.__slBoard 주입 + SlViewer.renderBoard()
 *   status <status.json> : window.__slStatus 병합 + 재렌더 (진행상태 갱신)
 *   poll                 : window.__slQueue 1회 읽어 비우고 JSON 출력(버튼 클릭 요청)
 *   watch                : 토큰-효율 long-poll. 내부에서 주기적으로 큐를 확인하다가
 *                          (1) 버튼 클릭이 실제로 쌓이거나 (2) CDP가 죽거나 (3) 탭이 닫히거나
 *                          (4) idle 한계 시각이 되면 그때만 1회 출력하고 종료한다.
 *                          → 세션은 이벤트가 있을 때만 깨어나 처리하고 watch를 재실행한다.
 *                            CDP가 죽으면 cdp-closed를 반환하므로 세션이 재실행을 멈춘다(loop 자동 정리).
 *   alive                : CDP(9222) 생존 여부만 빠르게 출력 ({alive:true|false})
 *
 * Usage:
 *   node sl_board_cdp.js inject sr_board.json [--port=9222]
 *   node sl_board_cdp.js status _tmp/board_status.json
 *   node sl_board_cdp.js poll
 *   node sl_board_cdp.js watch [--port=9222] [--interval=4000] [--max-wait=1500000]
 *   node sl_board_cdp.js alive
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
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

function loadChromium() {
  const PW = path.join(__dirname, '..', 'node_modules', 'playwright-core');
  return require(PW).chromium;
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

/**
 * CDP에 붙어 SpecLens 탭의 큐를 1회 비운다.
 * @returns {Promise<{viewer:boolean, requests:Array}>}
 *   viewer=false 면 탭을 못 찾음(닫힘). requests=비운 큐.
 */
async function drainQueueOnce(chromium) {
  const browser = await chromium.connectOverCDP('http://localhost:' + PORT);
  try {
    const page = await findViewerPage(browser);
    if (!page) return { viewer: false, requests: [] };
    const q = await page.evaluate(() => {
      const arr = window.__slQueue || [];
      window.__slQueue = [];
      return arr;
    });
    return { viewer: true, requests: q || [] };
  } finally {
    try { await browser.close(); } catch (_) {}
  }
}

(async () => {
  if (!['inject', 'status', 'poll', 'watch', 'alive'].includes(CMD)) {
    out({ error: 'usage: sl_board_cdp.js <inject|status|poll|watch|alive> [file] [--port=9222]' });
    process.exit(1);
  }

  // alive: CDP 생존만 빠르게 (loop 시작 전 게이트용)
  if (CMD === 'alive') {
    out({ alive: await isChromeAlive(), port: PORT });
    process.exit(0);
  }

  if (!(await isChromeAlive())) {
    // watch는 "CDP 없음"을 정상 종료 이벤트로 본다(세션이 loop를 깔끔히 끝내도록).
    if (CMD === 'watch') { out({ ok: true, event: 'cdp-closed', reason: 'startup' }); process.exit(0); }
    out({ error: 'Chrome CDP 미동작 — SpecLens를 --remote-debugging-port=' + PORT + ' Chrome으로 띄우세요', port: PORT });
    process.exit(1);
  }

  let chromium;
  try { chromium = loadChromium(); }
  catch (e) {
    if (CMD === 'watch') { out({ ok: true, event: 'error', error: 'playwright-core 없음: ' + e.message }); process.exit(0); }
    out({ error: 'playwright-core 없음 — npm install 필요: ' + e.message }); process.exit(1);
  }

  // ── watch: 토큰-효율 long-poll ─────────────────────────────────────────────
  if (CMD === 'watch') {
    const interval = Math.max(1500, parseInt(arg('interval', '4000'), 10) || 4000);
    const maxWait  = Math.max(interval, parseInt(arg('max-wait', '1500000'), 10) || 1500000); // ~25분
    const deadline = Date.now() + maxWait;
    while (true) {
      // 1) CDP 죽었나?
      if (!(await isChromeAlive())) { out({ ok: true, event: 'cdp-closed' }); process.exit(0); }
      // 2) 큐 비우기
      let res;
      try { res = await drainQueueOnce(chromium); }
      catch (e) {
        // 연결 순간 끊김 — 다음 루프에서 alive 재확인
        await sleep(interval); continue;
      }
      if (!res.viewer) { out({ ok: true, event: 'no-viewer' }); process.exit(0); } // 탭 닫힘
      if (res.requests.length) { out({ ok: true, event: 'requests', requests: res.requests }); process.exit(0); }
      // 3) idle 한계 — 세션이 재실행해 heartbeat 유지
      if (Date.now() >= deadline) { out({ ok: true, event: 'idle-timeout' }); process.exit(0); }
      await sleep(interval);
    }
  }

  // ── inject / status / poll: 1회성 ──────────────────────────────────────────
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

    } else if (CMD === 'status') {
      const st = readJson(FILE);
      await page.evaluate((s) => {
        window.__slStatus = Object.assign(window.__slStatus || {}, s);
        if (window.SlViewer && window.SlViewer.renderBoard && document.querySelector('#sl-main .sl-board')) {
          window.SlViewer.renderBoard();
        }
      }, st);
      out({ ok: true, updated: Object.keys(st).length });

    } else { // poll (1회)
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
