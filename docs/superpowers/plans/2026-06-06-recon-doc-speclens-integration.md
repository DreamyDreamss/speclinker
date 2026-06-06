# RECON-doc 현행화 + SpecLens 통합 + 연결 그래프 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** recon-doc 파이프라인을 사실기반으로 정리(si-graph 제거·rtm 현행화·funcs_index SCH링크)하고, 그 산출물을 SpecLens에서 활용(funcs 인덱싱·FUNC 네비·OVERVIEW 노출)하며, 스펙 연결을 시작점 N-hop mermaid 그래프로 본다.

**Architecture:** 빌드리스(docsify+바닐라 JS) 유지. Python 인덱스 계층(`build_funcs_index`·`gen_docsify`)에 관계/엔티티 필드를 **추가**(하위호환). 그래프는 기존 `spec_index` 관계로 클라이언트 BFS→mermaid 렌더(추가 데이터 없음).

**Tech Stack:** Python3(pytest 호환 테스트), 바닐라 JS(IIFE), mermaid@10(CDN), Docsify4.

**참조:** 설계서 `docs/superpowers/specs/2026-06-06-recon-doc-speclens-integration-design.md`

**검증 베드:** nkshop 실데이터 `D:\nkshop-bos\nkshop-bos-admin`(INF/UIS/SCH 보유, FUNC_MAP 없음). 테스트는 tempdir 픽스처. JS 단위 하네스 없음 → node --check + playwright 헤드리스 스모크.

**범용성 의무(CLAUDE.md):** 인덱스 테스트 픽스처는 Java/Next.js 양식 모두 무관(ID·frontmatter 기반)하나, 경로 픽스처는 도메인중첩 구조 사용.

---

## File Structure

- `scripts/build_funcs_index.py` — **수정**: `collect_sch_index` 추가, INF 항목에 `sch_ids`, funcs_index 출력에 `schs` 섹션.
- `scripts/tests/test_funcs_index_uis.py` — **수정**: SCH 링크 검증 테스트 추가.
- `scripts/gen_docsify.py` — **수정**: `scan_funcs` 추가, index에 `funcs[]`, `domains[d].overview`.
- `scripts/tests/test_speclens_index.py` — **수정**: `scan_funcs`·overview 검증.
- `agents/rtm-agent.md`, `skills/sl-recon-doc/SKILL.md` — **수정**: 9-4 프롬프트 필드 현행화 + si-graph(9-0-1/STEP11) 제거.
- `scripts/build_si_graph.py` — **수정**: STATUS DEPRECATED 표기(동작 불변).
- `docs/viewer/docsify-sl.js` — **수정**: goToId FUNC 해소·크로스링크 보정·resolveCurrentEntity FUNC·OVERVIEW 링크·buildSpecGraph·openGraph.
- `docs/viewer/sl-theme.css` — **수정**: 그래프 오버레이/버튼 스타일.
- `docs/viewer/index.html` — **수정**: mermaid CDN.
- `docs/RECON_PIPELINE.md`, `scripts/README.md`, `skills/sl-viewer/SKILL.md`, `CLAUDE.md`, `.claude-plugin/plugin.json` — **수정**: 동기화 + v3.12.0.

---

## Phase A — recon-doc 파이프라인 정리

### Task 1: funcs_index에 INF→SCH 링크

**Files:**
- Modify: `scripts/build_funcs_index.py`
- Test: `scripts/tests/test_funcs_index_uis.py`

- [ ] **Step 1: 실패 테스트 추가**

`test_funcs_index_uis.py`의 `_build_project`에 SCH 파일을 추가하고, INF 항목에 sch_ids가 채워지는지 검증.

기존 `_build_project(uis_dirname)` 함수의 INF 작성 줄 다음에 SCH 작성 추가(이 줄을 INF `_write(...)` 호출 바로 뒤에 삽입):

```python
    _write(os.path.join(design, 'product', 'SCH', 'SCH-PRD-009.md'),
           "---\nsch-id: SCH-PRD-009\ntable: PRODUCT\ndomain: product\ninf: [INF-PRD-001]\n---\n\n# SCH-PRD-009: PRODUCT\n")
```

그리고 새 테스트 함수 추가:

