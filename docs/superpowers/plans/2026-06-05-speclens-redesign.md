# SpecLens 뷰어 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SpecLens 뷰어에 화면(UIS) 뷰어 개편·연결관계 패널·브레드크럼+검색·대시보드 강화·반응형/접근성을 추가해, RECON 산출물의 핵심 가치(화면·연결관계)를 사용자가 한눈에 보게 한다.

**Architecture:** 빌드리스 유지(docsify + 바닐라 JS). `gen_docsify.py`가 정적 인덱스에 관계 필드(uis.inf_ids·inf.sch_ids·func)를 **추가**(하위호환). `docsify-sl.js`는 그 데이터로 연결패널·브레드크럼·검색·대시보드 정렬/필터를 렌더. 데이터 없으면 graceful degrade.

**Tech Stack:** Python 3(인덱스 생성, pytest 호환 테스트), 바닐라 JS(IIFE), CSS 변수, Docsify 4.

**참조:** 설계서 `docs/superpowers/specs/2026-06-05-speclens-redesign-design.md`

**검증 베드:** e2e 샘플 — `docs/report/samples/e2e_pr301/`. JS 단위 테스트 하네스 없음 → 인덱스 재생성 후 `python -m http.server`로 서빙하여 체크리스트 수동 확인. Python 계층은 pytest.

**범용성 의무(CLAUDE.md):** 인덱스 관계 해소 테스트 픽스처는 Java Spring + Next.js 2스택 형태 둘 다 포함.

---

## File Structure

- `scripts/gen_docsify.py` — 인덱스 생성. **수정**: 관계 해소 함수 추가 + `generate_index`가 호출.
  - 신규 함수: `resolve_uis_inf(uis, infs)`, `build_inf_sch_index(infs, schs)`, `load_func_links(spec_root, infs, uis, schs)`, `compute_gaps(...)`.
- `scripts/tests/test_speclens_index.py` — **신규**. 위 함수들의 단위테스트(2스택 픽스처).
- `docs/viewer/docsify-sl.js` — 뷰어 로직. **수정**: 브레드크럼·연결패널·UIS상세·라이트박스·검색·대시보드 정렬/필터·접근성 헬퍼.
- `docs/viewer/sl-theme.css` — **수정**: 신규 컴포넌트 스타일 + 반응형 + `:focus-visible`.
- `docs/viewer/index.html` — **수정(필요시)**: 검색 자산 유지(이미 docsify search 있음).
- `skills/sl-viewer/SKILL.md`, `scripts/README.md`, `CLAUDE.md`, `plugin.json` — 참조 동기화.

---

## Phase 1 — 인덱스 관계 데이터 (gen_docsify.py)

모든 UI가 이 데이터에 의존하므로 선행. TDD.

### Task 1: UIS → INF 해소 (`resolve_uis_inf`)

**Files:**
- Modify: `scripts/gen_docsify.py` (신규 함수 추가)
- Test: `scripts/tests/test_speclens_index.py` (신규)

- [ ] **Step 1: 실패 테스트 작성**

```python
#!/usr/bin/env python3
"""SpecLens 인덱스 관계 해소 단위 검증 (Java Spring + Next.js 2스택 픽스처)."""
import os, sys
SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPTS)
import gen_docsify as G

# 2스택 형태: Java 컨트롤러 경로 + Next.js 파일라우팅 경로 혼재
INFS = [
    {'id': 'INF-PRD-205', 'path': '/product/save', 'method': 'POST', 'domain': 'product'},
    {'id': 'INF-PRD-206', 'path': '/product/category', 'method': 'GET', 'domain': 'product'},
    {'id': 'INF-ORD-010', 'path': '/api/order/list', 'method': 'GET', 'domain': 'order'},
]

def test_resolve_uis_inf_exact_and_prefix():
    uis = [
        {'id': 'UIS-PRD-001', 'apis': ['/product/save', '/product/category'], 'domain': 'product'},
        {'id': 'UIS-ORD-001', 'apis': ['/api/order/list?page=1'], 'domain': 'order'},  # 쿼리스트링 prefix
        {'id': 'UIS-X-001', 'apis': ['/unknown/path'], 'domain': 'x'},                  # 매칭 실패
    ]
    G.resolve_uis_inf(uis, INFS)
    assert uis[0]['inf_ids'] == ['INF-PRD-205', 'INF-PRD-206'], uis[0]
    assert uis[1]['inf_ids'] == ['INF-ORD-010'], uis[1]      # prefix 매칭
    assert uis[2]['inf_ids'] == [], uis[2]                    # 실패분은 빈 목록(raw는 apis에 유지)
    assert uis[2]['apis'] == ['/unknown/path']
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest scripts/tests/test_speclens_index.py::test_resolve_uis_inf_exact_and_prefix -v`
Expected: FAIL — `AttributeError: module 'gen_docsify' has no attribute 'resolve_uis_inf'`

- [ ] **Step 3: 최소 구현** (`gen_docsify.py`에 추가)

