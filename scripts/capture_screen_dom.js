#!/usr/bin/env node
/**
 * capture_screen_dom.js — 인터랙티브 화면 캡처 (사용자가 메뉴로 진입해둔 현재 화면)
 *
 * goto/BFS와 다름: URL로 이동하지 않는다. 사용자가 메뉴로 직접 진입해
 * 완전 렌더된(권한·메뉴컨텍스트 살아있는) 현재 활성 화면을 그대로 캡처한다.
 *
 * 산출:
 *   <ws>/_tmp/captures/<screenId>/preview.png         스크린샷(화면 프레임)
 *   <ws>/_tmp/captures/<screenId>/dom_snapshot.json   풍부한 DOM 스냅샷(에이전트 입력)
 *   stdout JSON                                        {screenId, activeRoute, captureDir, widgetCount, ...}
 *
 * 화면 프레임 선택(스택중립): 활성 페이지의 프레임 중 상호작용 위젯이 가장 많은 프레임.
 *   - jwork 셸: content iframe이 위젯을 가짐 → 그 프레임
 *   - Next.js SPA: mainFrame이 위젯을 가짐 → mainFrame
 *   프레임워크 분기 없음 — "위젯 최다 프레임" 규칙 하나로 양쪽 커버.
 *
 * Usage:
 *   node capture_screen_dom.js --workspace=<dir> [--screenId=<id>] [--port=9222] [--maxHeight=8000]
 *   (screenId 생략 시 화면 프레임 URL 마지막 세그먼트로 자동 결정)
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const http = require('http');

const rawArgs = process.argv.slice(2);
function arg(n, d) {
  const f = rawArgs.find(a => a.startsWith('--' + n + '='));
  return f ? f.split('=').slice(1).join('=') : d;
}

const PORT      = arg('port', '9222');
const WORKSPACE = path.resolve(arg('workspace', process.cwd()));
let   SCREEN_ID = arg('screenId', '');
const MAX_H     = parseInt(arg('maxHeight', '8000'), 10);
const LIST_TABS = rawArgs.includes('--list-tabs');   // 탭 검출만(가이드형: 에이전트가 사용자에게 제시)
const TAB_SEL   = arg('tab-sel', '');                // 캡처 전 클릭할 탭 CSS selector
const TAB_TEXT  = arg('tab-text', '');               // 또는 탭 텍스트로 클릭
const SUFFIX    = arg('suffix', '');                 // 출력 파일 접미사(예: _tab2)

// 스택중립 탭 검출식: 표준 탭 패턴. 등록상태(사람 설정) 하에서만 의미.
const TAB_DETECT_EXPR = `(function(){
  var sels=['[role="tab"]','.contents-tab a','.nav-tabs a','ul.tab a','ul.tabs a','a[href^="#tab"]','.tab-tit a'];
  var seen=new Set(), out=[], i=1;
  for(var s=0;s<sels.length;s++){
    document.querySelectorAll(sels[s]).forEach(function(el){
      var r=el.getBoundingClientRect(); if(r.width<8||r.height<6) return;
      var t=(el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,30);
      var key=t+'@'+Math.round(r.top); if(!t||seen.has(key)) return; seen.add(key);
      var sel = el.id?('#'+el.id):(el.getAttribute('href')&&el.getAttribute('href').indexOf('#tab')===0?(sels[s]+'[href="'+el.getAttribute('href')+'"]'):'');
      out.push({index:i++, text:t, href:el.getAttribute('href')||'', sel:sel});
    });
    if(out.length) break;   // 첫 매칭 패턴만(혼재 방지)
  }
  return JSON.stringify(out);
})()`;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

function isChromeAlive() {
  return new Promise(resolve => {
    http.get('http://localhost:' + PORT + '/json/version', res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { JSON.parse(d); resolve(true); } catch(_) { resolve(false); } });
    }).on('error', () => resolve(false));
  });
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

// ── 풍부한 DOM 스냅샷 추출식 (화면 프레임 내부에서 evaluate) ───────────────────
// 위젯마다 id·name·label·type·value·onclick·href·bbox 수집 → 에이전트가
// 버튼→JS 핸들러(#id / onclick fn)→ajax url 을 이어 api_hints(raw)를 만든다.
const SNAPSHOT_EXPR = `(function(){
  function txt(el){ return (el.textContent||'').replace(/\\s+/g,' ').trim(); }
  function labelFor(el){
    // 1) <label for=id>
    if(el.id){ var lf=document.querySelector('label[for="'+el.id.replace(/"/g,'')+'"]'); if(lf){var t=txt(lf); if(t) return t.slice(0,80);} }
    // 2) aria-label / aria-labelledby
    var al=el.getAttribute('aria-label'); if(al) return al.trim().slice(0,80);
    var lb=el.getAttribute('aria-labelledby'); if(lb){ var e=document.getElementById(lb); if(e){var t=txt(e); if(t) return t.slice(0,80);} }
    // 3) 감싼 <label>
    var p=el.closest('label'); if(p){ var t=txt(p); if(t) return t.slice(0,80); }
    // 4) 폼-테이블 레이아웃: 같은 행(tr)의 선행 th/td 라벨
    var tr=el.closest('tr');
    if(tr){ var th=tr.querySelector('th,td.th,td.label,td:first-child'); if(th && !th.contains(el)){ var t=txt(th); if(t) return t.slice(0,80);} }
    // 5) placeholder / 버튼·링크 자체 텍스트
    if(el.placeholder) return el.placeholder.slice(0,80);
    var self=txt(el); if(self) return self.slice(0,80);
    return el.name||el.id||el.tagName.toLowerCase();
  }
  var SELS='button,a[href],a[onclick],input,select,textarea,[onclick],.btn';
  var seen=new Set(), widgets=[], seq=1;
  document.querySelectorAll(SELS).forEach(function(el){
    var r=el.getBoundingClientRect();
    if(r.width<4||r.height<4) return;
    var key=Math.round(r.left)+','+Math.round(r.top)+','+el.tagName+','+(el.id||'');
    if(seen.has(key)) return; seen.add(key);
    var type=(el.getAttribute('type')||'').toLowerCase();
    var hidden=type==='hidden'; if(hidden) return;
    widgets.push({
      n: seq++,
      tag: el.tagName.toLowerCase(),
      type: type,
      id: el.id||'',
      name: el.getAttribute('name')||'',
      label: labelFor(el),
      value: (type==='checkbox'||type==='radio') ? (el.checked?'checked':'') : (el.value||'').slice(0,60),
      onclick: (el.getAttribute('onclick')||'').slice(0,120),
      href: (el.getAttribute('href')||'').slice(0,120),
      disabled: el.disabled===true || el.classList.contains('disabled') || el.classList.contains('disabled-all'),
      readonly: el.readOnly===true || el.hasAttribute('readonly'),
      bbox: [Math.round(r.left),Math.round(r.top),Math.round(r.right),Math.round(r.bottom)]
    });
  });
  // 구조 랜드마크: 제목/섹션 헤딩 (§3 블록 식별용)
  var heads=[];
  document.querySelectorAll('h1,h2,h3,h4,legend,.section-title,.tab-tit').forEach(function(el){
    var t=txt(el); var r=el.getBoundingClientRect();
    if(t && r.height>4) heads.push({text:t.slice(0,60), y:Math.round(r.top)});
  });
  return JSON.stringify({
    url: location.href,
    title: document.title||'',
    widgets: widgets,
    headings: heads.slice(0,80)
  });
})()`;

// ── 메인 ─────────────────────────────────────────────────────────────────────

(async () => {
  if (!(await isChromeAlive())) {
    console.log(JSON.stringify({ error: 'Chrome CDP 미동작 — STEP U1(로그인)을 먼저 실행하세요', port: PORT }));
    process.exit(1);
  }

  const env = parseProjectEnv();
  const baseHost = (() => { try { return new URL(env.PREVIEW_BASE_URL || '').host; } catch(_) { return ''; } })();

  const PW = path.join(__dirname, '..', 'node_modules', 'playwright-core');
  const { chromium } = require(PW);
  const browser = await chromium.connectOverCDP('http://localhost:' + PORT);

  let out = null;
  try {
    // 활성 페이지 선택: PREVIEW_BASE_URL 호스트 일치 우선 → 비-about 첫 페이지
    let pwPage = null;
    for (const ctx of browser.contexts()) {
      const pages = ctx.pages();
      pwPage = (baseHost ? pages.find(p => { try { return new URL(p.url()).host === baseHost; } catch(_) { return false; } }) : null)
            || pages.find(p => !p.url().startsWith('about:') && !p.url().startsWith('chrome:'))
            || pages[0];
      if (pwPage) break;
    }
    if (!pwPage) { out = { error: '열린 앱 탭 없음 — 화면을 메뉴로 띄운 뒤 다시 요청하세요' }; }
    else {
      await pwPage.bringToFront().catch(() => {});

      // 화면 프레임 선택(스택중립): 위젯 최다 프레임
      const frames = pwPage.frames();
      let best = pwPage.mainFrame(), bestCount = -1, bestIframeEl = null;
      for (const fr of frames) {
        let cnt = 0;
        try {
          cnt = await fr.evaluate(`document.querySelectorAll('input:not([type=hidden]),select,textarea,button,a[onclick],.btn').length`);
        } catch(_) { cnt = 0; }
        if (cnt > bestCount) { bestCount = cnt; best = fr; }
      }
      // 선택된 프레임이 iframe이면 그 element 핸들 확보(스크린샷용)
      if (best !== pwPage.mainFrame()) {
        try { bestIframeEl = await best.frameElement(); } catch(_) { bestIframeEl = null; }
      }

      // --list-tabs: 탭 검출만 하고 반환(가이드형 — 에이전트가 사용자에게 제시)
      if (LIST_TABS) {
        let tabs = [];
        try { tabs = JSON.parse(await best.evaluate(TAB_DETECT_EXPR)); } catch(_) {}
        out = { success: true, mode: 'list-tabs', frameType: bestIframeEl ? 'iframe' : 'main',
                activeRoute: (best.url() || pwPage.url()).replace(/^https?:\/\/[^/]+/, '').split('?')[0],
                tabCount: tabs.length, tabs };
        console.log(JSON.stringify(out));
        await browser.close().catch(() => {});
        process.exit(0);
      }

      // 탭 클릭(편집상태는 사람이 사전 설정) — 캡처 전 해당 탭 활성화
      if (TAB_SEL || TAB_TEXT) {
        try {
          if (TAB_SEL) {
            await best.evaluate(`(function(s){var e=document.querySelector(s);if(e)e.click();})(${JSON.stringify(TAB_SEL)})`);
          } else {
            await best.evaluate(`(function(t){var as=[].slice.call(document.querySelectorAll('[role=tab],.contents-tab a,.nav-tabs a,a[href^="#tab"],.tab-tit a'));var e=as.find(function(x){return (x.textContent||'').replace(/\\s+/g,' ').trim()===t;});if(e)e.click();})(${JSON.stringify(TAB_TEXT)})`);
          }
          await pwPage.waitForTimeout(1200);
        } catch(_) {}
      }

      // 높이 측정 + overflow 해제(전체 화면 스크린샷)
      let contentH = 1080;
      try {
        await best.evaluate(`(function(){
          var skip=new Set(['SCRIPT','STYLE','HEAD','META','LINK']);
          document.querySelectorAll('*').forEach(function(el){
            if(skip.has(el.tagName)) return;
            var cs=getComputedStyle(el);
            if(/(hidden|scroll|auto)/.test(cs.overflowY)||/(hidden|scroll|auto)/.test(cs.overflow)){
              el.style.overflow='visible'; el.style.overflowY='visible'; el.style.maxHeight='none';
            }
          });
        })()`);
        await pwPage.waitForTimeout(300);
        // 실제 콘텐츠 높이 = 보이는 '의미 요소'의 최하단 + 여백.
        // scrollHeight(빈 컨테이너 포함 과대값)·div(레이아웃 컨테이너)는 제외 → 세로 여백 부풀림 방지.
        contentH = await best.evaluate(`(function(){
          var mb=0;
          document.querySelectorAll('input:not([type=hidden]),select,textarea,button,a,th,td,label,img,h1,h2,h3,h4,legend').forEach(function(el){
            if(!el.offsetParent && el.tagName!=='BODY') return;   // display:none 제외
            var r=el.getBoundingClientRect();
            if(r.width<3||r.height<3) return;
            if(r.bottom>mb && r.bottom < ${MAX_H}) mb=r.bottom;
          });
          return Math.min(Math.max(Math.round(mb)+32, 500), ${MAX_H});
        })()`);
        contentH = Math.max(Math.round(contentH || 900), 500);
      } catch(_) {}

      // screenId 자동 결정 (프레임 URL 마지막 세그먼트)
      const frameUrl = best.url() || pwPage.url();
      const activeRoute = frameUrl.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
      if (!SCREEN_ID) {
        const segs = activeRoute.split('/').filter(Boolean);
        SCREEN_ID = segs[segs.length - 1] || 'screen';
      }
      const OUT_DIR = path.join(WORKSPACE, '_tmp', 'captures', SCREEN_ID);
      fs.mkdirSync(OUT_DIR, { recursive: true });

      // iframe 높이 확장(부모에서) — iframe 프레임일 때만
      if (bestIframeEl) {
        await pwPage.evaluate(`(function(h){
          var ifr=Array.from(document.querySelectorAll('iframe')).sort(function(a,b){var ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();return rb.width*rb.height-ra.width*ra.height;})[0];
          if(!ifr) return; ifr.style.height=h+'px'; ifr.style.minHeight=h+'px';
          var p=ifr.parentElement; while(p&&p!==document.body){ p.style.overflow='visible'; p.style.maxHeight='none'; p=p.parentElement; }
        })(${contentH})`).catch(() => {});
      }
      await pwPage.setViewportSize({ width: 1920, height: Math.min(contentH + 100, MAX_H) }).catch(() => {});
      await pwPage.waitForTimeout(400);

      // 스크린샷
      let imgBuf = null;
      if (bestIframeEl) imgBuf = await bestIframeEl.screenshot({ timeout: 15000 }).catch(() => null);
      if (!imgBuf)      imgBuf = await pwPage.screenshot({ fullPage: true, timeout: 15000 }).catch(() => null);

      // DOM 스냅샷
      let snap = { url: frameUrl, title: '', widgets: [], headings: [] };
      try { snap = JSON.parse(await best.evaluate(SNAPSHOT_EXPR)); } catch(_) {}
      snap.screenId = SCREEN_ID;
      snap.activeRoute = activeRoute;
      snap.frameType = bestIframeEl ? 'iframe' : 'main';

      const pngName  = 'preview' + SUFFIX + '.png';        // 탭이면 preview_tab2.png
      const snapName = 'dom_snapshot' + SUFFIX + '.json';
      snap.suffix = SUFFIX || null;
      if (imgBuf) fs.writeFileSync(path.join(OUT_DIR, pngName), imgBuf);
      fs.writeFileSync(path.join(OUT_DIR, snapName), JSON.stringify(snap, null, 2));

      out = {
        success: true,
        screenId: SCREEN_ID,
        suffix: SUFFIX || null,
        activeRoute,
        frameType: snap.frameType,
        title: snap.title,
        captureDir: OUT_DIR,
        captureFile: imgBuf ? path.join(OUT_DIR, pngName) : '',
        snapshotFile: path.join(OUT_DIR, snapName),
        widgetCount: snap.widgets.length,
        headingCount: snap.headings.length,
        captureHeight: contentH,
      };
    }
  } finally {
    await browser.close().catch(() => {});
  }

  console.log(JSON.stringify(out || { error: 'unknown' }));
  process.exit(out && out.success ? 0 : 1);
})().catch(e => {
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
});