```python
def test_funcs_index_includes_sch_links():
    tmp = _build_project('UIS')
    try:
        idx = _run(tmp)
        # INF 항목에 sch_ids
        inf = idx['infs'].get('INF-PRD-001', {})
        assert inf.get('sch_ids') == ['SCH-PRD-009'], inf
        # funcs_index에 schs 섹션
        assert 'SCH-PRD-009' in idx.get('schs', {}), idx.get('schs')
        assert idx['schs']['SCH-PRD-009']['table'] == 'PRODUCT'
        # func entry의 inf에 sch_ids 전파
        func = idx['funcs'][0]
        inf_entry = next((i for i in func['inf'] if i['id'] == 'INF-PRD-001'), None)
        assert inf_entry and inf_entry.get('sch_ids') == ['SCH-PRD-009'], inf_entry
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest scripts/tests/test_funcs_index_uis.py::test_funcs_index_includes_sch_links -v`
Expected: FAIL — `idx['infs']['INF-PRD-001']`에 sch_ids 없음(KeyError/None) 또는 `schs` 키 없음

- [ ] **Step 3: `collect_sch_index` 구현 + 배선**

`scripts/build_funcs_index.py`의 `collect_inf_index` 함수 **다음에** 추가:

```python
def collect_sch_index(domains_list):
    """모든 도메인 SCH/SCH-*.md 스캔 → (inf_to_sch, sch_meta).
    inf_to_sch: {INF-ID: [SCH-ID...]}, sch_meta: {SCH-ID: {table, inf, schPath, domain}}."""
    inf_to_sch, sch_meta = {}, {}
    scan_domains = domains_list if domains_list else (
        [d for d in os.listdir(DOCS) if os.path.isdir(os.path.join(DOCS, d))]
        if os.path.isdir(DOCS) else []
    )
    for domain in scan_domains:
        sch_dir = os.path.join(DOCS, domain, 'SCH')
        if not os.path.isdir(sch_dir):
            continue
        for fname in sorted(os.listdir(sch_dir)):
            if not (fname.startswith('SCH-') and fname.endswith('.md')):
                continue
            fm_text, _ = split_frontmatter(read_raw(os.path.join(sch_dir, fname)))
            fm = parse_simple_fm(fm_text)
            sch_id = fm.get('sch-id') or fname[:-3]
            raw_inf = (fm.get('inf') or '').strip().strip('[]')
            inf_ids = [x.strip() for x in raw_inf.split(',') if x.strip()]
            sch_meta[sch_id] = {'table': fm.get('table', ''), 'inf': inf_ids,
                                'schPath': f'docs/05_설계서/{domain}/SCH/{fname}', 'domain': domain}
            for iid in inf_ids:
                inf_to_sch.setdefault(iid, [])
                if sch_id not in inf_to_sch[iid]:
                    inf_to_sch[iid].append(sch_id)
    return inf_to_sch, sch_meta
```

`main()`에서 `inf_index = collect_inf_index(domains)` **다음 줄**에 추가:

```python
    inf_to_sch, sch_meta = collect_sch_index(domains)
    for iid, meta in inf_index.items():
        meta['sch_ids'] = inf_to_sch.get(iid, [])
```

`func_entry`의 `inf_list` 구성부(각 `inf_index[iid]`를 append하는 부분)는 이미 `inf_index` 참조를 담으므로 sch_ids가 자동 포함된다. 단 INF 미생성 폴백 dict(`'(INF 미생성)'` 블록)에 `'sch_ids': []` 키 추가.

`out` dict(funcs_index 출력)에 `schs` 섹션 추가 — `'infs': inf_index,` 다음 줄:

```python
        'schs':        sch_meta,
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest scripts/tests/test_funcs_index_uis.py -v`
Expected: 3개 PASS(기존 2 + 신규 1)

- [ ] **Step 5: nkshop 실측 + 커밋**

Run: `cd scripts && python build_funcs_index.py "D:\nkshop-bos\nkshop-bos-admin" && python -c "import json;d=json.load(open(r'D:\nkshop-bos\nkshop-bos-admin\_tmp\funcs_index.json',encoding='utf-8'));print('schs:',len(d.get('schs',{})));print('inf sch_ids 샘플:',[(k,v.get('sch_ids')) for k,v in list(d['infs'].items())[:3]])"`
Expected: schs > 0, 일부 INF에 sch_ids 채워짐

```bash
git add scripts/build_funcs_index.py scripts/tests/test_funcs_index_uis.py
git commit -m "feat(recon-doc): funcs_index에 INF->SCH 링크(collect_sch_index)"
```

### Task 2: rtm-agent 프롬프트 필드 현행화

**Files:**
- Modify: `agents/rtm-agent.md`
- Modify: `skills/sl-recon-doc/SKILL.md` (9-4 프롬프트)