```python
def _norm_path(p: str) -> str:
    """쿼리/프래그먼트 제거 + 끝 슬래시 정리."""
    p = (p or '').split('?')[0].split('#')[0].strip()
    if len(p) > 1 and p.endswith('/'):
        p = p[:-1]
    return p

def resolve_uis_inf(uis: list, infs: list) -> None:
    """각 UIS의 apis(URL/hint)를 INF id로 해소 → uis[i]['inf_ids']. 인덱스 in-place 보강.
    정확 매칭 우선, 없으면 prefix(apis가 INF path로 시작) 매칭. 실패분은 무시(apis raw 유지)."""
    by_path = {}
    for inf in infs:
        np = _norm_path(inf.get('path', ''))
        if np:
            by_path.setdefault(np, inf['id'])
    for u in uis:
        ids = []
        for a in (u.get('apis') or []):
            na = _norm_path(a)
            if not na:
                continue
            if na in by_path:
                hit = by_path[na]
            else:
                hit = None
                for np, iid in by_path.items():
                    if na == np or na.startswith(np + '/'):
                        hit = iid
                        break
            if hit and hit not in ids:
                ids.append(hit)
        u['inf_ids'] = ids
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest scripts/tests/test_speclens_index.py::test_resolve_uis_inf_exact_and_prefix -v`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add scripts/gen_docsify.py scripts/tests/test_speclens_index.py
git commit -m "feat(speclens): UIS apis→INF id 해소(resolve_uis_inf)"
```

### Task 2: INF → SCH 역인덱스 (`build_inf_sch_index`)

**Files:**
- Modify: `scripts/gen_docsify.py`
- Test: `scripts/tests/test_speclens_index.py`

- [ ] **Step 1: 실패 테스트 추가**

```python
def test_build_inf_sch_index():
    infs = [{'id': 'INF-PRD-205'}, {'id': 'INF-PRD-206'}, {'id': 'INF-ORD-010'}]
    schs = [
        {'id': 'SCH-PRD-009', 'table': 'PRODUCT', 'inf': ['INF-PRD-205', 'INF-PRD-206']},
        {'id': 'SCH-PRD-010', 'table': 'PRICE', 'inf': ['INF-PRD-205']},
        {'id': 'SCH-ORD-001', 'table': 'ORDERS', 'inf': []},  # 참조 INF 없음
    ]
    G.build_inf_sch_index(infs, schs)
    assert infs[0]['sch_ids'] == ['SCH-PRD-009', 'SCH-PRD-010'], infs[0]
    assert infs[1]['sch_ids'] == ['SCH-PRD-009'], infs[1]
    assert infs[2]['sch_ids'] == [], infs[2]
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest scripts/tests/test_speclens_index.py::test_build_inf_sch_index -v`
Expected: FAIL — no attribute `build_inf_sch_index`

- [ ] **Step 3: 최소 구현**

```python
def build_inf_sch_index(infs: list, schs: list) -> None:
    """schs[].inf[] 역인덱스 → infs[i]['sch_ids']. in-place 보강."""
    rev = {}
    for s in schs:
        for iid in (s.get('inf') or []):
            rev.setdefault(iid, [])
            if s['id'] not in rev[iid]:
                rev[iid].append(s['id'])
    for inf in infs:
        inf['sch_ids'] = rev.get(inf['id'], [])
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest scripts/tests/test_speclens_index.py::test_build_inf_sch_index -v`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add scripts/gen_docsify.py scripts/tests/test_speclens_index.py
git commit -m "feat(speclens): INF→SCH 역인덱스(build_inf_sch_index)"
```

### Task 3: linked FUNC 매핑 (`load_func_links`)

**Files:**
- Modify: `scripts/gen_docsify.py`
- Test: `scripts/tests/test_speclens_index.py`

- [ ] **Step 1: 실패 테스트 추가**

`FUNC_MAP.md`의 표에서 산출물 ID→FUNC-ID를 역매핑한다. FUNC_MAP 행은 `| FUNC-product-001 | ... | INF-PRD-205, INF-PRD-206 | ... | UIS-PRD-001 | SCH-PRD-009 |` 형태(셀 안에 산출물 ID들이 등장).

```python
import tempfile
def test_load_func_links_from_funcmap():
    tmp = tempfile.mkdtemp()
    func_dir = os.path.join(tmp, 'docs', '00_FUNC')
    os.makedirs(func_dir)
    with open(os.path.join(func_dir, 'FUNC_MAP.md'), 'w', encoding='utf-8') as f:
        f.write("| FUNC-ID | 기능 | INF | UIS | SCH |\n")
        f.write("|---|---|---|---|---|\n")
        f.write("| FUNC-product-001 | 상품등록 | INF-PRD-205, INF-PRD-206 | UIS-PRD-001 | SCH-PRD-009 |\n")
    infs = [{'id': 'INF-PRD-205'}, {'id': 'INF-PRD-206'}, {'id': 'INF-ORD-010'}]
    uis = [{'id': 'UIS-PRD-001'}]
    schs = [{'id': 'SCH-PRD-009'}]
    G.load_func_links(tmp, infs, uis, schs)
    assert infs[0]['func'] == 'FUNC-product-001'
    assert infs[2].get('func') in (None, '')   # 매핑 없음
    assert uis[0]['func'] == 'FUNC-product-001'
    assert schs[0]['func'] == 'FUNC-product-001'
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest scripts/tests/test_speclens_index.py::test_load_func_links_from_funcmap -v`
Expected: FAIL — no attribute `load_func_links`

- [ ] **Step 3: 최소 구현**

