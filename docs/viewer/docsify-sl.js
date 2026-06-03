/* docsify-sl.js — Speclinker Docsify 커스텀 플러그인 v1.0 */
(function () {
  'use strict';

  // ── 보안 헬퍼 ─────────────────────────────────────────────
  function escAttr(s) {
    return String(s || '').replace(/['"<>&]/g, function(c) {
      return {'\'': '&#39;', '"': '&quot;', '<': '&lt;', '>': '&gt;', '&': '&amp;'}[c];
    });
  }

  // ── 상태 ──────────────────────────────────────────────────
  let INDEX = null;
  let ACTIVE_DOMAIN = null;
  let ACTIVE_TAB = 'inf';
  let SIDEBAR_MODE = 'domain'; // 'domain' | 'ia'

  // ── 인덱스 로드 ────────────────────────────────────────────
  async function loadIndex() {
    try {
      const res = await fetch('spec_index.json?_=' + Date.now());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      INDEX = await res.json();
      renderSidebar();
      renderDashboard();
    } catch (e) {
      document.getElementById('sl-main').innerHTML =
        `<div style="padding:40px;color:var(--text-muted);text-align:center">
          <h3 style="color:var(--accent)">spec_index.json 없음</h3>
          <p>프로젝트 루트에서 다음을 실행하세요:</p>
          <code>python scripts/gen_docsify.py .</code>
          <p style="font-size:12px;margin-top:16px">오류: ${escAttr(e.message)}</p>
        </div>`;
    }
  }

  // ── 사이드바 ────────────────────────────────────────────────
  function renderSidebar() {
    const sidebar = document.getElementById('sl-sidebar');
    if (!sidebar) return;

    const listHtml = SIDEBAR_MODE === 'domain'
      ? renderDomainList()
      : renderIaTree();

    sidebar.innerHTML = `
      <div class="sl-logo">⚡ Speclinker</div>
      <div>
        <span class="sl-nav-link" onclick="SlViewer.showDashboard()">🏠 대시보드</span>
        <a class="sl-nav-link" href="#/docs/00_FUNC/FUNC_MAP">📋 FUNC_MAP</a>
        <span class="sl-nav-link" onclick="SlViewer.openSpec('.speclinker/sprint-status.yaml')">⚡ Sprint</span>
      </div>
      <div class="sl-toggle">
        <button class="${SIDEBAR_MODE === 'domain' ? 'active' : ''}"
                onclick="SlViewer.setSidebarMode('domain')">도메인</button>
        <button class="${SIDEBAR_MODE === 'ia' ? 'active' : ''}"
                onclick="SlViewer.setSidebarMode('ia')">IA 트리</button>
      </div>
      <div class="sl-section-label">${SIDEBAR_MODE === 'domain' ? '도메인' : '메뉴 계층'}</div>
      <div id="sl-sidebar-list">${listHtml}</div>`;
  }

  function renderDomainList() {
    if (!INDEX) return '<div style="padding:8px 16px;color:var(--text-muted);font-size:12px">로딩 중...</div>';
    const entries = Object.entries(INDEX.domains);
    if (entries.length === 0) return '<div style="padding:8px 16px;color:var(--text-muted);font-size:12px">도메인 없음</div>';
    return entries.map(([name, info]) =>
      `<div class="sl-domain-item ${ACTIVE_DOMAIN === name ? 'active' : ''}"
            onclick="SlViewer.selectDomain('${escAttr(name)}')">
        <span style="flex:1">${name}</span>
        <span style="font-size:11px;color:var(--text-muted)">${info.inf || 0}</span>
      </div>`
    ).join('');
  }

  function renderIaTree() {
    if (!INDEX || !INDEX.ia_tree) return '<div style="padding:8px 16px;color:var(--text-muted);font-size:12px">메뉴 정보 없음</div>';
    return renderIaNode(INDEX.ia_tree, 0);
  }

  function renderIaNode(node, depth) {
    if (!node) return '';
    return Object.entries(node).map(([key, value]) => {
      if (key === '__screens__') return '';
      const indent = depth * 14 + 16;
      const screens = (value.__screens__ || []).map(s =>
        `<div class="sl-ia-screen" style="padding:3px ${indent + 12}px 3px ${indent + 20}px"
              onclick="SlViewer.navigateToScreen('${escAttr(s.id)}')">
          <span style="font-size:10px;color:var(--text-muted)">UIS</span> ${s.name || s.id}
         </div>`
      ).join('');
      const childEntries = Object.entries(value).filter(([k]) => k !== '__screens__');
      const children = childEntries.length > 0
        ? renderIaNode(Object.fromEntries(childEntries), depth + 1)
        : '';
      return `<div class="sl-ia-group" style="padding-left:${indent}px">▸ ${key}</div>
              ${screens}${children}`;
    }).join('');
  }

  // ── 대시보드 ────────────────────────────────────────────────
  function renderDashboard() {
    const main = document.getElementById('sl-main');
    if (!main || !INDEX) return;
    removeQuickNav();
    ACTIVE_DOMAIN = null;
    renderSidebar();

    const t = INDEX.totals;
    const cards = [
      { num: t.inf, label: 'INF', color: 'var(--status-prog)' },
      { num: t.uis, label: 'UIS', color: 'var(--accent)' },
      { num: t.sch, label: 'SCH', color: 'var(--status-done)' },
      { num: t.bat, label: 'BAT', color: 'var(--status-review)' },
    ].map(c => `
      <div class="sl-summary-card">
        <div class="sl-card-num" style="color:${c.color}">${c.num}</div>
        <div class="sl-card-label">${c.label}</div>
      </div>`).join('');

    const rows = Object.entries(INDEX.domains).map(([name, d]) => {
      const infTotal = d.inf || 0;
      const tbd = d.tbd_total || 0;
      const specPct = infTotal > 0 ? Math.round(((infTotal - Math.min(tbd, infTotal)) / infTotal) * 100) : 0;
      const spTotal = d.sprint_total || 0;
      const spPct = spTotal > 0 ? Math.round(((d.sprint_done || 0) / spTotal) * 100) : 0;
      const spColor = spPct >= 80 ? 'var(--status-done)' : spPct >= 40 ? 'var(--accent)' : 'var(--status-review)';
      return `
        <tr onclick="SlViewer.selectDomain('${escAttr(name)}')" style="cursor:pointer">
          <td style="color:var(--accent);font-weight:600">${name}</td>
          <td style="text-align:center;color:var(--status-prog)">${d.inf || 0}</td>
          <td style="text-align:center;color:var(--accent)">${d.uis || 0}</td>
          <td style="text-align:center;color:var(--status-done)">${d.sch || 0}</td>
          <td style="text-align:center;color:var(--status-review)">${d.bat || 0}</td>
          <td>
            <div style="display:flex;align-items:center;gap:6px">
              <div class="sl-progress-bar" style="flex:1">
                <div class="sl-progress-fill" style="width:${specPct}%;background:var(--status-prog)"></div>
              </div>
              <span style="font-size:11px;color:var(--text-muted);min-width:32px">${specPct}%</span>
            </div>
          </td>
          <td>
            <div style="display:flex;align-items:center;gap:6px">
              <div class="sl-progress-bar" style="flex:1">
                <div class="sl-progress-fill" style="width:${spPct}%;background:${spColor}"></div>
              </div>
              <span style="font-size:11px;color:var(--text-muted);min-width:32px">${spPct}%</span>
            </div>
          </td>
        </tr>`;
    }).join('');

    main.innerHTML = `
      <div class="sl-dashboard">
        <h2 style="color:var(--accent);margin-top:0">📊 Speclinker Dashboard</h2>
        <div class="sl-summary-cards">${cards}</div>
        <table class="sl-domain-table">
          <thead><tr>
            <th style="text-align:left">도메인</th>
            <th>INF</th><th>UIS</th><th>SCH</th><th>BAT</th>
            <th>스펙완성도</th><th>개발완료율</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px">도메인 없음 — gen_docsify.py를 실행하세요</td></tr>'}</tbody>
        </table>
        <div style="margin-top:12px;font-size:11px;color:var(--text-muted)">
          생성: ${INDEX.generated_at} &nbsp;—&nbsp;
          <code>python scripts/gen_docsify.py .</code> 로 갱신
        </div>
      </div>`;
  }

  // ── INF / UIS 도메인 탭 뷰 ──────────────────────────────────
  function renderDomainView(domain, tab) {
    ACTIVE_DOMAIN = domain;
    ACTIVE_TAB = tab || 'inf';
    const main = document.getElementById('sl-main');
    if (!main || !INDEX) return;
    removeQuickNav();
    renderSidebar();

    const d = INDEX.domains[domain] || {};
    const tabs = ['inf', 'uis', 'sch', 'bat'].map(t =>
      `<div class="sl-tab ${ACTIVE_TAB === t ? 'active' : ''}"
            onclick="SlViewer.selectTab('${t}')">${t.toUpperCase()} ${d[t] || 0}</div>`
    ).join('');

    let body = '';
    if (ACTIVE_TAB === 'inf') {
      const infs = (INDEX.infs || []).filter(i => i.domain === domain);
      body = `<div class="sl-inf-list">${
        infs.length > 0
          ? infs.map(renderInfCard).join('')
          : '<div style="padding:16px;color:var(--text-muted)">INF 파일 없음</div>'
      }</div>`;
    } else if (ACTIVE_TAB === 'uis') {
      const uis = (INDEX.uis || []).filter(u => u.domain === domain);
      body = `<div class="sl-uis-grid">${
        uis.length > 0
          ? uis.map(renderUisCard).join('')
          : '<div style="padding:16px;color:var(--text-muted)">UIS 파일 없음</div>'
      }</div>`;
    } else {
      body = `<div style="padding:24px;color:var(--text-muted)">SCH/BAT 뷰 — 준비 중</div>`;
    }

    main.innerHTML = `
      <div class="sl-domain-header">
        <h3 style="color:var(--accent);margin:0 0 12px">${domain}</h3>
        <div class="sl-tabs">${tabs}</div>
      </div>
      ${body}`;
  }

  function renderInfCard(inf) {
    const colors = {
      GET: 'var(--method-get)',
      POST: 'var(--method-post)',
      PUT: 'var(--method-put)',
      DELETE: 'var(--method-delete)'
    };
    const bg = colors[inf.method] || '#555';
    return `
      <div class="sl-inf-card" onclick="SlViewer.openSpec('${escAttr(inf.file)}')">
        <span class="sl-method-badge" style="background:${bg}">${inf.method || '?'}</span>
        <span class="sl-inf-id">${inf.id}</span>
        <span class="sl-inf-path">${inf.path || ''}</span>
      </div>`;
  }

  function renderUisCard(ui) {
    const previewSrc = ui.file.replace('spec.md', 'preview.png');
    const preview = ui.has_preview
      ? `<img src="${previewSrc}" alt="preview" onerror="this.parentNode.innerHTML='🖥️'">`
      : '🖥️';
    return `
      <div class="sl-uis-card" onclick="SlViewer.openSpec('${escAttr(ui.file)}')">
        <div class="sl-uis-preview">${preview}</div>
        <div class="sl-uis-info">
          <div class="sl-uis-id">${ui.id}</div>
          <div class="sl-uis-name">${ui.name || '-'}</div>
          <div class="sl-uis-route">${ui.route || ''}</div>
        </div>
      </div>`;
  }

  // ── Quick Nav ────────────────────────────────────────────────
  function injectQuickNav() {
    removeQuickNav();
    const headings = document.querySelectorAll('.markdown-section h2, .markdown-section h3');
    if (headings.length < 2) return;

    const highlights = ['비즈니스 규칙', '트랜잭션 순서', '사이드이펙트'];
    const links = Array.from(headings).map(h => {
      const text = h.textContent.trim();
      const isHl = highlights.some(kw => text.includes(kw));
      const id = h.id || text;
      return `<a href="#${encodeURIComponent(id)}"
                 class="${isHl ? 'sl-hl' : ''}"
                 onclick="(function(id){var el=document.getElementById(id)||document.querySelector('[id]');if(el)el.scrollIntoView({behavior:'smooth'});}('${id}'));return false"
              >${text}</a>`;
    }).join('');

    const nav = document.createElement('div');
    nav.id = 'sl-quick-nav';
    nav.innerHTML = `<div class="sl-qnav-title">Quick Nav</div>${links}`;
    document.body.appendChild(nav);
    document.querySelector('.content')?.classList.add('has-qnav');
  }

  function removeQuickNav() {
    document.getElementById('sl-quick-nav')?.remove();
    document.querySelector('.content')?.classList.remove('has-qnav');
  }

  // ── 크로스링크 ────────────────────────────────────────────────
  function addCrosslinks() {
    const section = document.querySelector('.markdown-section');
    if (!section) return;
    const pattern = /\b(INF-[A-Z]+-\d+|UIS-F-\d+|SCH-[A-Z]+-\d+|FUNC-[a-z]+-\d+)\b/g;
    section.querySelectorAll('p, li, td').forEach(el => {
      if (el.querySelector('a, code, .sl-xlink')) return;
      const orig = el.innerHTML;
      const replaced = orig.replace(pattern, m =>
        `<span class="sl-xlink" onclick="SlViewer.goToId('${escAttr(m)}')" title="${escAttr(m)}로 이동">${m}</span>`
      );
      if (replaced !== orig) el.innerHTML = replaced;
    });
  }

  // ── 공개 API ──────────────────────────────────────────────────
  window.SlViewer = {
    showDashboard() {
      renderDashboard();
    },
    selectDomain(domain) {
      renderDomainView(domain, 'inf');
    },
    selectTab(tab) {
      renderDomainView(ACTIVE_DOMAIN, tab);
    },
    setSidebarMode(mode) {
      SIDEBAR_MODE = mode;
      renderSidebar();
    },
    openSpec(filePath) {
      window.location.hash = '#/' + filePath;
    },
    navigateToScreen(uisId) {
      const ui = INDEX && INDEX.uis && INDEX.uis.find(u => u.id === uisId);
      if (ui) this.openSpec(ui.file);
    },
    goToId(id) {
      if (!INDEX) return;
      const inf = INDEX.infs && INDEX.infs.find(i => i.id === id);
      if (inf) { this.openSpec(inf.file); return; }
      const ui = INDEX.uis && INDEX.uis.find(u => u.id === id);
      if (ui) this.openSpec(ui.file);
    },
  };

  // ── Docsify 플러그인 등록 ──────────────────────────────────────
  function SlPlugin(hook) {
    hook.mounted(function () {
      if (!document.getElementById('sl-sidebar')) {
        document.body.insertAdjacentHTML('afterbegin',
          '<div id="sl-sidebar"></div><div id="sl-main"></div>');
        loadIndex();
      }
    });

    hook.doneEach(function () {
      const hash = window.location.hash || '';
      if (hash.includes('/INF-') || hash.includes('/spec') || hash.includes('/UIS-') || hash.includes('/SCH-') || hash.includes('/BAT-') || hash.includes('/FUNC-')) {
        setTimeout(function () {
          injectQuickNav();
          addCrosslinks();
        }, 150);
      }
    });
  }

  window.$docsify = window.$docsify || {};
  window.$docsify.plugins = (window.$docsify.plugins || []).concat([SlPlugin]);
})();