- [ ] **Step 1: rtm-agent.md 데이터소스 문구 수정**

`agents/rtm-agent.md`에서 `related_sch` 및 `used_by_screens` 참조를 찾아 현행 필드로 교체. 검색:

Run: `grep -n "related_sch\|used_by_screens" agents/rtm-agent.md`

각 매치를 다음 원칙으로 수정:
- `used_by_screens` → `screens`(INF frontmatter 실제 필드) 또는 "funcs_index의 화면↔INF(사실 연결)".
- `related_sch` → "INF frontmatter `tables:` + funcs_index `infs[].sch_ids`(SCH.inf 역인덱스, 사실 기반)".

문구 예(INF↔SCH 소스 항목): `INF↔SCH 연결은 funcs_index의 infs[].sch_ids(SCH frontmatter inf 역인덱스, 사실 기반)를 사용한다. 보조로 INF frontmatter tables:.`

- [ ] **Step 2: sl-recon-doc 9-4 프롬프트 수정**

`skills/sl-recon-doc/SKILL.md`의 9-4 rtm 프롬프트 "데이터 소스 우선순위" 블록에서:
- `1. INF 파일의 used_by_screens 필드` → `1. funcs_index의 화면↔INF(사실 연결) 및 INF frontmatter screens:`
- `4. INF↔SCH 연결은 INF 파일의 related_sch 또는 테이블명 기반 추론` → `4. INF↔SCH 연결은 funcs_index infs[].sch_ids(SCH.inf 역인덱스, 사실 기반)`

- [ ] **Step 3: 잔존 확인 + 커밋**

Run: `grep -rn "related_sch\|used_by_screens" agents/rtm-agent.md skills/sl-recon-doc/SKILL.md`
Expected: `related_sch` 0건. `used_by_screens`는 설명 맥락 외 데이터소스 지시문에서 0건(funcs_index가 used_by_screens를 내부적으로 계산하는 언급은 허용).

```bash
git add agents/rtm-agent.md skills/sl-recon-doc/SKILL.md
git commit -m "fix(recon-doc): rtm 프롬프트 데이터소스 현행화(related_sch/used_by_screens->사실링크)"
```

### Task 3: si-graph 제거 (파이프라인에서)

**Files:**
- Modify: `skills/sl-recon-doc/SKILL.md`
- Modify: `scripts/build_si_graph.py` (DEPRECATED 표기)
- Modify: `docs/RECON_PIPELINE.md`, `scripts/README.md`

- [ ] **Step 1: sl-recon-doc STEP 9-0-1 삭제**

`skills/sl-recon-doc/SKILL.md`에서 `**9-0-1. SI 트레이싱 그래프 빌드` 헤더부터 그 코드블록(build_si_graph 실행 bash) 끝(다음 `---` 직전)까지 블록 전체를 삭제. 바로 뒤 INF/UIS/SCH 설명문(`INF/UIS/SCH 파일을 스캔하여...si-graph.json`)도 삭제.

- [ ] **Step 2: STEP 11 si-graph 확인 제거**

`skills/sl-recon-doc/SKILL.md` STEP 11 블록:

```
## STEP 11 — si-graph 갱신 확인

!test -f .understand-anything/si-graph.json ...
```

을 다음으로 교체(STEP 11 자체를 제거하고 RECON 완료로 직행):

```markdown
---

## RECON 완료
```

> 주의: 이미 그 아래 "## RECON 완료" 섹션이 있으면 중복 헤더가 생기지 않도록 STEP 11 블록만 제거. 최종 체크포인트(`_tmp/recon_checkpoint.json` 갱신)는 그대로 유지.

- [ ] **Step 3: build_si_graph.py DEPRECATED 표기**

`scripts/build_si_graph.py` 최상단 `# STATUS: 완료`를 다음으로 교체:

```python
# STATUS: DEPRECATED (v3.12) — si-graph.json은 소비처가 없어 recon-doc 파이프라인에서 제거됨.
#   스펙→소스 추적은 INF frontmatter anchors: + spec_index가 대체. 직접 호출 시 동작은 유지.
```

- [ ] **Step 4: 문서 동기화**

`docs/RECON_PIPELINE.md`에서 STEP 9-0-1(build_si_graph) 및 STEP 11(si-graph 확인) 관련 행/문구 제거(완료 체크포인트 라인은 유지). 다이어그램의 `9-0-1 build_si_graph.py` 토큰 제거.