```python
import re as _re_func

def load_func_links(spec_root: str, infs: list, uis: list, schs: list) -> None:
    """FUNC_MAP.md에서 산출물ID→FUNC-ID 역매핑 → 각 항목 ['func'] 보강.
    파일/매핑 없으면 'func' 미설정(graceful)."""
    fp = os.path.join(spec_root, 'docs', '00_FUNC', 'FUNC_MAP.md')
    if not os.path.exists(fp):
        return
    with open(fp, encoding='utf-8') as f:
        text = f.read()
    mapping = {}  # 산출물ID -> FUNC-ID
    func_re = _re_func.compile(r'FUNC-[a-zA-Z]+-\d+')
    art_re = _re_func.compile(r'(?:INF|UIS|SCH|BAT)-[A-Za-z]+-\d+')
    for line in text.splitlines():
        funcs = func_re.findall(line)
        if not funcs:
            continue
        fid = funcs[0]
        for art in art_re.findall(line):
            mapping.setdefault(art, fid)
    for coll in (infs, uis, schs):
        for item in coll:
            if item['id'] in mapping:
                item['func'] = mapping[item['id']]
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest scripts/tests/test_speclens_index.py::test_load_func_links_from_funcmap -v`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add scripts/gen_docsify.py scripts/tests/test_speclens_index.py
git commit -m "feat(speclens): FUNC_MAP 기반 산출물→FUNC 링크(load_func_links)"
```

### Task 4: 갭 집계 + `generate_index` 배선

**Files:**
- Modify: `scripts/gen_docsify.py` (`generate_index`에서 위 함수들 호출 + 갭 카운트)
- Test: `scripts/tests/test_speclens_index.py`

- [ ] **Step 1: 실패 테스트 추가**

```python
def test_compute_gaps():
    infs = [{'id': 'INF-PRD-205', 'sch_ids': ['SCH-PRD-009']},
            {'id': 'INF-PRD-206', 'sch_ids': []}]          # 테이블 미연결
    uis = [{'id': 'UIS-PRD-001', 'inf_ids': ['INF-PRD-205']},
           {'id': 'UIS-PRD-002', 'inf_ids': []}]           # API 미연결
    gaps = G.compute_gaps(infs, uis)
    assert gaps['inf_no_sch'] == 1
    assert gaps['uis_no_inf'] == 1
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest scripts/tests/test_speclens_index.py::test_compute_gaps -v`
Expected: FAIL — no attribute `compute_gaps`

- [ ] **Step 3: 구현 + generate_index 배선**

`gen_docsify.py`에 추가:

```python
def compute_gaps(infs: list, uis: list) -> dict:
    """연결 끊긴 산출물 집계(품질 가시화)."""
    return {
        'inf_no_sch': sum(1 for i in infs if not i.get('sch_ids')),
        'uis_no_inf': sum(1 for u in uis if not u.get('inf_ids')),
    }
```

`generate_index(spec_root, output_path)` 안에서 infs/uis/schs 수집 직후, index dict를 만들기 전에 호출:

```python
    # ── 관계 데이터 보강 (SpecLens 재설계) ──
    resolve_uis_inf(uis, infs)
    build_inf_sch_index(infs, schs)
    load_func_links(spec_root, infs, uis, schs)
    gaps = compute_gaps(infs, uis)
```

그리고 최종 index dict에 `'gaps': gaps` 키를 추가(기존 키 유지).

- [ ] **Step 4: 통과 확인 + 전체 회귀**

Run: `python -m pytest scripts/tests/test_speclens_index.py -v`
Expected: 4개 PASS

- [ ] **Step 5: 실데이터 스모크 + 커밋**

Run: `cd docs/report/samples/e2e_pr301 && python ../../../../scripts/gen_docsify.py . && python -c "import json;d=json.load(open('docs/viewer/spec_index.json',encoding='utf-8'));print('uis inf_ids 예:',[u.get('inf_ids') for u in d['uis'][:3]]);print('gaps:',d.get('gaps'))"`
Expected: `inf_ids` 채워짐 + `gaps` 출력(빈손 아님)

```bash
git add scripts/gen_docsify.py scripts/tests/test_speclens_index.py
git commit -m "feat(speclens): generate_index 관계보강 배선 + 갭집계(compute_gaps)"
```

---

## Phase 2 — 브레드크럼 + 연결관계 패널 (docsify-sl.js)

> JS 단위 테스트 하네스 없음. 각 Task는 e2e 샘플을 서빙해 브라우저에서 확인.
> 서빙: `cd docs/report/samples/e2e_pr301 && python -m http.server 5199` → `http://localhost:5199/docs/viewer/index.html`
> (Task 시작 전 `python ../../../../scripts/gen_docsify.py .`로 인덱스 최신화)

### Task 5: 라우트 파서 + 브레드크럼

**Files:**
- Modify: `docs/viewer/docsify-sl.js` (헬퍼 + `doneEach`에서 호출)
- Modify: `docs/viewer/sl-theme.css` (브레드크럼 스타일)

- [ ] **Step 1: 라우트→엔티티 해소 헬퍼 추가**

`docsify-sl.js` 내부(공개 API 위)에 추가:

```javascript
  // 현재 hash 경로 → 인덱스 엔티티 해소 {type,id,domain,name}
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
```

- [ ] **Step 2: 브레드크럼 렌더 함수 추가**

```javascript
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
```

- [ ] **Step 3: doneEach에서 호출**

