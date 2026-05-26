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
          // visible · 의미 있는 element: button/a.btn/input.button + label 있는 input · select
          const isVisible = el => {
            const r = el.getBoundingClientRect();
            return r.width > 20 && r.height > 15 && r.top >= 0 && r.left >= 0
                && r.bottom < window.innerHeight && r.right < window.innerWidth;
          };
          const labelOf = el => {
            const t = (el.textContent || el.value || el.placeholder || el.getAttribute('title') || el.name || '').trim();
            return t.length > 0 && t.length < 30 ? t : '';
          };
          // DOM meta — Phase 6.4 U6: placeholder/default/required/pattern/maxlength 등
          const metaOf = el => {
            const m = {};
            const tag  = el.tagName.toLowerCase();
            const type = (el.getAttribute('type') || '').toLowerCase();
            m.tag  = tag;
            m.type = type || (tag === 'select' ? 'select' : (tag === 'textarea' ? 'textarea' : tag));
            if (el.id)            m.dom_id   = el.id;
            if (el.getAttribute('name'))      m.name      = el.getAttribute('name');
            if (el.placeholder)               m.placeholder = el.placeholder;
            // default — value attribute(HTML) 우선, 다음 defaultValue, 다음 현재 value
            const valAttr  = el.getAttribute('value');
            const defVal   = el.defaultValue;
            if (valAttr !== null && valAttr !== '')      m.default_value = valAttr;
            else if (defVal !== undefined && defVal !== '') m.default_value = defVal;
            if (el.required)                  m.required = true;
            if (el.disabled)                  m.disabled = true;
            if (el.readOnly)                  m.readonly = true;
            const pattern  = el.getAttribute('pattern');
            if (pattern)                      m.pattern  = pattern;
            if (el.maxLength && el.maxLength > 0 && el.maxLength < 9999) m.maxlength = el.maxLength;
            if (el.minLength && el.minLength > 0) m.minlength = el.minLength;
            const min = el.getAttribute('min'); if (min)  m.min = min;
            const max = el.getAttribute('max'); if (max)  m.max = max;
            const step = el.getAttribute('step'); if (step) m.step = step;
            // select option 목록 (간략)
            if (tag === 'select') {
              const opts = Array.from(el.options || []).slice(0, 10)
                  .map(o => ({ value: o.value, text: (o.textContent || '').trim().slice(0, 30) }))
                  .filter(o => o.value || o.text);
              if (opts.length) m.options = opts;
            }
            // onclick handler 존재 여부 (정적 분석은 별도 — 여기는 hint만)
            if (el.getAttribute('onclick')) m.has_onclick = true;
            return m;
          };
          // 1) button + 액션 a
          for (const el of document.querySelectorAll('button, a[class*="btn" i], input[type="button"], input[type="submit"]')) {
            if (!isVisible(el)) continue;
            const lbl = labelOf(el);
            if (!lbl) continue;
            const r = el.getBoundingClientRect();
            out.push({ tag: el.tagName, label: lbl, x: r.x, y: r.y, w: r.width, h: r.height, meta: metaOf(el) });
          }
          // 2) input · select (text/email/password 등) — label 있는 것
          for (const el of document.querySelectorAll('input[name], select[name], textarea[name]')) {
            if (!isVisible(el)) continue;
            if (['hidden','button','submit','checkbox','radio'].includes(el.type)) continue;
            const name = el.getAttribute('name') || el.placeholder || '';
            if (!name || name.length > 40) continue;
            const r = el.getBoundingClientRect();
            out.push({ tag: el.tagName, label: name, x: r.x, y: r.y, w: r.width, h: r.height, meta: metaOf(el) });
          }
          // 정렬 — 상→하, 좌→우 (행 단위 그룹화)
          out.sort((a, b) => {
            const yDiff = a.y - b.y;
            if (Math.abs(yDiff) < 25) return a.x - b.x;  // 같은 행
            return yDiff;
          });
          return out;
        });
        if (widgets.length > 0) {
          // 모든 발견된 widget — limit 없음. UIS spec의 디스크립션 단위.
          const bboxed = widgets.map((w, i) => ({
            id: 'A-' + String(i + 1).padStart(2, '0'),
            number: String(i + 1),
            label: w.label,
            bbox: [
              Math.round(iframeBox.x + w.x),
              Math.round(iframeBox.y + w.y),
              Math.round(iframeBox.x + w.x + w.w),
              Math.round(iframeBox.y + w.y + w.h),
            ],
            ...(w.meta || {}),
          }));
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