`scripts/README.md`의 `build_si_graph.py` 행 STATUS를 `⚠️DEPRECATED`로, 목적 끝에 "(소비처 없어 recon-doc서 제거, v3.12)" 추가.

- [ ] **Step 5: 잔존 확인 + 커밋**

Run: `grep -rn "build_si_graph\|si-graph" skills/sl-recon-doc/SKILL.md docs/RECON_PIPELINE.md`
Expected: sl-recon-doc에서 build_si_graph 호출 0건(완료 안내 문구에도 si-graph 없음)

```bash
git add skills/sl-recon-doc/SKILL.md scripts/build_si_graph.py docs/RECON_PIPELINE.md scripts/README.md
git commit -m "refactor(recon-doc): orphan si-graph 제거(STEP 9-0-1/11) + build_si_graph DEPRECATED"
```

---

## Phase B — SpecLens 통합

### Task 4: gen_docsify `scan_funcs` + overview 인덱싱

**Files:**
- Modify: `scripts/gen_docsify.py`
- Test: `scripts/tests/test_speclens_index.py`

- [ ] **Step 1: 실패 테스트 추가**

`scripts/tests/test_speclens_index.py`에 추가:

```python
def test_scan_funcs_from_funcmap():
    tmp = tempfile.mkdtemp()
    fdir = os.path.join(tmp, 'docs', '00_FUNC')
    os.makedirs(fdir)
    with open(os.path.join(fdir, 'FUNC_MAP.md'), 'w', encoding='utf-8') as f:
        f.write("| UIS-ID | 화면명 | FUNC-ID | 호출 INF | 연관 SCH |\n|---|---|---|---|---|\n")
        f.write("| UIS-PRD-001 | 상품등록 | FUNC-product-001 | INF-PRD-205, INF-PRD-206 | SCH-PRD-009 |\n")
    funcs = G.scan_funcs(tmp)
    assert len(funcs) == 1, funcs
    fn = funcs[0]
    assert fn['id'] == 'FUNC-product-001'
    assert fn['domain'] == 'product'
    assert 'UIS-PRD-001' in fn['uis']
    assert set(fn['inf']) == {'INF-PRD-205', 'INF-PRD-206'}
    assert fn['sch'] == ['SCH-PRD-009']

def test_scan_funcs_absent_graceful():
    tmp = tempfile.mkdtemp()
    os.makedirs(os.path.join(tmp, 'docs'))
    assert G.scan_funcs(tmp) == []
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest scripts/tests/test_speclens_index.py::test_scan_funcs_from_funcmap -v`
Expected: FAIL — `module 'gen_docsify' has no attribute 'scan_funcs'`

- [ ] **Step 3: `scan_funcs` 구현**

`scripts/gen_docsify.py`의 `load_func_links` 함수 **다음에** 추가:

```python
def scan_funcs(spec_root: str) -> list:
    """FUNC_MAP.md(+domains/FUNC_*.md) 파싱 → funcs[] 목록.
    각 표 행에서 FUNC/UIS/INF/SCH ID를 정규식으로 수집(컬럼 순서 비의존)."""
    fp = os.path.join(spec_root, 'docs', '00_FUNC', 'FUNC_MAP.md')
    if not os.path.exists(fp):
        return []
    with open(fp, encoding='utf-8', errors='replace') as f:
        lines = f.read().splitlines()
    func_re = re.compile(r'FUNC-[A-Za-z]+-\d+')
    uis_re = re.compile(r'UIS-[A-Za-z]+-\d+(?:-T\d+)?')
    inf_re = re.compile(r'INF-[A-Za-z]+-\d+')
    sch_re = re.compile(r'SCH-[A-Za-z]+-\d+')
    name_cell_re = re.compile(r'\|([^|]+)\|')
    funcs = []
    for line in lines:
        fids = func_re.findall(line)
        if not fids:
            continue
        fid = fids[0]
        domain = fid.split('-')[1] if len(fid.split('-')) >= 3 else ''
        # 기능명: 표 셀 중 ID 토큰이 없는 첫 한글/텍스트 셀
        name = ''
        for cell in name_cell_re.findall(line):
            c = cell.strip()
            if c and not (func_re.search(c) or uis_re.search(c) or inf_re.search(c) or sch_re.search(c)) and '---' not in c:
                name = c
                break
        funcs.append({
            'id': fid,
            'name': name,
            'domain': domain,
            'file': 'docs/00_FUNC/FUNC_MAP.md',
            'uis': sorted(set(uis_re.findall(line))),
            'inf': sorted(set(inf_re.findall(line))),
            'sch': sorted(set(sch_re.findall(line))),
        })
    return funcs
```