기존 `hook.doneEach`의 setTimeout 콜백 안(injectQuickNav 호출부 근처)에 `injectBreadcrumb();`를 추가. 키보드 활성화를 위해 `injectBreadcrumb` 직후 공통 헬퍼로 Enter/Space 바인딩(Task 12에서 일괄 처리하므로 여기선 onclick만).

- [ ] **Step 4: CSS 추가** (`sl-theme.css`)

```css
/* 브레드크럼 */
#sl-breadcrumb { padding: 10px 0; font-size: 12px; color: var(--text-muted); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
#sl-breadcrumb .sl-bc-link { color: var(--text-muted); cursor: pointer; }
#sl-breadcrumb .sl-bc-link:hover { color: var(--accent); }
#sl-breadcrumb .sl-bc-sep { opacity: .5; }
#sl-breadcrumb .sl-bc-type { color: var(--text-muted); }
#sl-breadcrumb .sl-bc-cur { color: var(--accent); font-weight: 600; }
#sl-breadcrumb .sl-bc-back { margin-left: auto; border: 1px solid var(--border); border-radius: 4px; padding: 1px 8px; cursor: pointer; }
#sl-breadcrumb .sl-bc-back:hover { border-color: var(--accent); color: var(--accent); }
```

- [ ] **Step 5: 검증 + 커밋**

서빙 후 INF/UIS/SCH 문서 진입 → 상단에 브레드크럼 표시, "🏠 대시보드"/도메인/"← 도메인" 클릭 동작 확인.

```bash
git add docs/viewer/docsify-sl.js docs/viewer/sl-theme.css
git commit -m "feat(speclens): 상세 화면 브레드크럼 + 라우트 엔티티 해소"
```

### Task 6: 연결관계 패널 (INF/UIS/SCH 공통)

**Files:**
- Modify: `docs/viewer/docsify-sl.js`
- Modify: `docs/viewer/sl-theme.css`

- [ ] **Step 1: 패널 렌더 함수 추가**

```javascript
  function chip(id, label, kind) {
    // kind: 'inf'|'sch'|'uis'|'func' → 색
    return `<span class="sl-rel-chip sl-rel-${kind}" role="button" tabindex="0"
             onclick="SlViewer.goToId('${escAttr(id)}')">${escAttr(label || id)}</span>`;
  }

  function relSection(title, html) {
    if (!html) return '';
    return `<div class="sl-rel-label">${title}</div><div class="sl-rel-body">${html}</div>`;
  }

  function injectRelationPanel() {
    document.getElementById('sl-rel-panel')?.remove();
    const e = resolveCurrentEntity();
    if (!e || !INDEX) return;
    const en = e.entity;
    let sections = '';
    if (e.type === 'uis') {
      const infIds = en.inf_ids || [];
      const apis = infIds.map(id => {
        const inf = INDEX.infs.find(i => i.id === id) || { id };
        const badge = inf.method ? `<span class="sl-rel-m">${inf.method}</span>` : '';
        return `<div class="sl-rel-row" role="button" tabindex="0" onclick="SlViewer.goToId('${escAttr(id)}')">${badge}${escAttr(id)} ${escAttr(inf.name || '')}</div>`;
      }).join('');
      const schIds = [...new Set(infIds.flatMap(id => (INDEX.infs.find(i => i.id === id) || {}).sch_ids || []))];
      sections += relSection('호출 API (' + infIds.length + ')', apis);
      sections += relSection('관련 테이블 (' + schIds.length + ')', schIds.map(s => chip(s, (INDEX.schs.find(x=>x.id===s)||{}).table || s, 'sch')).join(''));
    } else if (e.type === 'inf') {
      const schIds = en.sch_ids || [];
      const usedBy = (INDEX.uis || []).filter(u => (u.inf_ids || []).includes(en.id));
      sections += relSection('관련 테이블 (' + schIds.length + ')', schIds.map(s => chip(s, (INDEX.schs.find(x=>x.id===s)||{}).table || s, 'sch')).join(''));
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
```

- [ ] **Step 2: doneEach 통합 + Quick Nav 공존 처리**

`hook.doneEach` setTimeout 콜백에서 `injectRelationPanel();` 호출 추가. 연결패널은 우측 고정, Quick Nav도 우측이므로 **연결패널이 있으면 Quick Nav를 그 아래로** 배치(Task에서 CSS top 조정). 상세 외 화면 렌더(`renderDashboard`/`renderDomainView`/`renderGuide`) 진입 시 `removeRelationPanel()` 호출 추가(removeQuickNav 옆에).

- [ ] **Step 3: CSS 추가**

