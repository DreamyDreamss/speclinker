#!/usr/bin/env node
/**
 * capture.js — CDP attach 기반 화면 캡처 (정식 v1)
 *
 * 사용자가 띄운 Chrome (--remote-debugging-port=9222) 에 attach 해서 캡처.
 * 사이트 layout 트릭 없음. viewport 그대로 측정 → scrollH+여유 만큼 viewport 강제 → 단순 capture.
 *
 * 모드:
 *   --tabs=auto       iframe 안 모든 탭(<a href='#tabN'>) 자동 순회 + 각 캡처
 *   --tabs=name,name  지정 탭만 (예: '기초정보,가격정보')
 *   --tabs=none       현재 활성 탭 1장만 (기본)
 *
 * 옵션:
 *   --out=<dir>        출력 디렉토리 (기본: ./)
 *   --port=9222        CDP port
 *   --frame-url=<key>  컨텐츠 frame URL 매칭 키워드 (예: 'pr201Form')
 *   --margin=200       viewport 여유 마진 px
 *   --annotate         spec.md §4 위젯 표 파싱 → preview_widgets.json + annotate_preview.py 자동 호출
 *   --auto-annotate    spec.md 없어도 캡처 영역 안의 button/input/a 자동 발견 + 번호 부여 + annotate
 *
 * 예:
 *   node capture.js --out=docs/05_설계서/product/UI/Pr201Form --frame-url=pr201Form --tabs=auto --annotate
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
function arg(n, d) { const f = args.find(a => a.startsWith('--' + n + '=')); return f ? f.split('=').slice(1).join('=') : d; }
function flag(n) { return args.includes('--' + n); }
const positional = args.filter(a => !a.startsWith('--'));

const OUT_DIR = path.resolve(arg('out', positional[0] || '.'));
const PORT     = arg('port', '9222');
const FRAME_URL = arg('frame-url', '');
const TABS_OPT  = arg('tabs', 'none');
const MARGIN    = parseInt(arg('margin', '200'), 10);
const ANNOTATE  = flag('annotate');
const AUTO_ANNOTATE = flag('auto-annotate');

fs.mkdirSync(OUT_DIR, { recursive: true });

(async () => {
  const browser = await chromium.connectOverCDP(`http://localhost:${PORT}`);
  const page = browser.contexts()[0].pages()[0];
  console.error(`★ tab: ${page.url()}`);
  const cdp = await browser.contexts()[0].newCDPSession(page);

  const cf = FRAME_URL
    ? page.frames().find(f => f.url().includes(FRAME_URL))
    : page.frames().find(f => f !== page.mainFrame() && !f.url().startsWith('about:'));
  if (!cf) { console.error('content frame 없음'); process.exit(1); }
  console.error(`★ frame: ${cf.url()}`);

  // 탭 목록 결정
  let tabs;
  if (TABS_OPT === 'auto') {
    const auto = await cf.evaluate(() => {
      const links = document.querySelectorAll('a[href^="#tab"]');
      return Array.from(links).map(a => ({
        href: a.getAttribute('href'),
        text: (a.textContent || '').trim(),
      })).filter(t => t.text && t.text.length < 30);
    });
    tabs = auto.map((t, i) => ({
      name:     t.text,
      // text-is selector — jwork 같은 SPA는 attribute click 효과 없을 수 있음
      selector: `a:text-is('${t.text}')`,
      suffix:   `_tab${i + 1}_${t.text}`,
    }));
    console.error(`auto tabs (${tabs.length}): ${tabs.map(t => t.name).join(', ')}`);
  } else if (TABS_OPT === 'none') {
    tabs = [{ name: 'current', skipClick: true, suffix: '' }];
  } else {
    tabs = TABS_OPT.split(',').map((name, i) => ({
      name: name.trim(),
      selector: `a:text-is('${name.trim()}')`,
      suffix: `_tab${i + 1}_${name.trim()}`,
    }));
  }

  // iframe element handle 1회 잡고 재사용
  const iframeHandleGlobal = await cf.frameElement();

  // 탭 간 위젯 번호 전역 카운터 — 탭마다 1부터 재시작하지 않도록
  let globalWidgetSeq = 0;

  for (const tab of tabs) {
    const outPng = path.join(OUT_DIR, 'preview' + (tab.suffix || '') + '.png');
    try {
      // 매 탭 시작: iframe height·viewport override 모두 reset (누적 방지)
      await iframeHandleGlobal.evaluate(el => { el.style.height = ''; });
      await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
      await page.waitForTimeout(300);

      if (!tab.skipClick && tab.selector) {
        await cf.locator(tab.selector).first().click({ force: true, timeout: 5000 });
        await page.waitForTimeout(1500);
      }

      // viewport 1920x1200 (사용자 본 그대로) 에서 fresh 측정
      const sz = await cf.evaluate(() => {
        let best = 0;
        for (const el of document.body.querySelectorAll('*')) {
          if (el.scrollHeight > best && el.clientHeight > 200 && el.clientWidth > 400) {
            best = el.scrollHeight;
          }
        }
        return {
          scrollH: best || document.body.scrollHeight,
          bodyH:   document.body.scrollHeight,
        };
      });
      const targetH = sz.scrollH + MARGIN;
      console.error(`  [${tab.name}] scrollH=${sz.scrollH} → viewport 1920x${targetH}`);

      // iframe element 도 충분 height (global handle 재사용)
      await iframeHandleGlobal.evaluate((el, h) => { el.style.height = h + 'px'; }, targetH - 100);

      // viewport override
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1920, height: targetH, deviceScaleFactor: 1, mobile: false,
      });
      await page.waitForTimeout(800);

      // 단순 capture (captureBeyondViewport 빼고)
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(outPng, Buffer.from(shot.data, 'base64'));
      console.error(`    → ${path.relative(process.cwd(), outPng)} (${fs.statSync(outPng).size} bytes)`);

      // auto-annotate — viewport override 풀기 전에 element 위치 측정
      if (AUTO_ANNOTATE) {
        const iframeBox = await iframeHandleGlobal.boundingBox();
        const widgets = await cf.evaluate(() => {
          const out = [];
          const seenEls = new Set();

          // ------ 헬퍼 ------
          const isVisible = (el) => {
            const r = el.getBoundingClientRect();
            return r.width >= 8 && r.height >= 8 && r.top >= -100 && r.left >= -100;
          };

          // th/label에서 컨테이너 레이블 — jwork: <th>레이블</th><td>...inputs</td>
          const containerLabel = (el) => {
            const td = el.tagName === 'TD' ? el : (el.closest && el.closest('td'));
            if (td) {
              let sib = td.previousElementSibling;
              while (sib) {
                if (sib.tagName === 'TH') return (sib.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50);
                sib = sib.previousElementSibling;
              }
            }
            return '';
          };

          // 엘리먼트 자체 레이블 — 우선순위: aria-label > title > label[for] > closest label > textContent > placeholder > name
          const labelOf = (el) => {
            const aria = el.getAttribute('aria-label'); if (aria && aria.trim()) return aria.trim().slice(0, 50);
            const title = el.getAttribute('title'); if (title && title.trim()) return title.trim().slice(0, 50);
            if (el.id) {
              const lbl = document.querySelector('label[for="' + el.id + '"]');
              if (lbl) { const t = (lbl.textContent || '').replace(/\s+/g, ' ').trim(); if (t) return t.slice(0, 50); }
            }
            const pLbl = el.closest && el.closest('label');
            if (pLbl) { const t = (pLbl.textContent || '').replace(/\s+/g, ' ').trim(); if (t && t.length < 50) return t; }
            const val = el.getAttribute('value');
            if (val && val.trim() && !['checkbox','radio'].includes((el.getAttribute('type')||'').toLowerCase())) return val.trim().slice(0, 50);
            // 직접 텍스트 노드 우선 (아이콘 오염 방지)
            const directTxt = Array.from(el.childNodes)
              .filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent.trim()).filter(Boolean).join(' ');
            if (directTxt && directTxt.length < 50) return directTxt;
            const full = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
            if (full && full.length < 50) return full;
            if (el.placeholder) return el.placeholder.slice(0, 50);
            return (el.getAttribute('name') || '').slice(0, 50);
          };

          // API 힌트 + DOM 메타
          const metaOf = (el) => {
            const m = {};
            const tag = el.tagName.toLowerCase();
            const type = (el.getAttribute('type') || '').toLowerCase();
            m.tag = tag;
            m.type = type || (tag === 'select' ? 'select' : (tag === 'textarea' ? 'textarea' : tag));
            if (el.id) m.dom_id = el.id;
            if (el.getAttribute('name')) m.name = el.getAttribute('name');
            if (el.placeholder) m.placeholder = el.placeholder;
            const valAttr = el.getAttribute('value'); const defVal = el.defaultValue;
            if (valAttr !== null && valAttr !== '') m.default_value = valAttr;
            else if (defVal !== undefined && defVal !== '') m.default_value = defVal;
            if (el.required) m.required = true;
            if (el.disabled) m.disabled = true;
            if (el.readOnly) m.readonly = true;
            const pat = el.getAttribute('pattern'); if (pat) m.pattern = pat;
            if (el.maxLength > 0 && el.maxLength < 9999) m.maxlength = el.maxLength;
            if (el.minLength > 0) m.minlength = el.minLength;
            const mn = el.getAttribute('min'); if (mn) m.min = mn;
            const mx = el.getAttribute('max'); if (mx) m.max = mx;
            if (tag === 'select') {
              const opts = Array.from(el.options || []).slice(0, 12)
                .map(o => ({ value: o.value, text: (o.textContent || '').trim().slice(0, 30) })).filter(o => o.value || o.text);
              if (opts.length) m.options = opts;
            }
            const apiHints = new Set();
            const onclick = el.getAttribute('onclick') || '';
            if (onclick) {
              m.has_onclick = true; m.onclick_raw = onclick.slice(0, 200);
              for (const mm of onclick.matchAll(/['"](\/[\w\-./{}: ]+)['"]/g))
                if (mm[1].length > 2 && mm[1].length < 120) apiHints.add(mm[1]);
              for (const mm of onclick.matchAll(/\b([a-z][a-zA-Z0-9_]{2,})\s*\(/g))
                if (mm[1] && mm[1].length < 40 && !['if','for','while','return','function','alert','confirm'].includes(mm[1]))
                  (m.handler_calls = m.handler_calls || []).push(mm[1]);
            }
            const form = el.closest && el.closest('form');
            if (form) {
              const act = form.getAttribute('action');
              if (act) { m.form_action = act; if (act.startsWith('/')) apiHints.add(act); }
              if (form.getAttribute('name')) m.form_name = form.getAttribute('name');
              const mth = form.getAttribute('method'); if (mth) m.form_method = mth.toUpperCase();
            }
            for (const a of ['data-url','data-href','data-api','data-action']) {
              const v = el.getAttribute(a); if (v && v.startsWith('/')) apiHints.add(v);
            }
            if (apiHints.size) m.api_hints = Array.from(apiHints).slice(0, 5);
            const cls = (el.className || '').toString();
            const cond = [];
            const hm = cls.match(/(?:^|\s)(hidden|invisible|disabled|d-none)(?:\s|$)/); if (hm) cond.push('class:' + hm[1]);
            if (el.getAttribute('aria-hidden') === 'true') cond.push('aria-hidden');
            for (const a of ['data-role','data-permission','v-if','v-show','data-if']) {
              const v = el.getAttribute(a); if (v) cond.push(a + '=' + v.slice(0, 40));
            }
            if (cond.length) m.condition_hints = cond;
            return m;
          };

          // ------ 데이터 그리드 바디 감지 (구조 기반, 클래스명 불필요) ------
          // 판단 기준: <table> or role=grid 이고, <thead> 있고, <tbody>에 행 5개 이상이며 input이 거의 없음
          const gridBodyEls = new Set();
          const addGridBody = root => { for (const el of root.querySelectorAll('*')) gridBodyEls.add(el); };
          for (const el of document.querySelectorAll('[role="grid"], [role="treegrid"]')) addGridBody(el);
          for (const tbl of document.querySelectorAll('table')) {
            const tbody = tbl.querySelector('tbody');
            if (!tbody) continue;
            const rows = tbody.querySelectorAll('tr');
            const inputs = tbody.querySelectorAll('input:not([type="hidden"]), select, textarea');
            // 행 5개 이상이고 입력 요소가 행 수보다 적으면 → 데이터 표시 테이블
            if (rows.length >= 5 && inputs.length < rows.length) addGridBody(tbody);
          }
          // 알려진 그리드 라이브러리 바디 (구조 확인 후 추가)
          for (const sel of ['.jqgrid-bdiv', '.ui-jqgrid-bdiv', '.ag-center-cols-container',
                              '.slick-viewport', '.k-grid-content', '.dx-datagrid-rowsview',
                              '.dataTables_scrollBody', '.handsontable .wtHolder']) {
            for (const el of document.querySelectorAll(sel)) addGridBody(el);
          }

          // ------ 날짜 범위 신호 (구조+의미 기반) ------
          // "날짜범위"를 나타내는 신호: 두 날짜 input 사이에 ~/-/to 텍스트 노드,
          //   또는 input의 id/name/placeholder가 begin/start/end/from/to/bgn/cl 패턴
          const isDateInput = el => {
            if (el.type === 'date' || el.type === 'datetime-local' || el.type === 'month') return true;
            const combo = ((el.id || '') + (el.name || '') + (el.placeholder || '')).toLowerCase();
            return /date|dtm|bgndt|cldt|begin|start|end|from(?!rm)|_to$|strt|bgn|_cl$|_end|_st$/.test(combo);
          };

          // ------ 검색 트리거 신호 (구조+의미 기반) ------
          // 어떤 프레임워크든: 돋보기 이미지, "검색"/"조회" 텍스트 버튼, search role
          const isSearchTrigger = el => {
            const txt = (el.textContent || el.getAttribute('alt') || el.getAttribute('aria-label') || '').trim();
            if (/^(검색|조회|찾기|search|find|lookup)$/i.test(txt)) return true;
            const src = (el.getAttribute('src') || el.getAttribute('href') || '').toLowerCase();
            if (/search|magnif|sch|find|lookup/.test(src)) return true;
            const cls = (el.className || '').toString().toLowerCase();
            if (/search|magnif|lookup|sch/.test(cls)) return true;
            // SVG path 내 돋보기 패턴 (Material Icons, FontAwesome 등)
            if (el.querySelector && el.querySelector('[d*="M15.5 14h-.79l"]')) return true;
            return false;
          };

          // === PASS 1: 복합 위젯 ===

          // [P-A] 날짜 범위 — 컨테이너(td/div/span) 안에 날짜 input 2개 이상
          for (const cont of document.querySelectorAll('td, .form-group, .field-group, fieldset, [class*="range"]')) {
            if (gridBodyEls.has(cont)) continue;
            const dateEls = [...cont.querySelectorAll('input')].filter(e =>
              isDateInput(e) && isVisible(e) && !seenEls.has(e) && !gridBodyEls.has(e)
            );
            if (dateEls.length < 2) continue;
            // 같은 직계 컨테이너 소속 확인 (자식 form-group 내 중복 방지)
            const directParent = el => el.parentElement;
            if (new Set(dateEls.map(directParent)).size > 2) continue;
            const label = containerLabel(cont) || labelOf(dateEls[0]) || '날짜 범위';
            const r0 = dateEls[0].getBoundingClientRect();
            const rN = dateEls[dateEls.length - 1].getBoundingClientRect();
            dateEls.forEach(e => seenEls.add(e));
            out.push({ label, type_hint: 'date-range',
              x: r0.x, y: r0.y, w: rN.x + rN.width - r0.x, h: Math.max(r0.height, rN.height),
              meta: { ...metaOf(dateEls[0]), composite_ids: dateEls.map(e => e.id).filter(Boolean) } });
          }

          // [P-B] 코드 검색 복합 위젯
          // 신호: 같은 컨테이너 안에 텍스트 input + 검색 트리거(이미지/버튼/링크)
          for (const cont of document.querySelectorAll('td, .input-group, .field-group, .form-group, [class*="search-box"]')) {
            if (gridBodyEls.has(cont)) continue;
            const textEls = [...cont.querySelectorAll('input[type="text"], input:not([type])')].filter(e =>
              isVisible(e) && !seenEls.has(e) && !gridBodyEls.has(e)
            );
            if (textEls.length < 1) continue;
            // 검색 트리거 탐색: img, a, button 중 검색 의미를 가진 것
            const triggers = [...cont.querySelectorAll('img, a, button, [role="button"]')].filter(isSearchTrigger);
            if (triggers.length < 1) continue;
            const label = containerLabel(cont) || labelOf(textEls[0]);
            if (!label) continue;
            const r = textEls[0].getBoundingClientRect();
            textEls.forEach(e => seenEls.add(e));
            triggers.forEach(e => { seenEls.add(e); const p = e.closest && e.closest('a, button'); if (p) seenEls.add(p); });
            out.push({ label, type_hint: 'code-lookup', x: r.x, y: r.y, w: r.width, h: r.height,
              meta: { ...metaOf(textEls[0]), composite_ids: textEls.map(e => e.id).filter(Boolean) } });
          }

          // [P-C] 파일 업로드 — input[type=file] 또는 그 래퍼 컴포넌트
          for (const el of document.querySelectorAll('input[type="file"]')) {
            if (!isVisible(el) || seenEls.has(el) || gridBodyEls.has(el)) continue;
            // 래퍼가 있으면 래퍼를 대표로
            const wrapper = el.closest('[class*="upload"], [class*="file"], [id*="file" i], [id*="File"]') || el;
            const label = containerLabel(wrapper) || containerLabel(el) || labelOf(el) || '파일 첨부';
            seenEls.add(el); if (wrapper !== el) seenEls.add(wrapper);
            const r = (isVisible(wrapper) ? wrapper : el).getBoundingClientRect();
            out.push({ label, type_hint: 'file-upload', x: r.x, y: r.y, w: r.width, h: r.height, meta: metaOf(el) });
          }

          // === PASS 2: 버튼 ===
          // HTML 의미 기반: <button>, input[type=button|submit|reset], [role=button]
          // + 시각적 버튼 패턴: 클릭 가능한 <a>/<span> (onclick, 또는 버튼 래퍼 안에 있는 경우)
          for (const el of document.querySelectorAll(
            'button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]'
          )) {
            if (seenEls.has(el) || !isVisible(el) || gridBodyEls.has(el)) continue;
            seenEls.add(el);
            const lbl = labelOf(el) || '버튼';
            const r = el.getBoundingClientRect();
            out.push({ label: lbl, type_hint: 'button', x: r.x, y: r.y, w: r.width, h: r.height, meta: metaOf(el) });
          }
          // 시각적 버튼: onclick이 있거나, 버튼처럼 생긴 <a>/<span>/<div>
          // 단, 검색 트리거로 이미 처리된 것 제외
          for (const el of document.querySelectorAll('a[onclick], a[href^="javascript"], span[onclick], div[onclick]')) {
            if (seenEls.has(el) || !isVisible(el) || gridBodyEls.has(el)) continue;
            const lbl = labelOf(el);
            if (!lbl || lbl.length < 1) continue;
            seenEls.add(el);
            const r = el.getBoundingClientRect();
            out.push({ label: lbl, type_hint: 'button', x: r.x, y: r.y, w: r.width, h: r.height, meta: metaOf(el) });
          }

          // === PASS 3: 체크박스/라디오 — name별 그룹화 ===
          const radioGroups = {}, checkGroups = {};
          for (const el of document.querySelectorAll('input[type="checkbox"], input[type="radio"]')) {
            if (seenEls.has(el) || !isVisible(el) || gridBodyEls.has(el)) continue;
            const nm = el.getAttribute('name') || ('_' + (el.id || Math.random()));
            const lbl = labelOf(el) || el.value || '';
            if (el.type === 'radio') {
              if (!radioGroups[nm]) radioGroups[nm] = { el, labels: [], r: el.getBoundingClientRect() };
              if (lbl && !radioGroups[nm].labels.includes(lbl)) radioGroups[nm].labels.push(lbl);
            } else {
              const contLbl = containerLabel(el) || lbl;
              if (!checkGroups[nm]) checkGroups[nm] = { el, label: contLbl, r: el.getBoundingClientRect() };
            }
          }
          for (const [nm, g] of Object.entries(radioGroups)) {
            if (seenEls.has(g.el)) continue; seenEls.add(g.el);
            const opts = g.labels.slice(0, 4).join('/');
            const meta = metaOf(g.el); meta.type = 'radio'; if (g.labels.length) meta.radio_options = g.labels;
            out.push({ label: '[라디오] ' + (opts || nm), type_hint: 'radio', x: g.r.x, y: g.r.y, w: g.r.width, h: g.r.height, meta });
          }
          for (const [nm, g] of Object.entries(checkGroups)) {
            if (seenEls.has(g.el)) continue; seenEls.add(g.el);
            const meta = metaOf(g.el); meta.type = 'checkbox';
            out.push({ label: '[체크박스] ' + g.label, type_hint: 'checkbox', x: g.r.x, y: g.r.y, w: g.r.width, h: g.r.height, meta });
          }

          // === PASS 4: 나머지 단순 입력 ===
          for (const el of document.querySelectorAll('input, select, textarea')) {
            if (seenEls.has(el) || !isVisible(el) || gridBodyEls.has(el)) continue;
            const t = (el.getAttribute('type') || '').toLowerCase();
            if (['hidden','button','submit','reset','image','checkbox','radio','file'].includes(t)) continue;
            const lbl = labelOf(el) || containerLabel(el);
            if (!lbl) continue;
            seenEls.add(el);
            const r = el.getBoundingClientRect();
            const tHint = el.tagName.toLowerCase() === 'select' ? 'select' : (el.tagName.toLowerCase() === 'textarea' ? 'textarea' : 'text');
            out.push({ label: lbl, type_hint: tHint, x: r.x, y: r.y, w: r.width, h: r.height, meta: metaOf(el) });
          }

          // 정렬 — 상→하, 좌→우
          out.sort((a, b) => {
            const dy = a.y - b.y;
            if (Math.abs(dy) < 25) return a.x - b.x;
            return dy;
          });
          return out;
        });
        if (widgets.length > 0) {
          // 모든 발견된 widget — limit 없음. UIS spec의 디스크립션 단위.
          const bboxed = widgets.map((w) => {
            globalWidgetSeq += 1;
            return {
              id: 'WG-' + String(globalWidgetSeq).padStart(2, '0'),
              number: String(globalWidgetSeq),
              label: w.label,
              type_hint: w.type_hint || null,
              bbox: [
                Math.round(iframeBox.x + w.x),
                Math.round(iframeBox.y + w.y),
                Math.round(iframeBox.x + w.x + w.w),
                Math.round(iframeBox.y + w.y + w.h),
              ],
              ...(w.meta || {}),
            };
          });
          const widgetsJson = outPng.replace(/\.png$/i, '_widgets.json');
          fs.writeFileSync(widgetsJson, JSON.stringify(bboxed, null, 2));
          console.error(`    auto-annotate: ${bboxed.length}개 widget 발견`);

          // annotate_preview.py 호출 — default 이름 필요해서 임시 dir
          const scriptsDir = path.dirname(__filename);
          const tmpDir = path.join(path.dirname(outPng), '.annot_tmp');
          fs.mkdirSync(tmpDir, { recursive: true });
          fs.copyFileSync(outPng, path.join(tmpDir, 'preview.png'));
          fs.copyFileSync(widgetsJson, path.join(tmpDir, 'preview_widgets.json'));
          try {
            execSync(`python "${path.join(scriptsDir, 'annotate_preview.py')}" "${tmpDir}"`, {
              encoding: 'utf-8',
              env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
            });
          } catch (e) { /* annotate_preview.py print 인코딩 에러는 무시 — 파일은 생성됨 */ }
          const annoSrc = path.join(tmpDir, 'preview_annotated.png');
          if (fs.existsSync(annoSrc)) {
            const annoDst = outPng.replace(/\.png$/i, '_annotated.png');
            fs.copyFileSync(annoSrc, annoDst);
            console.error(`    annotated → ${path.basename(annoDst)}`);
          }
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      }

      await cdp.send('Emulation.clearDeviceMetricsOverride');

      // annotate — spec.md §4 selector → widget bbox 수집 → annotate_preview.py
      if (ANNOTATE) {
        const specPath = path.join(OUT_DIR, 'spec.md');
        if (fs.existsSync(specPath)) {
          try {
            // build_capture_plan.py 의 parse_widget_table 재사용
            const scriptsDir = path.dirname(__filename);
            const widgetsJsonPath = outPng.replace(/\.png$/i, '_widgets.json');
            const parseScript = `
import sys
sys.path.insert(0, ${JSON.stringify(scriptsDir)})
from build_capture_plan import _parse_widget_table
import json
body = open(${JSON.stringify(specPath)}, encoding='utf-8').read()
widgets = _parse_widget_table(body)
print(json.dumps(widgets, ensure_ascii=False))
`;
            const tmp = outPng + '.parse.py';
            fs.writeFileSync(tmp, parseScript);
            const widgetsRaw = execSync(`python "${tmp}"`, { encoding: 'utf-8' });
            fs.unlinkSync(tmp);
            const widgets = JSON.parse(widgetsRaw);

            // bbox 측정 — viewport override 다시 (annotate 영역과 동일)
            await iframeHandleGlobal.evaluate((el, h) => { el.style.height = h + 'px'; }, targetH - 100);
            await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: targetH, deviceScaleFactor: 1, mobile: false });
            await page.waitForTimeout(300);
            const iframeBox = await iframeHandleGlobal.boundingBox();

            const bboxed = [];
            for (const w of widgets) {
              if (!w.selector) continue;
              try {
                const box = await cf.locator(w.selector).first().boundingBox();
                if (box) {
                  bboxed.push({
                    id: w.id, number: w.number || w.id, label: w.label || '',
                    bbox: [
                      Math.round(iframeBox.x + box.x),
                      Math.round(iframeBox.y + box.y),
                      Math.round(iframeBox.x + box.x + box.width),
                      Math.round(iframeBox.y + box.y + box.height),
                    ],
                  });
                }
              } catch (_) {}
            }
            await cdp.send('Emulation.clearDeviceMetricsOverride');

            if (bboxed.length > 0) {
              fs.writeFileSync(widgetsJsonPath, JSON.stringify(bboxed, null, 2));
              console.error(`    annotate widgets: ${bboxed.length}개`);
              // annotate_preview.py 호출 — 단 default 입력은 preview.png + preview_widgets.json
              // capture.js 는 tab 별 파일을 만들기 때문에 outPng 와 widgetsJsonPath 를 임시로 default 이름으로 복사 후 처리
              const tmpDir = path.join(path.dirname(outPng), '.annotate_tmp');
              fs.mkdirSync(tmpDir, { recursive: true });
              fs.copyFileSync(outPng, path.join(tmpDir, 'preview.png'));
              fs.copyFileSync(widgetsJsonPath, path.join(tmpDir, 'preview_widgets.json'));
              execSync(`python "${path.join(scriptsDir, 'annotate_preview.py')}" "${tmpDir}"`, { encoding: 'utf-8' });
              const annotatedSrc = path.join(tmpDir, 'preview_annotated.png');
              if (fs.existsSync(annotatedSrc)) {
                const annotatedDst = outPng.replace(/\.png$/i, '_annotated.png');
                fs.copyFileSync(annotatedSrc, annotatedDst);
                console.error(`    annotated → ${path.basename(annotatedDst)}`);
              }
              fs.rmSync(tmpDir, { recursive: true, force: true });
            }
          } catch (e) {
            console.error(`    annotate 실패: ${e.message}`);
          }
        } else {
          console.error(`    annotate 스킵: spec.md 없음 (${specPath})`);
        }
      }
    } catch (e) {
      console.error(`  [${tab.name}] 실패: ${e.message}`);
    }
  }

  await browser.close();
  console.error('완료.');
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