- [ ] **Step 4: generate_index 배선 + overview**

`generate_index`에서 관계 보강(`resolve_uis_inf` 등) 블록 다음에 추가:

```python
    funcs = scan_funcs(spec_root)
    # 도메인별 OVERVIEW 경로
    for d in domains:
        ov = os.path.join('docs', '05_설계서', d, f'OVERVIEW_{d}.md')
        if os.path.isfile(os.path.join(spec_root, ov)):
            domains[d]['overview'] = ov.replace('\\', '/')
```

> 주의: 위 `for d in domains` 루프는 `domains` dict가 완성된 **후**(sprint 집계 다음, index dict 생성 전)에 둔다.

index dict에 `'funcs': funcs,` 추가(`'gaps': gaps,` 다음 줄).

- [ ] **Step 5: 통과 확인 + 커밋**

Run: `python -m pytest scripts/tests/test_speclens_index.py -v`
Expected: 기존 + 신규 2개 PASS

```bash
git add scripts/gen_docsify.py scripts/tests/test_speclens_index.py
git commit -m "feat(speclens): gen_docsify funcs[] 인덱싱 + 도메인 overview 경로"
```

### Task 5: docsify-sl.js — goToId FUNC 해소 + 크로스링크 보정

**Files:**
- Modify: `docs/viewer/docsify-sl.js`

> 검증: `cd "D:\nkshop-bos\nkshop-bos-admin" && python {PLUGIN}/scripts/gen_docsify.py . && python -m http.server 5199` → 브라우저. (FUNC_MAP 없으면 funcs[] 빈 상태로 graceful 확인)

- [ ] **Step 1: goToId에 FUNC 분기 추가**

`docs/viewer/docsify-sl.js`의 `goToId(id)` 메서드에서 마지막 uis 분기 다음에 추가:

```javascript
      const fn = INDEX.funcs && INDEX.funcs.find(f => f.id === id);
      if (fn) { this.openSpec(fn.file); return; }
```

- [ ] **Step 2: 크로스링크 FUNC 정규식 대소문자 보정**

`addCrosslinks`의 패턴에서 `FUNC-[a-z]+-\d+` → `FUNC-[A-Za-z]+-\d+`:

```javascript
    const pattern = /\b(INF-[A-Z]+-\d+|UIS-[A-Z]+-\d+|SCH-[A-Z]+-\d+|FUNC-[A-Za-z]+-\d+)\b/g;
```

- [ ] **Step 3: resolveCurrentEntity에 FUNC 인식**

`resolveCurrentEntity`의 정규식과 pools에 FUNC 추가:

```javascript
    const m = hash.match(/(INF-[A-Z]+-\d+|UIS-[A-Z]+-\d+(?:-T\d+)?|SCH-[A-Z]+-\d+|BAT-[A-Z]+-\d+|FUNC-[A-Za-z]+-\d+)/);
```

그리고 pools 배열에 `['func', INDEX.funcs]` 추가:

```javascript
    const pools = [['inf', INDEX.infs], ['uis', INDEX.uis], ['sch', INDEX.schs], ['func', INDEX.funcs]];
```

- [ ] **Step 4: 문법 검증 + 커밋**

Run: `node --check docs/viewer/docsify-sl.js`
Expected: 출력 없음(정상)

```bash
git add docs/viewer/docsify-sl.js
git commit -m "fix(speclens): goToId FUNC 해소(죽은클릭 해결) + 크로스링크 대소문자 보정"
```

### Task 6: docsify-sl.js — 도메인 뷰 OVERVIEW 노출

**Files:**
- Modify: `docs/viewer/docsify-sl.js`

- [ ] **Step 1: renderDomainView 헤더에 OVERVIEW 링크**

`renderDomainView`의 `main.innerHTML` 도메인 헤더 부분에서 `<h3 ...>${domain}</h3>` 다음에 overview 링크 추가. 해당 템플릿을 다음으로 교체:

```javascript
    main.innerHTML = `
      <div class="sl-domain-header">
        <h3 style="color:var(--accent);margin:0 0 6px">${domain}${d.overview ? ` <span class="sl-ov-link" role="button" tabindex="0" onclick="SlViewer.openSpec('${escAttr(d.overview)}')">📖 도메인 개요</span>` : ''}</h3>
        <div class="sl-tabs">${tabs}</div>
      </div>
      ${body}`;
```