```css
/* 연결관계 패널 (우측) */
#sl-rel-panel { position: fixed; right: 0; top: 0; width: 240px; height: 100vh; overflow-y: auto;
  background: var(--bg-secondary); border-left: 1px solid var(--border); padding: 16px 14px; z-index: 60; }
#sl-rel-panel .sl-rel-title { color: var(--accent); font-weight: 700; font-size: 13px; margin-bottom: 12px; }
#sl-rel-panel .sl-rel-label { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: var(--text-muted); margin: 10px 0 5px; }
#sl-rel-panel .sl-rel-row { font-size: 11px; padding: 5px 8px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 5px; margin-bottom: 4px; cursor: pointer; }
#sl-rel-panel .sl-rel-row:hover { border-color: var(--accent); }
#sl-rel-panel .sl-rel-m { background: var(--accent-dim); color: var(--accent); border-radius: 3px; padding: 0 5px; font-size: 9px; font-weight: 700; margin-right: 5px; }
.sl-rel-chip { display: inline-block; font-size: 11px; padding: 3px 8px; border-radius: 5px; margin: 0 4px 4px 0; cursor: pointer; border: 1px solid; }
.sl-rel-sch { color: var(--status-done); border-color: var(--status-done); background: rgba(63,185,80,.10); }
.sl-rel-inf { color: var(--status-prog); border-color: var(--status-prog); background: rgba(88,166,255,.10); }
.sl-rel-uis { color: var(--accent); border-color: var(--accent); background: var(--accent-dim); }
.sl-rel-func { color: var(--accent); border-color: var(--accent); background: var(--accent-dim); }
.content.has-relpanel { margin-right: 240px !important; }
.content.has-relpanel.has-qnav { margin-right: 240px !important; }  /* 패널 우선 */
.has-relpanel #sl-quick-nav { display: none; }  /* 연결패널과 충돌 회피: 상세에선 연결패널 우선 */
```

> 설계 결정: 연결패널이 있는 상세에서는 Quick Nav를 숨긴다(우측 공간 1개). 본문 내 헤딩 네비는 스크롤로 충분.

- [ ] **Step 4: 검증**

UIS 문서 → 호출 API/관련 테이블/linked FUNC 칩 표시 + 클릭 시 해당 INF/SCH/FUNC로 이동. INF 문서 → 관련 테이블/사용 화면. SCH 문서 → 참조 API.

- [ ] **Step 5: 커밋**

```bash
git add docs/viewer/docsify-sl.js docs/viewer/sl-theme.css
git commit -m "feat(speclens): INF/UIS/SCH 상세 연결관계 패널"
```

---

## Phase 3 — UIS 상세 뷰어 (큰 미리보기 + 라이트박스)

### Task 7: UIS 상세 전폭 미리보기 + 라이트박스

**Files:**
- Modify: `docs/viewer/docsify-sl.js`
- Modify: `docs/viewer/sl-theme.css`

> UIS 상세는 docsify가 spec.md를 렌더한다. spec.md 본문에 이미 미리보기 이미지(`![]()`)가 SlPlugin.beforeEach로 경로 재작성되어 들어온다. 따라서 **본문 내 이미지에 라이트박스를 붙이는** 방식이 가장 단순·견고(별도 상세레이아웃 재구성 불필요).

- [ ] **Step 1: 라이트박스 함수 추가**

```javascript
  function openLightbox(src) {
    document.getElementById('sl-lightbox')?.remove();
    const lb = document.createElement('div');
    lb.id = 'sl-lightbox';
    lb.innerHTML = `<img src="${src}" alt="확대"><div class="sl-lb-close" role="button" tabindex="0">✕ 닫기 (ESC)</div>`;
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
```

- [ ] **Step 2: doneEach 통합**

`hook.doneEach` setTimeout 콜백에 `enhanceImages();` 추가.

- [ ] **Step 3: CSS 추가**

```css
/* UIS 미리보기 확대 */
.markdown-section img.sl-zoomable { cursor: zoom-in; border: 1px solid var(--border); border-radius: 8px; max-width: 100%; transition: border-color .15s; }
.markdown-section img.sl-zoomable:hover { border-color: var(--accent); }
#sl-lightbox { position: fixed; inset: 0; background: rgba(0,0,0,.85); z-index: 200; display: flex; align-items: center; justify-content: center; cursor: zoom-out; flex-direction: column; }
#sl-lightbox img { max-width: 94vw; max-height: 88vh; object-fit: contain; border-radius: 8px; box-shadow: 0 8px 40px rgba(0,0,0,.6); }
#sl-lightbox .sl-lb-close { color: #fff; margin-top: 14px; font-size: 13px; border: 1px solid rgba(255,255,255,.4); border-radius: 6px; padding: 6px 14px; cursor: pointer; }
```

- [ ] **Step 4: 검증**

UIS spec.md 진입 → 미리보기 이미지에 hover 시 zoom-in 커서·테두리, 클릭 시 풀스크린 라이트박스, ESC/클릭/닫기로 닫힘.

- [ ] **Step 5: 커밋**

```bash
git add docs/viewer/docsify-sl.js docs/viewer/sl-theme.css
git commit -m "feat(speclens): UIS 미리보기 라이트박스 확대"
```

### Task 8: UIS 목록 카드 미리보기 개선

**Files:**
- Modify: `docs/viewer/sl-theme.css` (카드 미리보기 높이/맞춤)
- Modify: `docs/viewer/docsify-sl.js` (`renderUisCard` — inf_ids 기반 "연결 API n" 정확화)

- [ ] **Step 1: 카드 미리보기 CSS 개선**

`.sl-uis-preview` 높이 80→140px, `object-fit: cover` → `cover` 유지하되 `object-position: top`(화면 상단이 식별에 유리):

```css
.sl-uis-preview { height: 140px; }
.sl-uis-preview img { height: 140px; object-position: top; }
```

- [ ] **Step 2: renderUisCard 연결정보 정확화**

`renderUisCard`의 apis 표기를 `ui.inf_ids`(해소된 INF) 기준으로:

