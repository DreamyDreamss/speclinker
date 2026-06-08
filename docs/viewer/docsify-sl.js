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

  // ── SR 작업보드 상태 ──────────────────────────────────────
  // window.__slBoard(데이터)·window.__slStatus(진행)·window.__slQueue(버튼→세션)는
  // /sl-viewer 세션이 CDP로 주입/폴링한다. 세션 없으면 sr_board.json 정적 폴백.
  let BOARD_VIEW = false;            // 보드 뷰 활성 여부
  let BOARD_FILTER = { q: '', prio: '', col: '' };
  let BOARD_TIMER = null;           // 보드 활성 중 재렌더 틱
  let BOARD_SIG = '';               // 변동 감지용 시그니처
  window.__slQueue = window.__slQueue || [];

  // ── 인덱스 로드 ────────────────────────────────────────────
  async function loadIndex() {
    try {
      const res = await fetch('spec_index.json?_=' + Date.now());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      INDEX = await res.json();
      renderSidebar();
      // 직접 문서 URL(#/docs/...)로 진입한 경우엔 대시보드로 덮어쓰지 않고 그 문서를 보여준다.
      const hash = window.location.hash || '';
      const isDocRoute = /#\/.+\.md|#\/docs\//.test(hash) || resolveCurrentEntity();
      if (isDocRoute) {
        document.body.classList.remove('sl-custom-view');
        setTimeout(function () { injectBreadcrumb(); injectRelationPanel(); addCrosslinks(); enhanceImages(); }, 100);
      } else {
        renderDashboard();
      }
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
        <span class="sl-nav-link sl-nav-board" onclick="SlViewer.showBoard()">📋 SR 작업보드${boardBadge()}</span>
        <a class="sl-nav-link" href="#/docs/00_FUNC/FUNC_MAP">🗂 FUNC_MAP</a>
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
    if (!INDEX) return '<div class="sl-tree-empty">로딩 중...</div>';
    const entries = Object.entries(INDEX.domains);
    if (!entries.length) return '<div class="sl-tree-empty">도메인 없음</div>';
    return entries.map(([name, info]) =>
      `<div class="sl-domain-item ${ACTIVE_DOMAIN === name ? 'active' : ''}" role="button" tabindex="0"
            onclick="SlViewer.selectDomain('${escAttr(name)}')">
        <span class="sl-di-name">${name}</span>
        <span class="sl-di-counts"><span style="color:var(--c-inf)">⬡${info.inf || 0}</span> <span style="color:var(--c-uis)">▭${info.uis || 0}</span> <span style="color:var(--c-sch)">⛁${info.sch || 0}</span> <span style="color:var(--c-srs)">✎${info.srs_count || 0}</span></span>
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
      ['/sl-test', '테스트 케이스 작성 + 실행 → 결과 보고서', '실제 소스 트리'],
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
    document.body.classList.add('sl-custom-view');
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
    document.body.classList.add('sl-custom-view');
    ACTIVE_DOMAIN = null;
    renderSidebar();

    const t = INDEX.totals;
    const srsN = (INDEX.srs || []).length;
    const stat = (label, num, color) =>
      `<div class="sl-stat"><div class="sl-stat-label">${label}</div><div class="sl-stat-num" style="color:${color}">${(num || 0).toLocaleString()}</div></div>`;
    const stats = stat('INTERFACE', t.inf, 'var(--c-inf)') + stat('SCHEMA', t.sch, 'var(--c-sch)') +
                  stat('화면 UIS', t.uis, 'var(--c-uis)') + stat('기능 SRS', srsN, 'var(--c-srs)');

    let staleNote = '';
    const gen = Date.parse((INDEX.generated_at || '').replace(' ', 'T'));
    if (gen && (Date.now() - gen) > 7 * 864e5) {
      staleNote = `<span style="color:var(--status-review)"> · ⚠ 인덱스가 오래됨 — gen_docsify.py 재실행 권장</span>`;
    }

    const gapHtml = INDEX.gaps ? `
      <div class="sl-gap-bar">
        <span class="sl-gap-item ${INDEX.gaps.uis_no_inf ? 'warn' : ''}">화면-API 미연결 ${INDEX.gaps.uis_no_inf}</span>
        <span class="sl-gap-item ${INDEX.gaps.inf_no_sch ? 'warn' : ''}">API-테이블 미연결 ${INDEX.gaps.inf_no_sch}</span>
      </div>` : '';

    // 완성도 내림차순 정렬(낮은 도메인이 먼저 눈에 띄도록은 옵션 — 우선 완성도 높은 순)
    const pctOf = d => { const i = d.inf || 0, tb = d.tbd_total || 0; return i > 0 ? Math.round((i - Math.min(tb, i)) / i * 100) : 0; };
    const domEntries = Object.entries(INDEX.domains).sort((a, b) => pctOf(b[1]) - pctOf(a[1]));

    const ringCards = domEntries.map(([name, d]) => {
      const pct = pctOf(d);
      const col = pct >= 70 ? 'var(--c-sch)' : pct >= 40 ? 'var(--accent)' : 'var(--status-review)';
      const counts = [['⬡', d.inf || 0, 'var(--c-inf)'], ['▭', d.uis || 0, 'var(--c-uis)'],
                      ['⛁', d.sch || 0, 'var(--c-sch)'], ['◆', d.srs_count || 0, 'var(--c-srs)']]
        .map(([ic, n, c]) => `<span style="color:${c}">${ic} ${n}</span>`).join('<span class="sl-dot">·</span>');
      const warn = (d.uis || 0) === 0 ? '<span class="sl-dom-warn">⚠ 화면 0</span>' : '';
      return `
        <div class="sl-dom-card" role="button" tabindex="0" onclick="SlViewer.selectDomain('${escAttr(name)}')">
          <div class="sl-ring" style="background:conic-gradient(${col} 0 ${pct}%, var(--border) ${pct}% 100%)">
            <div class="sl-ring-hole">${pct}%</div>
          </div>
          <div class="sl-dom-meta">
            <div class="sl-dom-name">${name}</div>
            <div class="sl-dom-counts">${counts}</div>
            <div class="sl-dom-pct">스펙 완성도 <span style="color:${col}">${pct}%</span>${warn}</div>
          </div>
        </div>`;
    }).join('');

    main.innerHTML = `
      <div class="sl-dashboard">
        <div class="sl-dash-head">
          <div class="sl-dash-title">RECON 산출물 개요</div>
          <div class="sl-dash-sub">생성 ${INDEX.generated_at}${staleNote}</div>
        </div>
        <div class="sl-stats">${stats}</div>
        ${gapHtml}
        <div class="sl-section-h2">도메인</div>
        <div class="sl-dom-grid">${ringCards || '<div style="color:var(--text-muted)">도메인 없음 — gen_docsify.py 실행</div>'}</div>
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
    document.body.classList.add('sl-custom-view');
    renderSidebar();

    const d = INDEX.domains[domain] || {};
    const tabKeys = ['inf', 'uis', 'sch']
      .concat((d.bat || 0) > 0 ? ['bat'] : [])
      .concat((d.srs_count || 0) > 0 ? ['srs'] : []);
    const tabCount = (t) => t === 'srs' ? (d.srs_count || 0) : (d[t] || 0);
    const tabLabel = (t) => t === 'srs' ? '기능명세' : t.toUpperCase();
    const tabs = tabKeys.map(t =>
      `<div class="sl-tab ${ACTIVE_TAB === t ? 'active' : ''}" role="button" tabindex="0"
            onclick="SlViewer.selectTab('${t}')">${tabLabel(t)} ${tabCount(t)}</div>`
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
    } else if (ACTIVE_TAB === 'srs') {
      const srs = (INDEX.srs || []).filter(s => s.domain === domain);
      body = `<div class="sl-inf-list">${
        srs.length > 0
          ? srs.map(renderSrsCard).join('')
          : '<div style="padding:16px;color:var(--text-muted)">SRS 없음</div>'
      }</div>`;
    } else {
      body = `<div style="padding:24px;color:var(--text-muted)">BAT 산출물 없음</div>`;
    }

    main.innerHTML = `
      <div class="sl-domain-header">
        <h3 class="sl-dom-h3">${domain}${d.overview ? ` <span class="sl-ov-link" role="button" tabindex="0" onclick="SlViewer.openSpec('${escAttr(d.overview)}')">📖 도메인 개요</span>` : ''}</h3>
        <div class="sl-tabs">${tabs}</div>
      </div>
      <div class="sl-list-filter">
        <input class="sl-filter-input" type="text" placeholder="🔎 이 목록에서 필터 (ID·이름·경로)" oninput="SlViewer.filterList(this.value)" autocomplete="off">
        <span class="sl-list-count" id="sl-list-count"></span>
      </div>
      ${body}`;
    SlViewer.filterList('');
    window.scrollTo(0, 0);   // 도메인 전환 시 항상 최상단부터 보이게 (이전 스크롤 위치 잔존 방지)
  }

  function _cardSearch(parts) { return escAttr(parts.filter(Boolean).join(' ').toLowerCase()); }

  function renderSrsCard(sr) {
    const meta = [sr.uis && sr.uis.length ? '화면 ' + sr.uis.length : '', sr.inf && sr.inf.length ? 'API ' + sr.inf.length : '']
      .filter(Boolean).join(' · ');
    return `
      <div class="sl-inf-card" role="button" tabindex="0" data-search="${_cardSearch([sr.id, sr.name])}" onclick="SlViewer.openSpec('${escAttr(sr.file)}')">
        <span class="sl-method-badge" style="background:var(--c-srs)">SRS</span>
        <span class="sl-inf-id">${sr.id}</span>
        ${sr.name ? `<span class="sl-inf-name">${escAttr(sr.name)}</span>` : ''}
        <span class="sl-inf-path">${escAttr(meta)}</span>
      </div>`;
  }

  function renderSchCard(sch) {
    const infs = (sch.inf || []).join(', ');
    return `
      <div class="sl-inf-card" role="button" tabindex="0" data-search="${_cardSearch([sch.id, sch.table, infs])}" onclick="SlViewer.openSpec('${escAttr(sch.file)}')">
        <span class="sl-method-badge" style="background:var(--c-sch)">SCH</span>
        <span class="sl-inf-id">${sch.id}</span>
        <span class="sl-inf-name">${escAttr(sch.table || '')}</span>
        <span class="sl-inf-path">${infs ? escAttr(infs) : ''}</span>
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
    const schN = (inf.sch_ids || []).length;
    return `
      <div class="sl-inf-card" role="button" tabindex="0" data-search="${_cardSearch([inf.id, inf.name, inf.path, inf.method])}" onclick="SlViewer.openSpec('${escAttr(inf.file)}')">
        <span class="sl-method-badge" style="background:${bg}">${inf.method || '?'}</span>
        <span class="sl-inf-id">${inf.id}</span>
        ${inf.name ? `<span class="sl-inf-name">${escAttr(inf.name)}</span>` : ''}
        <span class="sl-inf-path">${inf.path || ''}</span>
        ${schN ? `<span class="sl-badge-tbl" title="연결 테이블 ${schN}">⛁${schN}</span>` : ''}
        ${inf.anchor_count ? `<span class="sl-anchor" title="JIT 소스앵커 ${inf.anchor_count}개">⚓${inf.anchor_count}</span>` : ''}
      </div>`;
  }

  function renderUisCard(ui) {
    const previewSrc = DOC_BASE + ui.file.replace(/spec\.md$/, ui.preview || 'preview.png');
    const preview = ui.has_preview
      ? `<img src="${previewSrc}" alt="preview" onerror="this.parentNode.innerHTML='🖥️'">`
      : '🖥️';
    return `
      <div class="sl-uis-card" role="button" tabindex="0" data-search="${_cardSearch([ui.id, ui.name, ui.route])}" onclick="SlViewer.openSpec('${escAttr(ui.file)}')">
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
  // 테이블명 → SCH 매핑 (INF 본문의 테이블 코드를 SCH로 점프)
  let _tableMap = null, _tableRe = null;
  function _buildTableLinker() {
    if (_tableMap) return;
    _tableMap = {};
    (INDEX && INDEX.schs || []).forEach(s => { if (s.table) _tableMap[s.table] = s.id; });
    const names = Object.keys(_tableMap)
      .filter(n => n.length >= 3)
      .sort((a, b) => b.length - a.length)
      .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    _tableRe = names.length ? new RegExp('\\b(' + names.join('|') + ')\\b', 'g') : null;
  }

  function addCrosslinks() {
    const section = document.querySelector('.markdown-section');
    if (!section) return;
    _buildTableLinker();
    const pattern = /\b(INF-[A-Z]+-\d+|UIS-[A-Z]+-\d+(?:-T\d+)?|SCH-[A-Z]+-\d+|FUNC-[A-Za-z]+-\d+|SRS-F-\d+)\b/g;
    section.querySelectorAll('p, li, td').forEach(el => {
      if (el.querySelector('a, code, .sl-xlink')) return;
      const orig = el.innerHTML;
      let replaced = orig.replace(pattern, m =>
        `<span class="sl-xlink" onclick="SlViewer.goToId('${escAttr(m)}')" title="${escAttr(m)}로 이동">${m}</span>`
      );
      // 테이블명 → SCH (ID 치환 후. 테이블명은 ID 스팬 내부에 나타나지 않아 안전)
      if (_tableRe) {
        replaced = replaced.replace(_tableRe, m => {
          const sid = _tableMap[m];
          return sid ? `<span class="sl-xlink sl-xlink-tbl" onclick="SlViewer.goToId('${escAttr(sid)}')" title="${escAttr(sid)} (${escAttr(m)})로 이동">${m}</span>` : m;
        });
      }
      if (replaced !== orig) el.innerHTML = replaced;
    });
  }

  // ── 라우트 → 엔티티 해소 ──────────────────────────────────────
  function resolveCurrentEntity() {
    if (!INDEX) return null;
    const hash = decodeURIComponent(window.location.hash || '');
    const m = hash.match(/(INF-[A-Z]+-\d+|UIS-[A-Z]+-\d+(?:-T\d+)?|SCH-[A-Z]+-\d+|BAT-[A-Z]+-\d+|FUNC-[A-Za-z]+-\d+|SRS-F-\d+)/);
    if (!m) return null;
    const id = m[1];
    const pools = [['inf', INDEX.infs], ['uis', INDEX.uis], ['sch', INDEX.schs], ['func', INDEX.funcs], ['srs', INDEX.srs]];
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
    } else if (e.type === 'srs') {
      sections += relSection('화면 (' + (en.uis || []).length + ')', (en.uis || []).map(u => chip(u, u, 'uis')).join(''));
      sections += relSection('호출 API (' + (en.inf || []).length + ')', (en.inf || []).map(i => chip(i, i, 'inf')).join(''));
    }
    // UIS 상세: 이 화면을 다루는 기능명세(SRS)
    if (e.type === 'uis') {
      const relSrs = (INDEX.srs || []).filter(s => (s.uis || []).includes(en.id));
      if (relSrs.length) sections += relSection('기능명세 (' + relSrs.length + ')', relSrs.map(s => chip(s.id, s.id, 'srs')).join(''));
    }
    if (en.func) sections += relSection('linked FUNC', chip(en.func, en.func, 'func'));
    if (!sections) return;
    const panel = document.createElement('div');
    panel.id = 'sl-rel-panel';
    panel.innerHTML = `<div class="sl-rel-title">🔗 연결관계
        <span class="sl-graph-btn" role="button" tabindex="0" onclick="SlViewer.openGraph('${escAttr(e.id)}')">🕸 그래프</span>
        <span class="sl-regen-btn" role="button" tabindex="0" title="이 ${escAttr(e.type.toUpperCase())}만 재생성 (speclinker 명령 실행 — /sl-viewer 세션 필요)" onclick="SlViewer.regenSpec('${escAttr(e.id)}','${escAttr(e.type)}')">🔄 재생성</span>
      </div>${sections}`;
    document.body.appendChild(panel);
    document.querySelector('.content')?.classList.add('has-relpanel');
  }

  function removeRelationPanel() {
    document.getElementById('sl-rel-panel')?.remove();
    document.querySelector('.content')?.classList.remove('has-relpanel');
  }

  // ── 스펙 연결 그래프 (시작점 N-hop, mermaid) ──────────────────
  function _safeNode(id) { return 'n_' + String(id).replace(/[^A-Za-z0-9]/g, '_'); }

  function _neighbors(id) {
    if (!INDEX) return [];
    const out = [];
    const push = (x, t) => { if (x) out.push({ id: x, type: t }); };
    const uis = (INDEX.uis || []).find(u => u.id === id);
    if (uis) { (uis.inf_ids || []).forEach(i => push(i, 'inf')); if (uis.func) push(uis.func, 'func'); }
    const inf = (INDEX.infs || []).find(i => i.id === id);
    if (inf) {
      (inf.sch_ids || []).forEach(s => push(s, 'sch'));
      (INDEX.uis || []).filter(u => (u.inf_ids || []).includes(id)).forEach(u => push(u.id, 'uis'));
      if (inf.func) push(inf.func, 'func');
    }
    const sch = (INDEX.schs || []).find(s => s.id === id);
    if (sch) { (sch.inf || []).forEach(i => push(i, 'inf')); if (sch.func) push(sch.func, 'func'); }
    const fn = (INDEX.funcs || []).find(f => f.id === id);
    if (fn) { (fn.uis || []).forEach(u => push(u, 'uis')); (fn.inf || []).forEach(i => push(i, 'inf')); (fn.sch || []).forEach(s => push(s, 'sch')); }
    const sr = (INDEX.srs || []).find(s => s.id === id);
    if (sr) { (sr.uis || []).forEach(u => push(u, 'uis')); (sr.inf || []).forEach(i => push(i, 'inf')); if (sr.func) push(sr.func, 'func'); }
    // 역방향: 이 화면을 use-case로 다루는 SRS
    if (uis) (INDEX.srs || []).filter(s => (s.uis || []).includes(id)).forEach(s => push(s.id, 'srs'));
    return out;
  }

  function _typeOf(id) {
    if (/^UIS-/.test(id)) return 'uis';
    if (/^INF-/.test(id)) return 'inf';
    if (/^SCH-/.test(id)) return 'sch';
    if (/^FUNC-/i.test(id)) return 'func';
    if (/^SRS-/.test(id)) return 'srs';
    return 'x';
  }

  function _graphLabel(id) {
    const pools = [INDEX.uis, INDEX.infs, INDEX.schs, INDEX.funcs, INDEX.srs];
    for (const p of pools) {
      const hit = (p || []).find(x => x.id === id);
      if (hit) { const nm = hit.name || hit.table || ''; return nm ? id + '\\n' + nm : id; }
    }
    return id;
  }

  function buildSpecGraph(startId, depth) {
    const seen = new Set([startId]);
    const edges = [];
    let frontier = [startId];
    for (let d = 0; d < depth; d++) {
      const next = [];
      frontier.forEach(cur => {
        _neighbors(cur).forEach(nb => {
          edges.push([cur, nb.id]);
          if (!seen.has(nb.id)) { seen.add(nb.id); next.push(nb.id); }
        });
      });
      frontier = next;
    }
    const lines = ['graph LR'];
    seen.forEach(id => {
      lines.push(`  ${_safeNode(id)}["${_graphLabel(id)}"]:::${_typeOf(id)}`);
      lines.push(`  click ${_safeNode(id)} call slGraphClick("${id}")`);
    });
    const eseen = new Set();
    edges.forEach(([a, b]) => {
      const k = a + '>' + b, rk = b + '>' + a;
      if (eseen.has(k) || eseen.has(rk)) return;
      eseen.add(k);
      lines.push(`  ${_safeNode(a)} --- ${_safeNode(b)}`);
    });
    lines.push('classDef uis fill:#2b2410,stroke:#d4a574,color:#d4a574;');
    lines.push('classDef inf fill:#10243b,stroke:#58a6ff,color:#58a6ff;');
    lines.push('classDef sch fill:#0f2a16,stroke:#3fb950,color:#3fb950;');
    lines.push('classDef func fill:#2b2410,stroke:#d4a574,color:#d4a574;');
    lines.push('classDef srs fill:#1b1030,stroke:#a371f7,color:#a371f7;');
    return { def: lines.join('\n'), count: seen.size };
  }

  let GRAPH_START = null, GRAPH_DEPTH = 2;
  async function openGraph(startId) {
    GRAPH_START = startId;
    document.getElementById('sl-graph')?.remove();
    const { def, count } = buildSpecGraph(startId, GRAPH_DEPTH);
    const ov = document.createElement('div');
    ov.id = 'sl-graph';
    ov.innerHTML =
      `<div class="sl-graph-bar">
         <span>🕸 ${escAttr(startId)} — ${count} 노드 (깊이 ${GRAPH_DEPTH})</span>
         <span class="sl-graph-ctl">깊이
           <button onclick="SlViewer.graphDepth(1)">1</button>
           <button onclick="SlViewer.graphDepth(2)">2</button>
           <button onclick="SlViewer.graphDepth(3)">3</button>
           <span class="sl-graph-close" role="button" tabindex="0" onclick="document.getElementById('sl-graph').remove()">✕ 닫기 (ESC)</span>
         </span>
       </div>
       <div class="sl-graph-body">${count > 60 ? '<p style="color:var(--status-review)">노드가 많습니다 — 깊이를 줄이세요.</p>' : ''}<div class="mermaid" id="sl-graph-mermaid"></div></div>`;
    document.body.appendChild(ov);
    const onEsc = (ev) => { if (ev.key === 'Escape') { ov.remove(); document.removeEventListener('keydown', onEsc); } };
    document.addEventListener('keydown', onEsc);
    try {
      window.mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'dark' });
      const { svg } = await window.mermaid.render('sl-graph-svg', def);
      document.getElementById('sl-graph-mermaid').innerHTML = svg;
    } catch (e) {
      document.getElementById('sl-graph-mermaid').innerHTML = '<pre style="color:var(--text-muted)">' + escAttr(def) + '</pre>';
    }
  }

  window.slGraphClick = function (id) {
    document.getElementById('sl-graph')?.remove();
    window.SlViewer.goToId(id);
  };

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

  // ── SR 작업보드 ────────────────────────────────────────────
  const BOARD_COLS = [
    { key: 'todo',     label: '대기', match: ['to do', 'todo', 'open', 'backlog', '신규', '접수', '대기'] },
    { key: 'analyze',  label: '분석', match: ['analysis', '분석', 'triage'] },
    { key: 'progress', label: '진행', match: ['progress', 'development', 'doing', '구현', '진행'] },
    { key: 'review',   label: '검토', match: ['review', 'qa', 'test', '검토', '테스트'] },
    { key: 'done',     label: '완료', match: ['done', 'closed', 'resolved', '완료', '종료'] },
  ];
  const PRIO_META = {
    highest: ['🔺', '#f85149'], high: ['🔴', '#f85149'], medium: ['🟠', '#e6c79c'],
    low: ['🟢', '#52c489'], lowest: ['⚪', '#6e7681'],
  };
  const WORK_COLOR = {
    '분석중': '#7aa2ff', '승인대기': '#e6c79c', '구현중': '#7aa2ff',
    'QA': '#c79bf0', '완료': '#52c489', '실패': '#f85149',
  };

  function getBoard()  { return (window.__slBoard && Array.isArray(window.__slBoard.srs)) ? window.__slBoard : null; }
  function getStatus() { return window.__slStatus || {}; }
  function boardColOf(status) {
    const s = String(status || '').toLowerCase();
    for (const c of BOARD_COLS) if (c.match.some(m => s.includes(m))) return c.key;
    return 'todo';
  }
  function boardBadge() {
    const b = getBoard();
    return b && b.srs.length ? ` <span class="sl-nav-count">${b.srs.length}</span>` : '';
  }
  function prioDot(p) {
    const m = PRIO_META[String(p || '').toLowerCase()] || ['⚪', '#6e7681'];
    return `<span class="sl-prio" style="color:${m[1]}" title="${escAttr(p || '')}">${m[0]}</span>`;
  }
  function workBadge(key) {
    const st = getStatus()[key];
    if (!st || !st.state) return '';
    const col = WORK_COLOR[st.state] || '#6e7681';
    return `<span class="sl-work" style="border-color:${col};color:${col}">${escAttr(st.state)}${st.step ? ' · ' + escAttr(st.step) : ''}</span>`;
  }
  function impactChips(im) {
    im = im || {};
    const cell = (ic, arr, col) => {
      const ids = arr || [];
      if (!ids.length) return '';
      return `<span class="sl-imp" style="color:${col}" title="${escAttr(ids.join(', '))}"
                role="button" tabindex="0" onclick="event.stopPropagation();SlViewer.goToId('${escAttr(ids[0])}')">${ic} ${ids.length}</span>`;
    };
    return (cell('⬡', im.inf, 'var(--c-inf)') + cell('⛁', im.sch, 'var(--c-sch)') +
            cell('▭', im.uis, 'var(--c-uis)') + cell('◆', im.func, 'var(--c-srs)')) ||
           '<span class="sl-imp-none">영향 미산정</span>';
  }
  function matBadge(sr) {
    const m = sr.material;
    if (!m || m.state === 'ok') return '';
    return `<span class="sl-mat warn" title="${escAttr(m.note || '보강 필요')}">⚠ 보강</span>`;
  }
  function srCard(sr) {
    const st = getStatus()[sr.key] || {};
    const link = sr.jira_url
      ? `<a class="sl-sr-key" href="${escAttr(sr.jira_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${escAttr(sr.key)}</a>`
      : `<span class="sl-sr-key">${escAttr(sr.key)}</span>`;
    const matBtn = `<button class="sl-bbtn mat" onclick="event.stopPropagation();SlViewer.openDossier('${escAttr(sr.key)}')" title="티켓 자료 폴더 열기/보강">📁 자료</button>`;
    const actions = st.state === '승인대기'
      ? `<button class="sl-bbtn approve" onclick="event.stopPropagation();SlViewer.boardAction('${escAttr(sr.key)}','approve')">승인</button>
         <button class="sl-bbtn reject" onclick="event.stopPropagation();SlViewer.boardAction('${escAttr(sr.key)}','reject')">반려</button>`
      : `${matBtn}<button class="sl-bbtn" onclick="event.stopPropagation();SlViewer.boardAction('${escAttr(sr.key)}','analyze')" title="영향 분석">영향</button>
         <button class="sl-bbtn primary" onclick="event.stopPropagation();SlViewer.boardAction('${escAttr(sr.key)}','change')" title="/sl-change 실행">AIDD 시작</button>`;
    return `<div class="sl-card" role="button" tabindex="0" onclick="SlViewer.boardDetail('${escAttr(sr.key)}')">
      <div class="sl-card-top">${prioDot(sr.priority)}${link}${workBadge(sr.key)}${matBadge(sr)}</div>
      <div class="sl-card-title">${escAttr(sr.summary || '')}</div>
      <div class="sl-card-imp">${impactChips(sr.impact)}</div>
      <div class="sl-card-actions">${actions}</div>
    </div>`;
  }
  function boardSig() { return JSON.stringify([window.__slBoard && window.__slBoard.generated_at, getStatus()]); }

  function boardShell(inner, b, shownN) {
    const meta = b
      ? `${escAttr(b.project || '')} · ${b.srs.length}건${shownN != null && shownN !== b.srs.length ? ' (필터 ' + shownN + ')' : ''} · 동기화 ${escAttr(b.generated_at || '-')}`
      : '세션 미연결 — 마지막 저장본 또는 비어있음';
    return `<div class="sl-board">
      <div class="sl-board-head">
        <div><div class="sl-board-title">📋 SR 작업보드</div><div class="sl-board-sub">${meta}</div></div>
        <button class="sl-bbtn sync" onclick="SlViewer.boardSync()">⟳ 동기화</button>
      </div>
      <div class="sl-board-toolbar">
        <input class="sl-board-search" type="text" placeholder="🔎 SR·요약·담당자" value="${escAttr(BOARD_FILTER.q)}"
               oninput="SlViewer.boardFilter('q', this.value)">
        <select class="sl-board-sel" onchange="SlViewer.boardFilter('prio', this.value)">
          <option value="">전체 우선순위</option>
          ${['Highest', 'High', 'Medium', 'Low', 'Lowest'].map(p =>
            `<option value="${p.toLowerCase()}" ${BOARD_FILTER.prio === p.toLowerCase() ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
      </div>
      ${inner}</div>`;
  }

  function renderBoard() {
    const main = document.getElementById('sl-main');
    if (!main) return;
    removeQuickNav(); removeRelationPanel();
    document.getElementById('sl-breadcrumb')?.remove();
    document.body.classList.add('sl-custom-view');
    BOARD_VIEW = true;
    renderSidebar();
    startBoardTimer();

    const b = getBoard();
    if (!b) {
      main.innerHTML = boardShell(
        `<div class="sl-board-empty"><div class="sl-be-icon">📋</div>
          <div class="sl-be-title">SR 보드 데이터가 없습니다</div>
          <div class="sl-be-desc">CLI에서 <code>/sl-viewer</code>를 실행하면 담당 지라 SR을 가져와 여기에 띄웁니다.<br>
          이미 실행 중이면 <b>⟳ 동기화</b>를 누르세요. 세션이 꺼져 있으면 마지막 저장본만 보입니다.</div></div>`);
      tryFallbackLoad();
      return;
    }
    BOARD_SIG = boardSig();

    const f = BOARD_FILTER;
    const srs = b.srs.filter(sr => {
      if (f.prio && String(sr.priority || '').toLowerCase() !== f.prio) return false;
      if (f.q) {
        const hay = (sr.key + ' ' + (sr.summary || '') + ' ' + (sr.assignee || '')).toLowerCase();
        if (!hay.includes(f.q)) return false;
      }
      return true;
    });
    const cols = BOARD_COLS.map(c => {
      const items = srs.filter(sr => boardColOf(sr.status) === c.key);
      return `<div class="sl-bcol">
        <div class="sl-bcol-h">${c.label} <span class="sl-bcol-n">${items.length}</span></div>
        <div class="sl-bcol-body">${items.map(srCard).join('') || '<div class="sl-bcol-empty">—</div>'}</div>
      </div>`;
    }).join('');
    main.innerHTML = boardShell(`<div class="sl-board-cols">${cols}</div>`, b, srs.length);
  }

  function tryFallbackLoad() {
    fetch('sr_board.json?_=' + Date.now()).then(r => r.ok ? r.json() : null).then(d => {
      if (d && Array.isArray(d.srs)) { window.__slBoard = d; if (document.querySelector('#sl-main .sl-board')) renderBoard(); }
    }).catch(function () {});
  }
  function startBoardTimer() {
    if (BOARD_TIMER) return;
    BOARD_TIMER = setInterval(function () {
      const main = document.getElementById('sl-main');
      if (!main || !main.querySelector('.sl-board')) return;   // 보드 화면 아닐 때 무시
      if (boardSig() !== BOARD_SIG && getBoard()) renderBoard();
    }, 3000);
  }

  function boardEnqueue(sr, action) {
    window.__slQueue = window.__slQueue || [];
    window.__slQueue.push({ id: 'q-' + Date.now(), sr: sr || null, action: action, ts: new Date().toISOString() });
    boardToast(action === 'sync' ? '동기화 요청됨 — 세션이 지라를 다시 가져옵니다'
                                 : `${sr || ''} · ${action} 요청됨 (세션 처리 대기)`);
  }
  function boardToast(msg) {
    let t = document.getElementById('sl-toast');
    if (!t) { t = document.createElement('div'); t.id = 'sl-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  function boardDetail(key) {
    const b = getBoard(); if (!b) return;
    const sr = b.srs.find(s => s.key === key); if (!sr) return;
    const st = getStatus()[key] || {};
    document.getElementById('sl-drawer')?.remove();
    const impRow = (lbl, arr) => (arr && arr.length)
      ? `<div class="sl-dr-imp"><b>${lbl}</b> ${arr.map(id => `<span class="sl-xlink" role="button" tabindex="0" onclick="SlViewer.goToId('${escAttr(id)}')">${escAttr(id)}</span>`).join(' ')}</div>` : '';
    const gate = st.gate ? `<div class="sl-dr-gate">⚠ 승인 대기: ${escAttr(st.gate)}
        <div class="sl-dr-gbtns"><button class="sl-bbtn approve" onclick="SlViewer.boardAction('${escAttr(key)}','approve')">승인</button>
        <button class="sl-bbtn reject" onclick="SlViewer.boardAction('${escAttr(key)}','reject')">반려</button></div></div>` : '';
    const mat = sr.material;
    const matSec = `<div class="sl-dr-sec">티켓 자료 ${mat && mat.state !== 'ok'
        ? `<span class="sl-mat warn">⚠ ${escAttr(mat.note)}</span>`
        : '<span class="sl-mat ok">✅ 충분</span>'}</div>
      <div class="sl-dr-mat">
        <div class="sl-dr-matpath">📁 ${escAttr((mat && mat.dossier_path) || ('docs/변경관리/' + sr.key))}/</div>
        ${(mat && mat.attachments && mat.attachments.length) ? `<div class="sl-dr-matrow">첨부: ${mat.attachments.map(a => `<code class="sl-drift-src">${a.parseable ? '' : '✕ '}${escAttr(a.name)}</code>`).join(' ')}</div>` : ''}
        <div class="sl-dr-matrow">보강(inputs): ${(mat && mat.inputs && mat.inputs.length) ? mat.inputs.map(f => `<code class="sl-drift-src">${escAttr(f)}</code>`).join(' ') : '<span class="sl-imp-none">없음 — 캡처/메모를 폴더에 넣어 보강하세요</span>'}</div>
        <div class="sl-dr-gbtns"><button class="sl-bbtn mat" onclick="SlViewer.openDossier('${escAttr(key)}')">📁 폴더 열기</button>
          <button class="sl-bbtn" onclick="SlViewer.refreshMaterial('${escAttr(key)}')">자료 새로고침</button></div>
      </div>`;
    const el = document.createElement('div');
    el.id = 'sl-drawer';
    el.innerHTML = `<div class="sl-dr-head"><span>${escAttr(sr.key)}</span>
        <span class="sl-dr-x" role="button" tabindex="0" onclick="SlViewer.closeDrawer()">✕</span></div>
      <div class="sl-dr-body">
        <div class="sl-dr-title">${escAttr(sr.summary || '')}</div>
        <div class="sl-dr-meta">${prioDot(sr.priority)} ${escAttr(sr.priority || '')} · ${escAttr(sr.status || '')} · ${escAttr(sr.assignee || '')}</div>
        ${sr.jira_url ? `<a class="sl-dr-link" href="${escAttr(sr.jira_url)}" target="_blank" rel="noopener">지라에서 열기 ↗</a>` : ''}
        ${sr.description ? `<div class="sl-dr-sec">설명</div><div class="sl-dr-desc">${escAttr(sr.description)}</div>` : ''}
        ${matSec}
        <div class="sl-dr-sec">영향 범위</div>
        ${impRow('⬡ INF', sr.impact && sr.impact.inf)}${impRow('⛁ SCH', sr.impact && sr.impact.sch)}${impRow('▭ UIS', sr.impact && sr.impact.uis)}${impRow('◆ FUNC', sr.impact && sr.impact.func)}
        ${(!sr.impact || !(sr.impact.inf || sr.impact.sch || sr.impact.uis || sr.impact.func)) ? '<div class="sl-imp-none">영향 미산정 — [영향 분석]으로 계산</div>' : ''}
        ${st.state ? `<div class="sl-dr-sec">진행</div><div class="sl-dr-prog"><b style="color:${WORK_COLOR[st.state] || '#6e7681'}">${escAttr(st.state)}</b> ${escAttr(st.step || '')}</div>` : ''}
        ${gate}
        ${st.log_tail ? `<div class="sl-dr-sec">로그</div><pre class="sl-dr-log">${escAttr(st.log_tail)}</pre>` : ''}
        <div class="sl-dr-actions">
          <button class="sl-bbtn" onclick="SlViewer.boardAction('${escAttr(key)}','analyze')">영향 분석</button>
          <button class="sl-bbtn primary" onclick="SlViewer.boardAction('${escAttr(key)}','change')">AIDD 시작</button>
        </div>
      </div>`;
    document.body.appendChild(el);
  }

  // ── 큐 헬퍼 (버튼 → 세션) ────────────────────────────────────
  function slEnqueue(action, extra) {
    window.__slQueue = window.__slQueue || [];
    window.__slQueue.push(Object.assign({ id: 'q-' + Date.now(), action: action, ts: new Date().toISOString() }, extra || {}));
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
    filterList(q) {
      q = (q || '').trim().toLowerCase();
      const cards = document.querySelectorAll('#sl-main .sl-inf-card, #sl-main .sl-uis-card');
      let shown = 0;
      cards.forEach(c => {
        const hit = !q || (c.getAttribute('data-search') || '').includes(q);
        c.style.display = hit ? '' : 'none';
        if (hit) shown++;
      });
      const cnt = document.getElementById('sl-list-count');
      if (cnt) cnt.textContent = q ? `${shown} / ${cards.length}` : `${cards.length}개`;
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
    openGraph(id) { openGraph(id); },
    graphDepth(d) { GRAPH_DEPTH = d; if (GRAPH_START) openGraph(GRAPH_START); },
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
    // ── SR 작업보드 ──
    showBoard() { renderBoard(); },
    renderBoard() { renderBoard(); },          // 세션(CDP)이 __slBoard/__slStatus 주입 후 호출
    boardSync() { boardEnqueue(null, 'sync'); },
    boardAction(sr, action) { boardEnqueue(sr, action); if (action === 'approve' || action === 'reject') this.closeDrawer(); },
    boardFilter(k, v) { BOARD_FILTER[k] = (v || '').toLowerCase(); renderBoard(); },
    boardDetail(key) { boardDetail(key); },
    closeDrawer() { document.getElementById('sl-drawer')?.remove(); },
    openDossier(sr) { slEnqueue('open-dossier', { target: sr }); boardToast(sr + ' 자료 폴더 — 세션이 생성·탐색기로 엽니다. 캡처/메모를 넣은 뒤 [자료 새로고침]'); },
    refreshMaterial(sr) { slEnqueue('refresh-material', { target: sr }); boardToast(sr + ' 자료 재점검 요청됨'); },
    // ── 개별 스펙 재생성 (화면 버튼 → 세션이 speclinker 명령 수행) ──
    regenSpec(id, kind) {
      slEnqueue('regen-spec', { target: id, kind: kind || '' });
      boardToast(id + ' 재생성 요청됨 — /sl-viewer 세션이 해당 스펙만 재생성합니다');
    },
    goToId(id) {
      if (!INDEX) return;
      const inf = INDEX.infs && INDEX.infs.find(i => i.id === id);
      if (inf) { this.openSpec(inf.file); return; }
      const sch = INDEX.schs && INDEX.schs.find(s => s.id === id);
      if (sch) { this.openSpec(sch.file); return; }
      const ui = INDEX.uis && INDEX.uis.find(u => u.id === id);
      if (ui) { this.openSpec(ui.file); return; }
      const fn = INDEX.funcs && INDEX.funcs.find(f => f.id === id);
      if (fn) { this.openSpec(fn.file); return; }
      const sr = INDEX.srs && INDEX.srs.find(s => s.id === id);
      if (sr) this.openSpec(sr.file);
    },
  };

  // ── Docsify 플러그인 등록 ──────────────────────────────────────
  function SlPlugin(hook, vm) {
    // 이미지 경로 재작성: spec.md 안의 ![[x]](Obsidian) 및 상대 ![](x) 를
    // 현재 문서 디렉토리 기준 경로로 변환 → 화면당 디렉토리/tabs 자산이 렌더된다.
    hook.beforeEach(function (content) {
      // frontmatter(--- ... ---) raw YAML 노출 방지 → 접이식 메타 블록(anchors 등 정보 보존)
      // BOM(utf-8-sig)·CRLF 허용 (ddd-* 에이전트/PowerShell 산출 파일 대응)
      content = content.replace(/^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/, function (_, fm) {
        var safe = String(fm).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return '<details class="sl-fm"><summary>📋 메타데이터</summary><pre>' + safe + '</pre></details>\n\n';
      });
      // Obsidian 임베드 ![[file.png]] → 표준 상대 ![](file.png). 경로는 prepend하지 않는다.
      // docsify가 상대 이미지 경로를 현재 문서 디렉토리 기준으로 해석하므로,
      // 여기서 디렉토리를 붙이면 docsify가 한 번 더 붙여 경로가 중복(.../dir/.../dir/x)된다.
      content = content.replace(/!\[\[([^\]]+)\]\]/g, function (_, p) {
        return '![](' + p.trim() + ')';
      });
      // 상대 .md 링크 → 절대 docsify 라우트(#/...)로 사전 변환.
      // FUNC_MAP·SRS 등 색인문서의 `../03_기능명세서/...md` 링크가 docsify 상대해석에서
      // docs/ 접두를 잃고 404(빈 화면)나던 문제 방지 — 현재 문서 디렉토리 기준으로 미리 절대화한다.
      var curFile = (vm && vm.route && vm.route.file) || '';        // 예: docs/00_FUNC/FUNC_MAP.md
      var curDir = curFile.indexOf('/') >= 0 ? curFile.replace(/[^/]*$/, '') : '';
      content = content.replace(/\]\((?!https?:|\/|#|mailto:)([^)\s]+?\.md)((?:#[^)\s]*)?)\)/g,
        function (_, rel, frag) {
          var parts = (curDir + rel).split('/'), out = [];
          for (var i = 0; i < parts.length; i++) {
            if (parts[i] === '..') out.pop();
            else if (parts[i] !== '.' && parts[i] !== '') out.push(parts[i]);
          }
          return '](#/' + out.join('/') + frag + ')';
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
      // 문서(.content)가 렌더됨 → 커스텀뷰(목록) 해제하여 문서가 화면을 차지하게 한다
      document.body.classList.remove('sl-custom-view');
      // 모든 마크다운 문서에 크로스링크·강조 적용 (FUNC_MAP/SRS/FUNC_v1.0 등 색인문서 포함)
      setTimeout(function () {
        injectBreadcrumb();
        injectRelationPanel();
        injectQuickNav();
        addCrosslinks();
        enhanceImages();
      }, 150);
    });
  }

  window.$docsify = window.$docsify || {};
  window.$docsify.plugins = (window.$docsify.plugins || []).concat([SlPlugin]);
})();