- [ ] **Step 2: CSS 추가**

`docs/viewer/sl-theme.css`의 `.sl-domain-header` 규칙 다음에 추가:

```css
.sl-ov-link { font-size: 11px; font-weight: 400; color: var(--text-muted); border: 1px solid var(--border); border-radius: 4px; padding: 1px 8px; margin-left: 8px; cursor: pointer; }
.sl-ov-link:hover { color: var(--accent); border-color: var(--accent); }
```

- [ ] **Step 3: 문법 검증 + 커밋**

Run: `node --check docs/viewer/docsify-sl.js`
Expected: 정상

```bash
git add docs/viewer/docsify-sl.js docs/viewer/sl-theme.css
git commit -m "feat(speclens): 도메인 뷰에 OVERVIEW 도메인 개요 링크"
```

---

## Phase C — 스펙 연결 그래프 (mermaid)

### Task 7: mermaid 연결 그래프 (시작점 N-hop)

**Files:**
- Modify: `docs/viewer/index.html` (mermaid CDN)
- Modify: `docs/viewer/docsify-sl.js` (buildSpecGraph·openGraph·버튼)
- Modify: `docs/viewer/sl-theme.css` (오버레이/버튼)

- [ ] **Step 1: index.html에 mermaid CDN 추가**

`docs/viewer/index.html`의 search 플러그인 `<script>` 다음 줄에 추가:

```html
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
```

- [ ] **Step 2: buildSpecGraph + openGraph 함수 추가**

`docs/viewer/docsify-sl.js`의 `removeRelationPanel` 함수 **다음에** 추가:

```javascript
  // ── 스펙 연결 그래프 (시작점 N-hop) ───────────────────────────
  function _safeNode(id) { return 'n_' + String(id).replace(/[^A-Za-z0-9]/g, '_'); }

  function _neighbors(id) {
    // id의 1-hop 이웃 [{id,type}] 반환 (spec_index 관계 기반)
    if (!INDEX) return [];
    const out = [];
    const push = (x, t) => { if (x) out.push({ id: x, type: t }); };
    const uis = (INDEX.uis || []).find(u => u.id === id);
    if (uis) { (uis.inf_ids || []).forEach(i => push(i, 'inf')); if (uis.func) push(uis.func, 'func'); }
    const inf = (INDEX.infs || []).find(i => i.id === id);
    if (inf) { (inf.sch_ids || []).forEach(s => push(s, 'sch'));
               (INDEX.uis || []).filter(u => (u.inf_ids || []).includes(id)).forEach(u => push(u.id, 'uis'));
               if (inf.func) push(inf.func, 'func'); }
    const sch = (INDEX.schs || []).find(s => s.id === id);
    if (sch) { (sch.inf || []).forEach(i => push(i, 'inf')); if (sch.func) push(sch.func, 'func'); }
    const fn = (INDEX.funcs || []).find(f => f.id === id);
    if (fn) { (fn.uis || []).forEach(u => push(u, 'uis')); (fn.inf || []).forEach(i => push(i, 'inf')); (fn.sch || []).forEach(s => push(s, 'sch')); }
    return out;
  }

  function _typeOf(id) {
    if (/^UIS-/.test(id)) return 'uis';
    if (/^INF-/.test(id)) return 'inf';
    if (/^SCH-/.test(id)) return 'sch';
    if (/^FUNC-/i.test(id)) return 'func';
    return 'x';
  }

  function _label(id) {
    const pools = [INDEX.uis, INDEX.infs, INDEX.schs, INDEX.funcs];
    for (const p of pools) {
      const hit = (p || []).find(x => x.id === id);
      if (hit) { const nm = hit.name || hit.table || ''; return nm ? id + '\\n' + nm : id; }
    }
    return id;
  }

  function buildSpecGraph(startId, depth, types) {
    // BFS depth-hop, types=Set(허용 타입). mermaid graph LR 문자열 반환.
    const seen = new Set([startId]);
    const edges = [];
    let frontier = [startId];
    for (let d = 0; d < depth; d++) {
      const next = [];
      frontier.forEach(cur => {
        _neighbors(cur).forEach(nb => {
          if (types && !types.has(nb.type)) return;
          edges.push([cur, nb.id]);
          if (!seen.has(nb.id)) { seen.add(nb.id); next.push(nb.id); }
        });
      });
      frontier = next;
    }
    const lines = ['graph LR'];
    seen.forEach(id => {
      const t = _typeOf(id);
      lines.push(`  ${_safeNode(id)}["${_label(id)}"]:::${t}`);
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
    return { def: lines.join('\n'), count: seen.size };
  }

  let GRAPH_START = null, GRAPH_DEPTH = 2;
  async function openGraph(startId) {
    GRAPH_START = startId;
    document.getElementById('sl-graph')?.remove();
    const types = new Set(['uis', 'inf', 'sch', 'func']);
    const { def, count } = buildSpecGraph(startId, GRAPH_DEPTH, types);
    const ov = document.createElement('div');
    ov.id = 'sl-graph';
    ov.innerHTML =
      `<div class="sl-graph-bar">
         <span>🕸 ${escAttr(startId)} — ${count} 노드 (깊이 ${GRAPH_DEPTH})</span>
         <span class="sl-graph-ctl">
           깊이 <button onclick="SlViewer.graphDepth(1)">1</button>
           <button onclick="SlViewer.graphDepth(2)">2</button>
           <button onclick="SlViewer.graphDepth(3)">3</button>
           <span class="sl-graph-close" role="button" tabindex="0" onclick="document.getElementById('sl-graph').remove()">✕ 닫기 (ESC)</span>
         </span>
       </div>
       <div class="sl-graph-body">${count > 60 ? '<p style=\"color:var(--status-review)\">노드가 많습니다 — 깊이를 줄이세요.</p>' : ''}<div class="mermaid" id="sl-graph-mermaid"></div></div>`;
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
```