```javascript
        ${(ui.domain || (ui.inf_ids && ui.inf_ids.length)) ? `<div class="sl-uis-apis">${escAttr(ui.domain || '')}${ui.inf_ids && ui.inf_ids.length ? ` · 연결 API ${ui.inf_ids.length}` : ''}</div>` : ''}
```

- [ ] **Step 3: 검증**

도메인 → UIS 탭 → 카드 미리보기가 더 크게 보이고 "연결 API n"이 실제 해소된 INF 수와 일치.

- [ ] **Step 4: 커밋**

```bash
git add docs/viewer/docsify-sl.js docs/viewer/sl-theme.css
git commit -m "feat(speclens): UIS 카드 미리보기 확대 + inf_ids 기반 연결수"
```

---

## Phase 4 — 대시보드 강화

### Task 9: 도메인 테이블 정렬 + 갭 배지

**Files:**
- Modify: `docs/viewer/docsify-sl.js` (`renderDashboard` + 정렬 상태)
- Modify: `docs/viewer/sl-theme.css`

- [ ] **Step 1: 정렬 상태 + 헤더 클릭**

`renderDashboard`를 정렬 가능하게 변경. 모듈 상단 상태에 `let DASH_SORT = { key: null, dir: -1 };` 추가. 도메인 행 생성 전 정렬:

```javascript
    let domEntries = Object.entries(INDEX.domains);
    if (DASH_SORT.key) {
      const k = DASH_SORT.key;
      domEntries.sort((a, b) => {
        const va = (k === 'name') ? a[0] : (a[1][k] || 0);
        const vb = (k === 'name') ? b[0] : (b[1][k] || 0);
        return (va < vb ? -1 : va > vb ? 1 : 0) * DASH_SORT.dir;
      });
    }
```

그리고 `Object.entries(INDEX.domains).map(...)`를 `domEntries.map(...)`로 교체.

- [ ] **Step 2: 헤더 onclick + 공개 API**

`<thead>`의 각 `<th>`에 `onclick="SlViewer.sortDash('inf')"` 식으로 부여(name/inf/uis/sch/bat). 공개 API에 추가:

```javascript
    sortDash(key) {
      if (DASH_SORT.key === key) DASH_SORT.dir *= -1;
      else { DASH_SORT.key = key; DASH_SORT.dir = -1; }
      renderDashboard();
    },
```

- [ ] **Step 3: 갭 배지(요약 카드)**

`renderDashboard`의 summary cards 뒤에 갭 카드 추가(INDEX.gaps 있을 때만):

```javascript
    const gapHtml = INDEX.gaps ? `
      <div class="sl-gap-bar">
        <span class="sl-gap-item ${INDEX.gaps.uis_no_inf ? 'warn' : ''}">화면-API 미연결 ${INDEX.gaps.uis_no_inf}</span>
        <span class="sl-gap-item ${INDEX.gaps.inf_no_sch ? 'warn' : ''}">API-테이블 미연결 ${INDEX.gaps.inf_no_sch}</span>
      </div>` : '';
```

그리고 summary-cards div 다음에 `${gapHtml}` 삽입.

- [ ] **Step 4: CSS**

```css
.sl-domain-table th { cursor: pointer; user-select: none; }
.sl-domain-table th:hover { color: var(--accent); }
.sl-gap-bar { display: flex; gap: 10px; margin: -8px 0 18px; }
.sl-gap-item { font-size: 11px; color: var(--text-muted); border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px; }
.sl-gap-item.warn { color: var(--status-review); border-color: var(--status-review); }
```

- [ ] **Step 5: 검증 + 커밋**

대시보드 → 헤더 클릭 시 정렬 토글, 갭 배지 표시(미연결 있으면 주황).

```bash
git add docs/viewer/docsify-sl.js docs/viewer/sl-theme.css
git commit -m "feat(speclens): 대시보드 정렬 + 연결갭 배지"
```

---

## Phase 5 — 글로벌 검색(사이드바)

### Task 10: 사이드바 구조 검색

**Files:**
- Modify: `docs/viewer/docsify-sl.js` (renderSidebar + 검색 핸들러)
- Modify: `docs/viewer/sl-theme.css`

- [ ] **Step 1: 사이드바에 검색 입력 추가**

`renderSidebar`의 logo div 다음에 검색 입력 + 결과 컨테이너 삽입:

```javascript
      `<div class="sl-search-wrap">
         <input id="sl-search" class="sl-search" type="text" placeholder="🔎 INF·화면·테이블·경로"
                oninput="SlViewer.search(this.value)" autocomplete="off">
         <div id="sl-search-results"></div>
       </div>`
```

- [ ] **Step 2: 검색 핸들러(공개 API)**

```javascript
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
```

> 주의: `renderSidebar`가 재호출되면 입력값이 사라질 수 있으므로, 검색 결과 클릭으로 화면 전환 시에만 사이드바가 다시 그려진다. 입력 중 사이드바 재렌더가 일어나지 않게 `search()`는 renderSidebar를 호출하지 않는다(결과 div만 갱신).

- [ ] **Step 3: CSS**

```css
.sl-search-wrap { padding: 10px 12px; position: relative; }
.sl-search { width: 100%; box-sizing: border-box; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; padding: 6px 9px; color: var(--text-primary); font-size: 12px; }
.sl-search:focus { outline: none; border-color: var(--accent); }
#sl-search-results { margin-top: 6px; }
.sl-sr-item { padding: 5px 7px; font-size: 11px; border-radius: 5px; cursor: pointer; color: var(--text-muted); }
.sl-sr-item:hover { background: var(--bg-tertiary); color: var(--text-primary); }
.sl-sr-type { color: var(--accent); font-size: 9px; font-weight: 700; }
.sl-sr-name { color: var(--text-muted); }
.sl-sr-empty { padding: 5px 7px; font-size: 11px; color: var(--text-muted); }
```

