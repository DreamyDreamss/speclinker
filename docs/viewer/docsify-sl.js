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
      renderSidebar();  // 인덱스 없어도 사이드바(가이드 버튼)는 표시
      document.getElementById('sl-main').innerHTML =
        `<div style="padding:48px 40px;color:var(--text-muted);text-align:center">
          <div style="font-size:40px;margin-bottom:8px">📭</div>
          <h3 style="color:var(--accent);margin:0 0 8px">아직 표시할 산출물이 없습니다</h3>
          <p style="font-size:13px">RECON/GENESIS로 INF·UIS를 생성한 뒤 인덱스를 갱신하세요:</p>
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
      <div class="sl-logo">⚡ Speclinker</div>
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

  // ── 사용자 가이드 ────────────────────────────────────────────
  const GUIDE_VERSION = '2.53.0';

  const GUIDE_PIPELINES = [
    { icon: '🆕', title: '새 프로젝트 (AIDD)',
      steps: ['sl-init', 'sl-genesis', 'sl-aidd', 'sl-test'],
      desc: '기획 문서로 설계서→코드 순방향 생성' },
    { icon: '🔍', title: '기존 코드 (RECON)',
      steps: ['sl-init', 'sl-recon', 'sl-recon-uis', '납품'],
      desc: '소스코드를 역분석해 설계서 추출' },
    { icon: '🔧', title: '변경·유지보수 (DELTA)',
      steps: ['sl-analyze', 'sl-change', 'sl-aidd'],
      desc: '변경요청(SR) 영향분석→스펙수정→코드' },
    { icon: '⚙️', title: 'SDD 전체 파이프라인',
      steps: ['sl-recon', 'sl-ia', 'sl-context', 'sl-plan', 'sl-check', 'sl-dev', 'sl-review'],
      desc: '스펙 주도 개발(Spec-Driven) 풀 사이클' },
  ];

  const GUIDE_CATEGORIES = [
    { name: '시작 & 초기화', color: 'var(--accent)', cmds: [
      ['/sl-init', '프로젝트 초기화 — 디렉토리·환경·모드 설정. RECON 모드면 소스 스캔 + 도메인 카탈로그 자동 생성', '제일 먼저 실행'],
    ]},
    { name: '산출물 생성 — GENESIS (순방향)', color: 'var(--status-done)', cmds: [
      ['/sl-genesis [파일]', '기획 문서 → REQ·SRS·INF·SCH·UIS 설계 산출물 순방향 생성', 'docs/00_입력자료/'],
      ['/sl-aidd [FUNC-ID]', 'FUNC 단위 AI 자동개발 루프 (스펙수집→코드→TC→커버리지)', 'FUNC_MAP.md'],
    ]},
    { name: '역분석 — RECON', color: 'var(--status-prog)', cmds: [
      ['/sl-recon', '소스코드 역분석 → 도메인 선택 → INF·SCH 명세 생성', 'project.env, 소스'],
      ['/sl-recon-uis', '화면 캡처(goto/BFS) → UIS 설계서 생성', 'recon 완료 후'],
      ['/sl-recon-doc', 'INF 기반 추가 설계 문서 보강', 'INF 존재'],
      ['/sl-ia', 'IA(메뉴 계층) 문서 자동 생성 + UIS menu-path 보완', 'UIS 존재'],
    ]},
    { name: 'SDD 파이프라인', color: '#a371f7', cmds: [
      ['/sl-context', 'project-context.md 생성 — 프레임워크·공통패턴 학습', 'INF 존재'],
      ['/sl-plan [설명]', '변경 영향분석 초안 — 키워드→스펙 매핑→규모 분류', 'docs/05_설계서/'],
      ['/sl-check <ID>', '개발 착수 게이트 — 승인 토큰·INF 완전성 검증', '.speclinker/'],
      ['/sl-review <ID>', '3단계 리뷰 — 스펙·보안·회귀 감사', 'TO-BE INF'],
      ['/sl-sprint', '스프린트 대시보드 — FUNC 상태·진행률 관리', 'FUNC_MAP.md'],
      ['/sl-drift', '스펙-코드 드리프트 감지 — 소스 변경 vs INF 미갱신', 'git, INF'],
      ['/sl-quick "설명"', '소규모 변경 경량 경로 (SR 없이 INF≤2 인라인 처리)', 'INF, context'],
    ]},
    { name: '변경 관리 — DELTA', color: 'var(--status-review)', cmds: [
      ['/sl-analyze', '변경 영향분석 (CIA) — 영향 INF·SCH·UIS 식별', 'docs/05_설계서/'],
      ['/sl-change <SR-ID>', '변경명세 생성 → before/after diff → 승인 토큰', 'docs/05_설계서/'],
    ]},
    { name: '개발 · 테스트 · 추적', color: '#3fb950', cmds: [
      ['/sl-dev', 'TO-BE 설계서 기반 코드 생성 (TDD, linked_func 주석)', 'docs/05_설계서/'],
      ['/sl-test', '테스트 케이스 작성 + 실행 → 결과 보고서', '06_소스코드/'],
      ['/sl-rtm', 'RTM 추적 매트릭스 — REQ→SRS→UIS→INF→SCH 체인 매핑', 'docs/02_추적표/'],
    ]},
    { name: '뷰어', color: 'var(--accent)', cmds: [
      ['/sl-viewer [port]', '이 Docsify 웹 뷰어 실행 (대시보드·INF/UIS·IA 트리)', 'docs/05_설계서/'],
    ]},
  ];

  const GUIDE_MODES = [
    ['GENESIS', '순방향', '기획 문서 → 설계서 → 코드. 신규 프로젝트.', 'var(--status-done)'],
    ['RECON', '역분석', '기존 소스 → 설계서 역추출. 문서 없는 레거시.', 'var(--status-prog)'],
    ['DELTA', '변경', '변경요청 → 영향분석 → 스펙수정 → 코드. 운영·유지보수.', 'var(--status-review)'],
  ];

  function renderGuide() {
    const main = document.getElementById('sl-main');
    if (!main) return;
    removeQuickNav();
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
          <b>FUNC-ID 체이닝</b> — 모든 산출물(REQ·SRS·UIS·INF·SCH)과 소스코드가
          <code>FUNC-{도메인}-{NNN}</code>로 연결됩니다. <code>FUNC_MAP.md</code>가 단일 진실의 원천(SSoT).
          <br><b>추적 체인</b> — REQ → SRS → UIS / INF / SCH / BAT → 코드(linked_func) → TC
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
    showGuide() {
      renderGuide();
    },
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