- [ ] **Step 3: 공개 API에 graphDepth + 연결패널 버튼**

공개 API(`window.SlViewer`)에 추가(`toggleSidebar` 다음):

```javascript
    openGraph(id) { openGraph(id); },
    graphDepth(d) { GRAPH_DEPTH = d; if (GRAPH_START) openGraph(GRAPH_START); },
```

`injectRelationPanel`에서 패널 title 줄을 버튼 포함으로 교체:

```javascript
    panel.innerHTML = `<div class="sl-rel-title">🔗 연결관계 <span class="sl-graph-btn" role="button" tabindex="0" onclick="SlViewer.openGraph('${escAttr(e.id)}')">🕸 그래프</span></div>${sections}`;
```

- [ ] **Step 4: CSS 추가**

`docs/viewer/sl-theme.css` 끝에 추가:

```css
/* 스펙 연결 그래프 */
.sl-graph-btn { float: right; font-size: 10px; font-weight: 400; color: var(--text-muted); border: 1px solid var(--border); border-radius: 4px; padding: 1px 7px; cursor: pointer; }
.sl-graph-btn:hover { color: var(--accent); border-color: var(--accent); }
#sl-graph { position: fixed; inset: 0; background: rgba(13,17,23,.97); z-index: 210; display: flex; flex-direction: column; }
.sl-graph-bar { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--border); color: var(--text-primary); font-size: 13px; }
.sl-graph-ctl button { background: var(--bg-secondary); border: 1px solid var(--border); color: var(--text-muted); border-radius: 4px; padding: 2px 8px; cursor: pointer; margin: 0 1px; }
.sl-graph-ctl button:hover { color: var(--accent); border-color: var(--accent); }
.sl-graph-close { margin-left: 14px; cursor: pointer; color: var(--text-muted); }
.sl-graph-close:hover { color: var(--accent); }
.sl-graph-body { flex: 1; overflow: auto; padding: 20px; display: flex; justify-content: center; }
.sl-graph-body .mermaid svg { max-width: 100%; }
```

- [ ] **Step 5: 문법 검증 + playwright 스모크**

Run: `node --check docs/viewer/docsify-sl.js`
Expected: 정상

playwright 스모크(합성 인덱스에 funcs+관계 포함하여 그래프 버튼→mermaid 노드 생성 확인). 임시 디렉토리에 viewer 자산 + 합성 spec_index.json(UIS-PRD-001 inf_ids=[INF-PRD-205], INF sch_ids=[SCH-PRD-009], funcs 1) 작성 후 서빙:

```javascript
// /tmp/sl_graph_smoke.cjs 요지
const { chromium } = require('D:/gen-harness/plugins/speclinker/node_modules/playwright-core');
// ... 서빙 후:
// await page.evaluate(()=>SlViewer.openGraph('UIS-PRD-001'));
// await page.waitForTimeout(600);
// const nodes = await page.$$eval('#sl-graph .mermaid svg .node', e=>e.length).catch(()=>0);
// console.log('graph nodes:', nodes);  // >=2 기대
```