- [ ] **Step 4: 검증 + 커밋**

사이드바 검색에 2글자+ 입력 → INF/UIS/SCH 즉시 결과, 클릭 시 이동.

```bash
git add docs/viewer/docsify-sl.js docs/viewer/sl-theme.css
git commit -m "feat(speclens): 사이드바 글로벌 구조 검색"
```

---

## Phase 6 — 마감 (반응형·접근성·stale·BAT)

### Task 11: 반응형 + 사이드바 토글

**Files:**
- Modify: `docs/viewer/docsify-sl.js` (토글 버튼 + 상태)
- Modify: `docs/viewer/sl-theme.css` (미디어쿼리)

- [ ] **Step 1: 햄버거 토글 + 상태**

`hook.mounted`에서 sidebar/main 삽입 직후 토글 버튼을 body에 추가:

```javascript
        document.body.insertAdjacentHTML('afterbegin',
          '<div id="sl-burger" role="button" tabindex="0" title="사이드바 토글" onclick="SlViewer.toggleSidebar()">☰</div>');
```

공개 API:

```javascript
    toggleSidebar() { document.body.classList.toggle('sl-sidebar-hidden'); },
```

- [ ] **Step 2: 반응형 CSS**

```css
#sl-burger { position: fixed; top: 10px; left: 10px; z-index: 110; display: none; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px; color: var(--accent); cursor: pointer; }
@media (max-width: 900px) {
  #sl-burger { display: block; }
  #sl-sidebar { transform: translateX(0); transition: transform .2s; }
  body.sl-sidebar-hidden #sl-sidebar { transform: translateX(-100%); }
  #sl-main, .content { margin-left: 0 !important; }
  #sl-sidebar { box-shadow: 2px 0 12px rgba(0,0,0,.4); }
  #sl-rel-panel { display: none; }   /* 좁은 화면: 연결패널은 본문 하단 흐름에 양보 */
  .content.has-relpanel, .content.has-qnav { margin-right: 0 !important; }
}
```

- [ ] **Step 3: 검증**

브라우저 폭을 900px 이하로 줄이면 ☰ 표시, 클릭 시 사이드바 슬라이드 인/아웃, 본문 풀폭.

- [ ] **Step 4: 커밋**

```bash
git add docs/viewer/docsify-sl.js docs/viewer/sl-theme.css
git commit -m "feat(speclens): 반응형 — 사이드바 토글 + 좁은화면 레이아웃"
```

### Task 12: 키보드 접근성 + focus-visible

**Files:**
- Modify: `docs/viewer/docsify-sl.js` (전역 keydown 위임)
- Modify: `docs/viewer/sl-theme.css`

- [ ] **Step 1: Enter/Space 위임 핸들러**

`hook.mounted` 내 loadIndex 호출 근처에 1회 등록:

```javascript
        document.addEventListener('keydown', function (ev) {
          if ((ev.key === 'Enter' || ev.key === ' ') && ev.target && ev.target.getAttribute('role') === 'button') {
            ev.preventDefault();
            ev.target.click();
          }
        });
```

> 이로써 `role="button" tabindex="0"`가 부여된 모든 요소(브레드크럼·칩·검색결과·도메인아이템 등)가 키보드로 활성화된다. 기존 주요 클릭 요소에 `role="button" tabindex="0"`를 부여한다: `sl-domain-item`, `sl-tab`, `sl-nav-link`, `sl-uis-card`, `sl-inf-card`(이미 onclick 보유 → 속성만 추가).

- [ ] **Step 2: 클릭 요소에 role/tabindex 부여**

`renderDomainList`의 `.sl-domain-item`, `renderDomainView`의 `.sl-tab`, `renderInfCard`/`renderUisCard`/`renderSchCard`의 카드 래퍼 div에 `role="button" tabindex="0"` 추가(문자열 템플릿 수정).

- [ ] **Step 3: focus-visible CSS**

```css
[role="button"]:focus-visible, .sl-search:focus-visible, a:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px;
}
```

- [ ] **Step 4: 검증**

Tab 키로 사이드바 도메인·탭·카드 포커스 이동 가능, Enter/Space로 활성화, 포커스 링 표시.

- [ ] **Step 5: 커밋**

```bash
git add docs/viewer/docsify-sl.js docs/viewer/sl-theme.css
git commit -m "feat(speclens): 키보드 내비게이션 + focus-visible 접근성"
```

### Task 13: stale 경고 + BAT 탭 처리

**Files:**
- Modify: `docs/viewer/docsify-sl.js` (대시보드 stale 안내 + BAT 탭 조건부)

- [ ] **Step 1: stale 안내**

`renderDashboard` 하단의 generated_at 줄을, 생성 후 7일 경과 시 주황 안내로:

```javascript
    let staleNote = '';
    const gen = Date.parse((INDEX.generated_at || '').replace(' ', 'T'));
    if (gen && (Date.now() - gen) > 7 * 864e5) {
      staleNote = `<span style="color:var(--status-review)"> · ⚠ 인덱스가 오래되었습니다 — gen_docsify.py 재실행 권장</span>`;
    }
```

