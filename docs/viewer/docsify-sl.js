/* docsify-sl.js — Speclinker Docsify 커스텀 플러그인 v1.0 */
(function () {
  'use strict';

  // ── 보안 헬퍼 ─────────────────────────────────────────────
  function escAttr(s) {
    return String(s || '').replace(/['"<>&]/g, function(c) {
      return {'\'': '&#39;', '"': '&quot;', '<': '&lt;', '>': '&gt;', '&': '&amp;'}[c];
    });
  }

  // ── 문서 베이스 경로 ────────────────────────────────────────
  // index.html은 /docs/viewer/ 에서 서빙되지만 문서·미리보기 이미지는
  // 프로젝트 루트 기준 경로(docs/05_설계서/...)다. docsify 라우팅은 basePath가
  // 처리하지만, <img> 같은 직접 리소스 참조는 이 BASE를 접두로 붙여야 한다.
  const DOC_BASE = location.pathname.replace(/docs\/viewer\/(index\.html)?$/, '');

  // ── 상태 ──────────────────────────────────────────────────
  let INDEX = null;
  let ACTIVE_DOMAIN = null;
  let ACTIVE_TAB = 'inf';
  let SIDEBAR_MODE = 'domain'; // 'domain' | 'ia'
  let DASH_SORT = { key: null, dir: -1 }; // 대시보드 도메인 테이블 정렬

  // ── 인덱스 로드 ────────────────────────────────────────────
  async function loadIndex() {
    try {
      const res = await fetch('spec_index.json?_=' + Date.now());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      INDEX = await res.json();
      renderSidebar();
      renderDashboard();
    } catch (e) {
      renderSidebar();  // 인덱스 없어도 사이드바(가이드 버튼)는 표시
      document.getElementById('sl-main').innerHTML =
        `<div style="padding:48px 40px;color:var(--text-muted);text-align:center">
          <div style="font-size:40px;margin-bottom:8px">📭</div>
          <h3 style="color:var(--accent);margin:0 0 8px">아직 표시할 산출물이 없습니다</h3>
          <p style="font-size:13px">RECON으로 INF·UIS·SCH를 생성한 뒤 인덱스를 갱신하세요:</p>
          <code>python scripts/gen_docsify.py .</code>
          <p style="margin-top:24px">
            <span class="sl-nav-link" style="display:inline-block;border:1px solid var(--accent);color:var(--accent);padding:7px 18px;border-radius:6px;cursor:pointer"
                  onclick="SlViewer.showGuide()">📖 사용자 가이드 보기</span>
          </p>
          <p style="font-size:11px;margin-top:20px;opacity:0.6">오류: ${escAttr(e.message)}</p>
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
      <div class="sl-logo">⚡ SpecLens</div>
      <div class="sl-search-wrap">
        <input id="sl-search" class="sl-search" type="text" placeholder="🔎 INF·화면·테이블·경로"
               oninput="SlViewer.search(this.value)" autocomplete="off">
        <div id="sl-search-results"></div>
      </div>
      <div>
        <span class="sl-nav-link" onclick="SlViewer.showGuide()">📖 사용자 가이드</span>
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
      `<div class="sl-domain-item ${ACTIVE_DOMAIN === name ? 'active' : ''}" role="button" tabindex="0"
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

  // ── 사용자 가이드 ────────────────────────────────────────────
  const GUIDE_VERSION = '3.1.0';

  const GUIDE_PIPELINES = [
    { icon: '🔍', title: '기존 코드 (RECON)',
      steps: ['sl-init', 'sl-recon', 'sl-recon-uis', '납품'],
      desc: '소스코드를 역분석해 설계서 추출' },
    { icon: '🔧', title: '변경·유지보수 (DELTA)',
      steps: ['sl-change', 'sl-aidd'],
      desc: '변경요청(SR) 영향분석→스펙수정→코드' },
    { icon: '⚙️', title: 'SDD 전체 파이프라인',
      steps: ['sl-recon', 'sl-ia', 'sl-context', 'sl-change', 'sl-aidd'],
      desc: '스펙 주도 개발(Spec-Driven) 풀 사이클' },
  ];

  const GUIDE_CATEGORIES = [
    { name: '시작 & 초기화', color: 'var(--accent)', cmds: [
      ['/sl-init', '프로젝트 초기화 — 디렉토리·환경 설정 + 소스 스캔 + 도메인 카탈로그 자동 생성', '제일 먼저 실행'],
    ]},
    { name: 'AIDD 자동개발', color: 'var(--status-done)', cmds: [
      ['/sl-aidd [FUNC-ID]', 'FUNC=story 단위 AIDD 루프 (story→승인→구현→QA게이트→테스트→커버리지)', 'FUNC_MAP.md'],
    ]},
    { name: '역분석 — RECON', color: 'var(--status-prog)', cmds: [
      ['/sl-recon', '소스코드 역분석 → 도메인 선택 → INF·SCH 명세 생성', 'project.env, 소스'],
      ['/sl-recon-uis', '메뉴진입 화면 캡처 → SOP급 UIS 생성(가이드형)', 'recon 후/독립'],
      ['/sl-recon-doc', 'INF 기반 추가 설계 문서 보강', 'INF 존재'],
      ['/sl-ia', 'IA(메뉴 계층) 문서 자동 생성 + UIS menu-path 보완', 'UIS 존재'],
    ]},
    { name: 'SDD 파이프라인', color: '#a371f7', cmds: [
      ['/sl-context', 'project-context.md 생성 — 프레임워크·공통패턴 학습', 'INF 존재'],
      ['/sl-status', '추적 통합 — 커버리지·진행·갭·게시 (--coverage/--next/--publish)', 'FUNC_MAP.md'],
      ['/sl-drift', '스펙-코드 드리프트 감지 — 소스 변경 vs INF 미갱신', 'git, INF'],
    ]},
    { name: '변경 관리 — DELTA', color: 'var(--status-review)', cmds: [
      ['/sl-change <SR-ID>', '변경 전주기(--full) — CIA→TO-BE diff→스펙동기화→RTM→승인 토큰', 'docs/05_설계서/'],
      ['/sl-change --quick "설명"', '소규모 경량 변경 (SR 없이 INF≤2 인라인 처리)', 'INF, context'],
    ]},
    { name: '개발 · 테스트', color: '#3fb950', cmds: [
      ['/sl-test', '테스트 케이스 작성 + 실행 → 결과 보고서', '06_소스코드/'],
    ]},
    { name: '뷰어', color: 'var(--accent)', cmds: [
      ['/sl-viewer [port]', 'SpecLens (이 웹 뷰어) 실행 (대시보드·INF/UIS/SCH·IA 트리)', 'docs/05_설계서/'],
    ]},
  ];

  const GUIDE_MODES = [
    ['RECON', '역분석', '기존 소스 → 설계서 역추출. 운영 중 시스템.', 'var(--status-prog)'],
    ['AIDD', '자동개발', 'FUNC 단위로 코드·테스트 자동 생성.', 'var(--status-done)'],
    ['DELTA', '변경', '변경요청(SR) → 영향분석 → 스펙수정 → 코드. 운영·유지보수.', 'var(--status-review)'],
  ];

  function renderGuide() {
    const main = document.getElementById('sl-main');
    if (!main) return;
    removeQuickNav();
    removeRelationPanel();
    document.getElementById('sl-breadcrumb')?.remove();
    ACTIVE_DOMAIN = null;
    renderSidebar();

    const pipes = GUIDE_PIPELINES.map(p => {
      const chain = p.steps.map((s, i) =>
        `<span class="sl-g-step">${s}</span>` +
        (i < p.steps.length - 1 ? '<span class="sl-g-arrow">→</span>' : '')
      ).join('');
      return `
        <div class="sl-g-pipe">
          <div class="sl-g-pipe-head"><span class="sl-g-pipe-icon">${p.icon}</span>${p.title}</div>
          <div class="sl-g-chain">${chain}</div>
          <div class="sl-g-pipe-desc">${p.desc}</div>
        </div>`;
    }).join('');

    const modes = GUIDE_MODES.map(([name, tag, desc, color]) => `
      <div class="sl-g-mode" style="border-left:3px solid ${color}">
        <div class="sl-g-mode-head"><span style="color:${color};font-weight:700">${name}</span>
          <span class="sl-g-mode-tag">${tag}</span></div>
        <div class="sl-g-mode-desc">${desc}</div>
      </div>`).join('');

    const cats = GUIDE_CATEGORIES.map(cat => {
      const rows = cat.cmds.map(([cmd, desc, pre]) => `
        <div class="sl-g-cmd">
          <div class="sl-g-cmd-name" style="color:${cat.color}">${cmd}</div>
          <div class="sl-g-cmd-desc">${desc}</div>
          <div class="sl-g-cmd-pre">${pre}</div>
        </div>`).join('');
      return `
        <div class="sl-g-cat">
          <div class="sl-g-cat-title" style="border-left:3px solid ${cat.color}">${cat.name}
            <span class="sl-g-cat-count">${cat.cmds.length}</span></div>
          <div class="sl-g-cmds">${rows}</div>
        </div>`;
    }).join('');

    main.innerHTML = `
      <div class="sl-guide">
        <div class="sl-g-hero">
          <div class="sl-g-hero-title">⚡ Speclinker 사용자 가이드</div>
          <div class="sl-g-hero-ver">v${GUIDE_VERSION}</div>
          <div class="sl-g-hero-sub">SI/ITO 개발 전주기 자동화 — 산출물과 소스코드를 FUNC-ID로 체이닝하는 스펙 주도 플러그인.
            Java Spring · Next.js 등 모든 스택 지원.</div>
        </div>

        <div class="sl-g-section-h">🚀 빠른 시작 — 상황별 파이프라인</div>
        <div class="sl-g-pipes">${pipes}</div>

        <div class="sl-g-section-h">📋 전체 명령어</div>
        <div class="sl-g-cats">${cats}</div>

        <div class="sl-g-section-h">🧭 동작 방식</div>
        <div class="sl-g-modes">${modes}</div>
        <div class="sl-g-note">
          <b>FUNC-ID 체이닝</b> — 모든 산출물(SRS·UIS·INF·SCH)과 소스코드가
          <code>FUNC-{도메인}-{NNN}</code>로 연결됩니다. <code>FUNC_MAP.md</code>가 단일 진실의 원천(SSoT).
          <br><b>추적 체인</b> — FUNC → SRS → UIS / INF / SCH / BAT → 코드(linked_func) → TC
        </div>

        <div class="sl-g-footer">
          명령어는 Claude Code 프롬프트에 <code>/sl-init</code> 처럼 입력합니다 ·
          전제 조건이 안 맞으면 안내 메시지가 출력됩니다 ·
          상세 라우팅은 플러그인 <code>CLAUDE.md</code> 참조
        </div>
      </div>`;
  }

  // ── 대시보드 ────────────────────────────────────────────────
  function renderDashboard() {
    const main = document.getElementById('sl-main');
    if (!main || !INDEX) return;
    removeQuickNav();
    removeRelationPanel();
    document.getElementById('sl-breadcrumb')?.remove();
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

    let staleNote = '';
    const gen = Date.parse((INDEX.generated_at || '').replace(' ', 'T'));
    if (gen && (Date.now() - gen) > 7 * 864e5) {
      staleNote = `<span style="color:var(--status-review)"> · ⚠ 인덱스가 오래되었습니다 — gen_docsify.py 재실행 권장</span>`;
    }

    const gapHtml = INDEX.gaps ? `
      <div class="sl-gap-bar">
        <span class="sl-gap-item ${INDEX.gaps.uis_no_inf ? 'warn' : ''}">화면-API 미연결 ${INDEX.gaps.uis_no_inf}</span>
        <span class="sl-gap-item ${INDEX.gaps.inf_no_sch ? 'warn' : ''}">API-테이블 미연결 ${INDEX.gaps.inf_no_sch}</span>
      </div>` : '';

    let domEntries = Object.entries(INDEX.domains);
    if (DASH_SORT.key) {
      const k = DASH_SORT.key;
      domEntries.sort((a, b) => {
        const va = (k === 'name') ? a[0] : (a[1][k] || 0);
        const vb = (k === 'name') ? b[0] : (b[1][k] || 0);
        return (va < vb ? -1 : va > vb ? 1 : 0) * DASH_SORT.dir;
      });
    }

    const rows = domEntries.map(([name, d]) => {
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
        <h2 style="color:var(--accent);margin-top:0">📊 SpecLens Dashboard</h2>
        <div class="sl-summary-cards">${cards}</div>
        ${gapHtml}
        <table class="sl-domain-table">
          <thead><tr>
            <th style="text-align:left" role="button" tabindex="0" onclick="SlViewer.sortDash('name')">도메인</th>
            <th role="button" tabindex="0" onclick="SlViewer.sortDash('inf')">INF</th>
            <th role="button" tabindex="0" onclick="SlViewer.sortDash('uis')">UIS</th>
            <th role="button" tabindex="0" onclick="SlViewer.sortDash('sch')">SCH</th>
            <th role="button" tabindex="0" onclick="SlViewer.sortDash('bat')">BAT</th>
            <th>스펙완성도</th><th>개발완료율</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px">도메인 없음 — gen_docsify.py를 실행하세요</td></tr>'}</tbody>
        </table>
        <div style="margin-top:12px;font-size:11px;color:var(--text-muted)">
          생성: ${INDEX.generated_at}${staleNote} &nbsp;—&nbsp;
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
    removeRelationPanel();
    document.getElementById('sl-breadcrumb')?.remove();
    renderSidebar();

    const d = INDEX.domains[domain] || {};
    const tabKeys = ['inf', 'uis', 'sch'].concat((d.bat || 0) > 0 ? ['bat'] : []);
    const tabs = tabKeys.map(t =>
      `<div class="sl-tab ${ACTIVE_TAB === t ? 'active' : ''}" role="button" tabindex="0"
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
    } else if (ACTIVE_TAB === 'sch') {
      const schs = (INDEX.schs || []).filter(s => s.domain === domain);
      body = `<div class="sl-inf-list">${
        schs.length > 0
          ? schs.map(renderSchCard).join('')
          : '<div style="padding:16px;color:var(--text-muted)">SCH 파일 없음</div>'
      }</div>`;
    } else {
      body = `<div style="padding:24px;color:var(--text-muted)">BAT 산출물 없음</div>`;
    }

    main.innerHTML = `
      <div class="sl-domain-header">
        <h3 style="color:var(--accent);margin:0 0 12px">${domain}</h3>
        <div class="sl-tabs">${tabs}</div>
      </div>
      ${body}`;
  }

  function renderSchCard(sch) {
    const infs = (sch.inf || []).join(', ');
    return `
      <div class="sl-inf-card" role="button" tabindex="0" onclick="SlViewer.openSpec('${escAttr(sch.file)}')">
        <span class="sl-method-badge" style="background:var(--status-done)">SCH</span>
        <span class="sl-inf-id">${sch.id}</span>
        <span class="sl-inf-path">${escAttr(sch.table || '')}${infs ? ' · ' + escAttr(infs) : ''}</span>
      </div>`;
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
      <div class="sl-inf-card" role="button" tabindex="0" onclick="SlViewer.openSpec('${escAttr(inf.file)}')">
        <span class="sl-method-badge" style="background:${bg}">${inf.method || '?'}</span>
        <span class="sl-inf-id">${inf.id}</span>
        ${inf.name ? `<span class="sl-inf-name">${escAttr(inf.name)}</span>` : ''}
        <span class="sl-inf-path">${inf.path || ''}</span>
        ${inf.anchor_count ? `<span class="sl-anchor" title="JIT 소스앵커 ${inf.anchor_count}개 — 변경 시 실소스 회귀 가능">⚓${inf.anchor_count}</span>` : ''}
      </div>`;
  }

  function renderUisCard(ui) {
    const previewSrc = DOC_BASE + ui.file.replace(/spec\.md$/, ui.preview || 'preview.png');
    const preview = ui.has_preview
      ? `<img src="${previewSrc}" alt="preview" onerror="this.parentNode.innerHTML='🖥️'">`
      : '🖥️';
    return `
      <div class="sl-uis-card" role="button" tabindex="0" onclick="SlViewer.openSpec('${escAttr(ui.file)}')">
        <div class="sl-uis-preview">${preview}</div>
        <div class="sl-uis-info">
          <div class="sl-uis-id">${ui.id}${ui.anchor_count ? ` <span class="sl-anchor" title="JIT 소스앵커 ${ui.anchor_count}개">⚓${ui.anchor_count}</span>` : ''}</div>
          <div class="sl-uis-name">${ui.name || '-'}</div>
          <div class="sl-uis-route">${ui.route || ''}</div>
          ${(ui.domain || (ui.inf_ids && ui.inf_ids.length)) ? `<div class="sl-uis-apis">${escAttr(ui.domain || '')}${ui.inf_ids && ui.inf_ids.length ? ` · 연결 API ${ui.inf_ids.length}` : ''}</div>` : ''}
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

  // ── 라우트 → 엔티티 해소 ──────────────────────────────────────
  function resolveCurrentEntity() {
    if (!INDEX) return null;
    const hash = decodeURIComponent(window.location.hash || '');
    const m = hash.match(/(INF-[A-Z]+-\d+|UIS-[A-Z]+-\d+(?:-T\d+)?|SCH-[A-Z]+-\d+|BAT-[A-Z]+-\d+)/);
    if (!m) return null;
    const id = m[1];
    const pools = [['inf', INDEX.infs], ['uis', INDEX.uis], ['sch', INDEX.schs]];
    for (const [type, pool] of pools) {
      const hit = (pool || []).find(x => x.id === id || id.startsWith(x.id));
      if (hit) return { type, id: hit.id, domain: hit.domain, name: hit.name, entity: hit };
    }
    return null;
  }

  // ── 브레드크럼 ────────────────────────────────────────────────
  function injectBreadcrumb() {
    document.getElementById('sl-breadcrumb')?.remove();
    const e = resolveCurrentEntity();
    if (!e) return;
    const bc = document.createElement('div');
    bc.id = 'sl-breadcrumb';
    bc.innerHTML =
      `<span class="sl-bc-link" role="button" tabindex="0" onclick="SlViewer.showDashboard()">🏠 대시보드</span>` +
      `<span class="sl-bc-sep">›</span>` +
      `<span class="sl-bc-link" role="button" tabindex="0" onclick="SlViewer.selectDomain('${escAttr(e.domain || '')}')">${escAttr(e.domain || '-')}</span>` +
      `<span class="sl-bc-sep">›</span><span class="sl-bc-type">${e.type.toUpperCase()}</span>` +
      `<span class="sl-bc-sep">›</span><span class="sl-bc-cur">${escAttr(e.id)}</span>` +
      `<span class="sl-bc-back" role="button" tabindex="0" onclick="SlViewer.selectDomain('${escAttr(e.domain || '')}')">← 도메인</span>`;
    const section = document.querySelector('.markdown-section');
    if (section) section.insertAdjacentElement('beforebegin', bc);
  }

  // ── 연결관계 패널 (INF/UIS/SCH 공통) ──────────────────────────
  function chip(id, label, kind) {
    return `<span class="sl-rel-chip sl-rel-${kind}" role="button" tabindex="0"
             onclick="SlViewer.goToId('${escAttr(id)}')">${escAttr(label || id)}</span>`;
  }

  function relSection(title, html) {
    if (!html) return '';
    return `<div class="sl-rel-label">${title}</div><div class="sl-rel-body">${html}</div>`;
  }

  function injectRelationPanel() {
    removeRelationPanel();
    const e = resolveCurrentEntity();
    if (!e || !INDEX) return;
    const en = e.entity;
    let sections = '';
    if (e.type === 'uis') {
      const infIds = en.inf_ids || [];
      const apis = infIds.map(id => {
        const inf = (INDEX.infs || []).find(i => i.id === id) || { id };
        const badge = inf.method ? `<span class="sl-rel-m">${escAttr(inf.method)}</span>` : '';
        return `<div class="sl-rel-row" role="button" tabindex="0" onclick="SlViewer.goToId('${escAttr(id)}')">${badge}${escAttr(id)} ${escAttr(inf.name || '')}</div>`;
      }).join('');
      const schIds = [...new Set(infIds.flatMap(id => ((INDEX.infs || []).find(i => i.id === id) || {}).sch_ids || []))];
      sections += relSection('호출 API (' + infIds.length + ')', apis);
      sections += relSection('관련 테이블 (' + schIds.length + ')', schIds.map(s => chip(s, ((INDEX.schs || []).find(x => x.id === s) || {}).table || s, 'sch')).join(''));
    } else if (e.type === 'inf') {
      const schIds = en.sch_ids || [];
      const usedBy = (INDEX.uis || []).filter(u => (u.inf_ids || []).includes(en.id));
      sections += relSection('관련 테이블 (' + schIds.length + ')', schIds.map(s => chip(s, ((INDEX.schs || []).find(x => x.id === s) || {}).table || s, 'sch')).join(''));
      sections += relSection('사용 화면 (' + usedBy.length + ')', usedBy.map(u => chip(u.id, u.id, 'uis')).join(''));
    } else if (e.type === 'sch') {
      const infIds = en.inf || [];
      sections += relSection('참조 API (' + infIds.length + ')', infIds.map(i => chip(i, i, 'inf')).join(''));
    }
    if (en.func) sections += relSection('linked FUNC', chip(en.func, en.func, 'func'));
    if (!sections) return;
    const panel = document.createElement('div');
    panel.id = 'sl-rel-panel';
    panel.innerHTML = `<div class="sl-rel-title">🔗 연결관계</div>${sections}`;
    document.body.appendChild(panel);
    document.querySelector('.content')?.classList.add('has-relpanel');
  }

  function removeRelationPanel() {
    document.getElementById('sl-rel-panel')?.remove();
    document.querySelector('.content')?.classList.remove('has-relpanel');
  }

  // ── UIS 미리보기 라이트박스 ────────────────────────────────────
  function openLightbox(src) {
    document.getElementById('sl-lightbox')?.remove();
    const lb = document.createElement('div');
    lb.id = 'sl-lightbox';
    lb.innerHTML = `<img src="${escAttr(src)}" alt="확대"><div class="sl-lb-close" role="button" tabindex="0">✕ 닫기 (ESC)</div>`;
    lb.onclick = () => lb.remove();
    document.body.appendChild(lb);
    const onEsc = (ev) => { if (ev.key === 'Escape') { lb.remove(); document.removeEventListener('keydown', onEsc); } };
    document.addEventListener('keydown', onEsc);
  }

  function enhanceImages() {
    const e = resolveCurrentEntity();
    if (!e || e.type !== 'uis') return;
    document.querySelectorAll('.markdown-section img').forEach(img => {
      if (img.dataset.slLb) return;
      img.dataset.slLb = '1';
      img.classList.add('sl-zoomable');
      img.title = '클릭하면 확대';
      img.addEventListener('click', () => openLightbox(img.src));
    });
  }

  // ── 공개 API ──────────────────────────────────────────────────
  window.SlViewer = {
    showGuide() {
      renderGuide();
    },
    showDashboard() {
      renderDashboard();
    },
    sortDash(key) {
      if (DASH_SORT.key === key) DASH_SORT.dir *= -1;
      else { DASH_SORT.key = key; DASH_SORT.dir = -1; }
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
    toggleSidebar() {
      document.body.classList.toggle('sl-sidebar-hidden');
    },
    openSpec(filePath) {
      window.location.hash = '#/' + filePath;
    },
    navigateToScreen(uisId) {
      const ui = INDEX && INDEX.uis && INDEX.uis.find(u => u.id === uisId);
      if (ui) this.openSpec(ui.file);
    },
    search(q) {
      const box = document.getElementById('sl-search-results');
      if (!box || !INDEX) return;
      q = (q || '').trim().toLowerCase();
      if (q.length < 2) { box.innerHTML = ''; return; }
      const hit = (arr, type) => (arr || []).filter(x =>
        (x.id && x.id.toLowerCase().includes(q)) ||
        (x.name && x.name.toLowerCase().includes(q)) ||
        (x.path && x.path.toLowerCase().includes(q)) ||
        (x.table && x.table.toLowerCase().includes(q)) ||
        (x.route && x.route.toLowerCase().includes(q))
      ).slice(0, 8).map(x => ({ x, type }));
      const results = [...hit(INDEX.infs, 'INF'), ...hit(INDEX.uis, 'UIS'), ...hit(INDEX.schs, 'SCH')].slice(0, 12);
      box.innerHTML = results.length
        ? results.map(r => `<div class="sl-sr-item" role="button" tabindex="0" onclick="SlViewer.goToId('${escAttr(r.x.id)}')">
             <span class="sl-sr-type">${r.type}</span> ${escAttr(r.x.id)} <span class="sl-sr-name">${escAttr(r.x.name || r.x.table || r.x.route || '')}</span></div>`).join('')
        : '<div class="sl-sr-empty">결과 없음</div>';
    },
    goToId(id) {
      if (!INDEX) return;
      const inf = INDEX.infs && INDEX.infs.find(i => i.id === id);
      if (inf) { this.openSpec(inf.file); return; }
      const sch = INDEX.schs && INDEX.schs.find(s => s.id === id);
      if (sch) { this.openSpec(sch.file); return; }
      const ui = INDEX.uis && INDEX.uis.find(u => u.id === id);
      if (ui) this.openSpec(ui.file);
    },
  };

  // ── Docsify 플러그인 등록 ──────────────────────────────────────
  function SlPlugin(hook, vm) {
    // 이미지 경로 재작성: spec.md 안의 ![[x]](Obsidian) 및 상대 ![](x) 를
    // 현재 문서 디렉토리 기준 경로로 변환 → 화면당 디렉토리/tabs 자산이 렌더된다.
    hook.beforeEach(function (content) {
      var file = (vm && vm.route && vm.route.file) || '';
      var dir = file.replace(/[^/]*$/, '');   // 파일명 제거 → 문서 디렉토리(루트 기준)
      if (!dir) return content;
      // ![[file.png]] → ![](dir/file.png)
      content = content.replace(/!\[\[([^\]]+)\]\]/g, function (_, p) {
        return '![](' + dir + p.trim() + ')';
      });
      // 상대 ![](x) (http/절대 제외) → ![](dir/x)
      content = content.replace(/!\[([^\]]*)\]\((?!https?:|\/|data:)([^)]+)\)/g, function (_, alt, src) {
        return '![' + alt + '](' + dir + src.trim() + ')';
      });
      return content;
    });

    hook.mounted(function () {
      if (!document.getElementById('sl-sidebar')) {
        document.body.insertAdjacentHTML('afterbegin',
          '<div id="sl-burger" role="button" tabindex="0" title="사이드바 토글" onclick="SlViewer.toggleSidebar()">☰</div>' +
          '<div id="sl-sidebar"></div><div id="sl-main"></div>');
        // 키보드 접근성: role=button 요소를 Enter/Space로 활성화
        document.addEventListener('keydown', function (ev) {
          if ((ev.key === 'Enter' || ev.key === ' ') && ev.target && ev.target.getAttribute('role') === 'button') {
            ev.preventDefault();
            ev.target.click();
          }
        });
        loadIndex();
      }
    });

    hook.doneEach(function () {
      const hash = window.location.hash || '';
      if (hash.includes('/INF-') || hash.includes('/spec') || hash.includes('/UIS-') || hash.includes('/SCH-') || hash.includes('/BAT-') || hash.includes('/FUNC-')) {
        setTimeout(function () {
          injectBreadcrumb();
          injectRelationPanel();
          injectQuickNav();
          addCrosslinks();
          enhanceImages();
        }, 150);
      }
    });
  }

  window.$docsify = window.$docsify || {};
  window.$docsify.plugins = (window.$docsify.plugins || []).concat([SlPlugin]);
})();