Expected: graph nodes >= 2, JS 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add docs/viewer/index.html docs/viewer/docsify-sl.js docs/viewer/sl-theme.css
git commit -m "feat(speclens): 스펙 연결 mermaid 그래프(시작점 N-hop, 노드 클릭 이동)"
```

---

## Phase D — 문서 동기화 + 릴리즈

### Task 8: 동기화 + v3.12.0

**Files:**
- Modify: `skills/sl-viewer/SKILL.md`, `docs/RECON_PIPELINE.md`, `scripts/README.md`, `CLAUDE.md`, `.claude-plugin/plugin.json`

- [ ] **Step 1: sl-viewer SKILL 갱신**

`skills/sl-viewer/SKILL.md` "사용 방법"에 추가: "연결관계 패널의 🕸 그래프 버튼 → 시작점 N-hop 스펙 연결 그래프(mermaid, 노드 클릭 이동)", "도메인 개요(OVERVIEW) 링크", "FUNC 크로스링크 이동".

- [ ] **Step 2: scripts/README — gen_docsify 출력 필드 갱신**

`gen_docsify.py` 행 설명에 `funcs[]`(FUNC_MAP 파싱), `domains[].overview` 추가. `build_funcs_index.py` 행에 `schs`/`inf.sch_ids` 추가.

- [ ] **Step 3: CLAUDE.md 버전 노트 + plugin.json bump**

`.claude-plugin/plugin.json` version `3.11.1` → `3.12.0`. CLAUDE.md 상단에 노트 추가:

```
> **v3.12.0** (RECON-doc 현행화 마무리 + SpecLens 통합 + 연결그래프): ①orphan si-graph 제거(STEP 9-0-1/11, build_si_graph DEPRECATED) ②rtm 프롬프트 사실링크화(related_sch/used_by_screens 제거) ③funcs_index INF→SCH 링크(collect_sch_index) ④gen_docsify funcs[] 인덱싱+도메인 overview ⑤SpecLens goToId FUNC 해소(죽은클릭 수정)+OVERVIEW 링크 ⑥스펙 연결 mermaid 그래프(시작점 N-hop). 테스트 test_funcs_index_uis/test_speclens_index 확장. 설계·플랜 docs/superpowers/{specs,plans}/2026-06-06-recon-doc-speclens-integration*.
```

- [ ] **Step 4: 전체 회귀 + 커밋**

Run: `python -m pytest scripts/tests/test_funcs_index_uis.py scripts/tests/test_speclens_index.py -q && node --check docs/viewer/docsify-sl.js`
Expected: 전체 PASS + JS 정상

```bash
git add skills/sl-viewer/SKILL.md docs/RECON_PIPELINE.md scripts/README.md CLAUDE.md .claude-plugin/plugin.json
git commit -m "docs(speclens): v3.12.0 동기화 + 버전 bump"
```

---

## Self-Review (작성자 점검)

**1. 스펙 커버리지**
- A1 si-graph 제거 → Task 3 ✅
- A2 rtm 현행화 → Task 2 ✅
- A3 funcs_index SCH 링크 → Task 1 ✅
- B1 gen_docsify funcs+overview → Task 4 ✅
- B2 goToId FUNC+크로스링크 → Task 5 ✅
- B3 도메인 OVERVIEW 노출 → Task 6 ✅
- C1/C2 mermaid 그래프 → Task 7 ✅
- 문서 동기화 → Task 8 ✅

**2. Placeholder 스캔**: TBD/TODO 없음. 모든 코드 스텝에 실제 코드 포함.

**3. 타입 일관성**: 인덱스 필드 — funcs[{id,name,domain,file,uis,inf,sch}], infs[].sch_ids, schs(funcs_index)=sch_meta, domains[].overview. JS — buildSpecGraph/openGraph/_neighbors/_typeOf/_label/_safeNode, 공개 API openGraph/graphDepth, window.slGraphClick. gen_docsify scan_funcs는 FUNC_MAP 행 정규식(컬럼순서 비의존). build_funcs_index의 `schs`(sch_meta)와 gen_docsify의 `schs`(스펙 SCH 스캔)는 파일이 달라 충돌 없음(funcs_index vs spec_index).

**4. 모호성**: si-graph는 삭제 아닌 DEPRECATED(Task 3 Step3 명시). mermaid 클릭은 securityLevel:'loose' + click call 디렉티브로 일원화(Task 7 Step2).