그리고 generated_at 표시 줄에 `${staleNote}` 추가.

- [ ] **Step 2: BAT 탭 조건부 표시**

`renderDomainView`의 탭 생성에서 BAT는 `d.bat > 0`일 때만 노출:

```javascript
    const tabKeys = ['inf', 'uis', 'sch'].concat((d.bat || 0) > 0 ? ['bat'] : []);
    const tabs = tabKeys.map(t =>
      `<div class="sl-tab ${ACTIVE_TAB === t ? 'active' : ''}" role="button" tabindex="0"
            onclick="SlViewer.selectTab('${t}')">${t.toUpperCase()} ${d[t] || 0}</div>`
    ).join('');
```

BAT 본문 분기는 "준비 중" 대신, 데이터 없으면 도달 불가하므로 안내 문구를 "BAT 산출물 없음"으로 정리.

- [ ] **Step 3: 검증**

BAT 0인 도메인은 BAT 탭 미표시. generated_at 7일 경과 시 경고(테스트: 인덱스 generated_at을 과거로 수동 편집해 확인).

- [ ] **Step 4: 커밋**

```bash
git add docs/viewer/docsify-sl.js
git commit -m "feat(speclens): 인덱스 stale 경고 + BAT 탭 조건부(준비중 제거)"
```

---

## Phase 7 — 문서 동기화 + 릴리즈

### Task 14: 참조 문서 동기화 + 버전 bump

**Files:**
- Modify: `skills/sl-viewer/SKILL.md`, `scripts/README.md`, `CLAUDE.md`, `.claude-plugin/plugin.json`

- [ ] **Step 1: SKILL.md 사용법 갱신**

`skills/sl-viewer/SKILL.md`의 "사용 방법"에 신규 기능 추가: 연결관계 패널, 브레드크럼, 사이드바 검색, 미리보기 확대, 대시보드 정렬·갭, 반응형 토글.

- [ ] **Step 2: scripts/README.md — gen_docsify 출력 필드 갱신**

`gen_docsify.py` 항목에 신규 인덱스 필드(uis.inf_ids, inf.sch_ids, *.func, gaps) 명시.

- [ ] **Step 3: CLAUDE.md 버전 노트 + plugin.json bump**

`.claude-plugin/plugin.json` version을 `3.9.0` → `3.10.0`. CLAUDE.md 상단 버전 노트 1줄 추가:

```
> **v3.10.0** (SpecLens 재설계): 뷰어에 연결관계 패널(UIS→INF→SCH→FUNC)·브레드크럼·사이드바 구조검색·UIS 미리보기 라이트박스·대시보드 정렬/연결갭 배지·반응형/키보드 접근성 추가. gen_docsify 인덱스에 관계필드(uis.inf_ids·inf.sch_ids·*.func·gaps) 보강(하위호환). 테스트 test_speclens_index.py(2스택).
```

- [ ] **Step 4: 잔존 참조 확인**

Run: `grep -rn "준비 중" docs/viewer/ ; grep -rn "3.9.0" .claude-plugin/plugin.json`
Expected: "준비 중" 0건, plugin.json은 3.10.0.

- [ ] **Step 5: 전체 회귀 + 커밋**

Run: `python -m pytest scripts/tests/test_speclens_index.py -v`
Expected: 4 PASS

```bash
git add skills/sl-viewer/SKILL.md scripts/README.md CLAUDE.md .claude-plugin/plugin.json
git commit -m "docs(speclens): v3.10.0 재설계 문서 동기화 + 버전 bump"
```

---

## Self-Review (작성자 점검 결과)

**1. 스펙 커버리지**
- 설계 §4.1 화면뷰어 → Task 7,8 ✅
- §4.2 연결패널 → Task 6 ✅
- §4.3 브레드크럼+검색 → Task 5, 10 ✅
- §4.4 대시보드(정렬·필터·갭) → Task 9 ✅ (도메인명 필터는 사이드바 검색 Task 10이 사실상 흡수 — 대시보드 행 필터는 정렬+검색으로 대체, YAGNI)
- §4.5 마감(반응형·접근성·stale·BAT) → Task 11,12,13 ✅
- §3 인덱스 보강 → Task 1~4 ✅
- §5 문서 동기화 → Task 14 ✅

**2. Placeholder 스캔**: Task 1 Step 3에 의도적 "placeholder removed below" 설명 주석이 있으나, 바로 아래 교정 코드블록을 제공함(실행자 혼동 방지 위해 깔끔한 최종형 명시). 그 외 TBD/TODO 없음.

**3. 타입 일관성**: 인덱스 필드명 통일 — `inf_ids`(UIS), `sch_ids`(INF), `func`(전체), `gaps.{uis_no_inf,inf_no_sch}`. JS 함수명 통일 — `resolveCurrentEntity`/`injectBreadcrumb`/`injectRelationPanel`/`removeRelationPanel`/`openLightbox`/`enhanceImages`. 공개 API: `sortDash`/`search`/`toggleSidebar`. SCH의 참조 INF는 인덱스 원필드 `inf`(배열) 사용(Task 2/6 일치).

**4. 모호성**: 우측 패널 충돌은 "상세에선 연결패널 우선, Quick Nav 숨김"으로 명시 결정(Task 6 Step 3).
