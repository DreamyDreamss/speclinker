# SRS 합성형 재설계 (사용자 뷰잉 문서) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 또는 superpowers:executing-plans. 체크박스(`- [ ]`)로 추적.

**Goal:** SRS를 "UIS 재포장"에서 **비개발자용 업무 서사 + 비즈니스 규칙 종합 문서**로 재설계해, 토큰을 *합성·해설*에만 쓰고 SpecLens에 1급 노출한다.

**Architecture:** srs-agent가 funcs_index(이미 UIS·INF·SCH·api_hints·sch_ids 보유)에서 **사실(링크·CRUD·시퀀스)은 기계 조립, 내러티브·규칙종합·예외추론만 LLM**으로 생성. SpecLens는 SRS를 도메인 탭 + 연결그래프 노드로 노출.

**Tech Stack:** Markdown 산출물, srs-agent(Sonnet), Python(gen_docsify 인덱싱), 바닐라 JS(뷰어).

**설계 근거(합의):** 토큰은 재포장이 아니라 *흩어진 정보 종합*에 쓸 때만 본전. UIS=화면 분해, SRS=기능(업무) 서사. § ①기능요약 ②업무흐름(화면 가로지름) ③비즈규칙 종합(INF 규칙+SCH 코드값+UIS 조건) ④예외·제약 = LLM 가치 / ⑤연관산출물 ⑥데이터영향(CRUD) = 기계.

**검증 베드:** nkshop `D:\nkshop-bos\nkshop-bos-admin` (단, FUNC_MAP/SRS 생성하려면 recon-doc 전체 필요 — 합성 입력은 funcs_index로 충분). 단위테스트는 tempdir 픽스처.

---

## File Structure
- `agents/srs-agent.md` — **수정**: RECON SRS-F 포맷을 합성형 6섹션으로 재정의. 토큰 배분 규칙 명시.
- `templates/SRS_template.md` — **수정**: 합성형 섹션 구조 반영(정본).
- `scripts/build_funcs_index.py` — **수정(소)**: SRS 합성에 필요한 신호가 funcs_index에 있는지 확인/보강(이미 inf[].sch_ids, api_hints, rules 있음 — 데이터영향용 CRUD 힌트만 추가 검토).
- `scripts/gen_docsify.py` — **수정**: `scan_srs()` 추가(SRS_v1.0.md/domains 파싱 → srs[] 인덱싱), index에 `srs[]`, `domains[].srs_count`.
- `scripts/tests/test_speclens_index.py` — **수정**: scan_srs 테스트.
- `docs/viewer/docsify-sl.js` — **수정**: 도메인 뷰에 SRS 탭(또는 기능명세 목록) + goToId SRS 해소 + 연결그래프 SRS 노드.
- `docs/viewer/sl-theme.css` — **수정(소)**: SRS 카드/노드 색.
- `skills/sl-recon-doc/SKILL.md`, `docs/RECON_PIPELINE.md`, `CLAUDE.md`, `plugin.json` — 동기화 + 버전.

---

## Phase A — SRS 합성 포맷 재정의 (에이전트/템플릿)

### Task 1: srs-agent RECON 포맷을 합성형 6섹션으로 재작성

**Files:** Modify `agents/srs-agent.md`

- [ ] **Step 1: RECON SRS-F 포맷 블록 교체**

기존 "### RECON SRS-F 포맷"(전제조건·기본흐름·예외흐름·API시퀀스 중심)을 아래 합성형으로 교체:

```markdown
## SRS-F-{NNN}: {기능명}  〈사용자 업무 명세〉

> **기능 요약** (3~5줄, 업무 관점): {누가 / 무엇을 / 왜}. UIS·INF를 종합해
> 비개발자가 이 기능을 한 문단으로 이해하도록. 화면/위젯 나열 금지, 업무 서사로.

### 업무 흐름
{화면을 가로지른 단일 시나리오. UIS §2 시나리오 + api_hints 시퀀스를 종합:
"사용자가 X → 시스템이 Y(어떤 API/테이블) → 결과 Z". 탭별 분해가 아니라 흐름.}

### 비즈니스 규칙  (종합)
{INF '비즈니스 규칙' + SCH 코드값/비즈주의 + UIS §5 조건을 한곳에 모음. 출처 표기:}
- {규칙}  (근거: INF-XXX / pr201Form.jsp:LLL)
- 코드값: {컬럼} {값}={의미} (출처 SCH-XXX / JT_CODE.{그룹})

### 예외·제약
{권한 없음 / 상태 부적합 / 검증 실패 시 사용자 관점 동작. UIS §5 동적조건에서 추론.}

### 연관 산출물  (기계 조립 — funcs_index)
- 화면: [{UIS-ID}](...) · API: [{INF-ID}](...) ×N · 테이블: [{SCH-ID}](...) ×N
- FUNC-ID: {FUNC-...}

### 데이터 영향
{이 기능이 생성/조회/수정/삭제하는 핵심 테이블 (INF.tables + sch_ids 기반).}
```

- [ ] **Step 2: 토큰 배분 규칙 + Reflexion 점검표 갱신**

srs-agent에 명시 추가:

```markdown
## 토큰 사용 원칙 (MUST)
- LLM 토큰은 **기능요약·업무흐름·비즈규칙 종합·예외추론**에만 쓴다.
- **연관 산출물·데이터 영향은 funcs_index에서 기계 조립**(inf[].sch_ids, api_hints, infPath 사용) — 새로 추론 금지.
- UIS §2/§5/§6를 **그대로 복붙 금지**. 반드시 업무 서사로 재구성·종합(재포장이면 결함).
```

Reflexion 점검표를 교체:
```markdown
[ ] 기능 요약이 "화면/위젯 나열"이 아니라 업무 서사 3~5줄인가?
[ ] 업무 흐름이 화면을 가로지른 단일 시나리오인가? (UIS 탭 복붙 아님)
[ ] 비즈니스 규칙에 INF+SCH+UIS 최소 2개 소스가 종합됐고 출처가 표기됐나?
[ ] 연관 산출물/데이터영향이 funcs_index 사실과 일치하나? (지어내지 않음)
[ ] FUNC-ID 역링크 존재?
[ ] 5열 색인표(SRS-F | 화면명 | UIS-ID | 호출 INF | FUNC-ID) 생성?
```

- [ ] **Step 3: 커밋**

```bash
git add agents/srs-agent.md
git commit -m "feat(srs): 합성형 SRS-F 포맷(업무서사+규칙종합) + 토큰배분 원칙"
```

### Task 2: SRS_template.md 정본 동기화

**Files:** Modify `templates/SRS_template.md`

- [ ] **Step 1: 템플릿을 합성형 6섹션으로 교체**

`templates/SRS_template.md`의 SRS-F 항목 구조(입력항목/유효성/출력항목 표 중심)를 Task 1의 6섹션 구조와 일치하도록 교체. RECON 모드 기준(요구사항 표 제거, 업무서사/규칙종합 중심).

- [ ] **Step 2: 커밋**

```bash
git add templates/SRS_template.md
git commit -m "docs(srs): SRS 템플릿 정본을 합성형 구조로 동기화"
```

---

## Phase B — SpecLens 1급 노출

### Task 3: gen_docsify `scan_srs` 인덱싱

**Files:** Modify `scripts/gen_docsify.py`; Test `scripts/tests/test_speclens_index.py`

- [ ] **Step 1: 실패 테스트 추가**

```python
def test_scan_srs_from_index_table():
    tmp = tempfile.mkdtemp()
    sdir = os.path.join(tmp, 'docs', '03_기능명세서')
    os.makedirs(sdir)
    with open(os.path.join(sdir, 'SRS_v1.0.md'), 'w', encoding='utf-8') as f:
        f.write("| SRS-F-XXX | 화면명 | UIS-ID | 호출 INF | FUNC-ID |\n|---|---|---|---|---|\n")
        f.write("| SRS-F-001 | 상품등록 | UIS-PRD-001 | INF-PRD-205 | FUNC-product-001 |\n")
    srs = G.scan_srs(tmp)
    assert len(srs) == 1, srs
    assert srs[0]['id'] == 'SRS-F-001'
    assert srs[0]['name'] == '상품등록'
    assert 'UIS-PRD-001' in srs[0]['uis']
    assert srs[0]['func'] == 'FUNC-product-001'

def test_scan_srs_absent_graceful():
    tmp = tempfile.mkdtemp(); os.makedirs(os.path.join(tmp, 'docs'))
    assert G.scan_srs(tmp) == []
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest scripts/tests/test_speclens_index.py::test_scan_srs_from_index_table -v`
Expected: FAIL — no attribute `scan_srs`

- [ ] **Step 3: 구현** (`scan_funcs` 다음에 추가, 동일 패턴)

```python
def scan_srs(spec_root: str) -> list:
    """SRS_v1.0.md 색인표 파싱 → srs[] (id/name/uis/inf/func/domain/file). 없으면 []."""
    fp = os.path.join(spec_root, 'docs', '03_기능명세서', 'SRS_v1.0.md')
    if not os.path.exists(fp):
        return []
    with open(fp, encoding='utf-8', errors='replace') as f:
        lines = f.read().splitlines()
    srs_re = re.compile(r'SRS-F-\d+')
    uis_re = re.compile(r'UIS-[A-Za-z]+-\d+(?:-T\d+)?')
    inf_re = re.compile(r'INF-[A-Za-z]+-\d+')
    func_re = re.compile(r'FUNC-[A-Za-z]+-\d+')
    out = []
    for line in lines:
        sids = srs_re.findall(line)
        if not sids:
            continue
        funcs = func_re.findall(line)
        domain = funcs[0].split('-')[1] if funcs and len(funcs[0].split('-')) >= 3 else ''
        name = ''
        for c in (x.strip() for x in line.split('|')):
            if c and '---' not in c and not (srs_re.search(c) or uis_re.search(c)
                                             or inf_re.search(c) or func_re.search(c)):
                name = c
                break
        out.append({
            'id': sids[0], 'name': name, 'domain': domain,
            'file': 'docs/03_기능명세서/SRS_v1.0.md',
            'uis': sorted(set(uis_re.findall(line))),
            'inf': sorted(set(inf_re.findall(line))),
            'func': funcs[0] if funcs else '',
        })
    return out
```

`generate_index`에서 `funcs = scan_funcs(spec_root)` 다음에 `srs = scan_srs(spec_root)` 추가, index dict에 `'srs': srs,` 추가(`'funcs': funcs,` 다음). 도메인 srs_count: `for s in srs: domains.get(s['domain'],{})` 가드 후 `domains[s['domain']]['srs_count'] = domains[s['domain']].get('srs_count',0)+1` (도메인 존재 시).

- [ ] **Step 4: 통과 + 커밋**

Run: `python -m pytest scripts/tests/test_speclens_index.py -q`
Expected: 기존+신규 2 PASS

```bash
git add scripts/gen_docsify.py scripts/tests/test_speclens_index.py
git commit -m "feat(speclens): gen_docsify srs[] 인덱싱(SRS_v1.0 색인표 파싱)"
```

### Task 4: docsify-sl.js SRS 노출 (goToId + 도메인 기능명세 + 그래프 노드)

**Files:** Modify `docs/viewer/docsify-sl.js`, `docs/viewer/sl-theme.css`

- [ ] **Step 1: goToId + resolveCurrentEntity + 크로스링크에 SRS 추가**

`goToId`에 SRS 분기 추가(func 분기 다음):
```javascript
      const sr = INDEX.srs && INDEX.srs.find(s => s.id === id);
      if (sr) this.openSpec(sr.file);
```
`resolveCurrentEntity` 정규식에 `SRS-F-\d+` 추가, pools에 `['srs', INDEX.srs]`.
`addCrosslinks` 패턴에 `SRS-F-\d+` 추가.

- [ ] **Step 2: 연결그래프에 SRS 이웃 추가**

`_neighbors`에 SRS 처리 추가:
```javascript
    const sr = (INDEX.srs || []).find(s => s.id === id);
    if (sr) { (sr.uis||[]).forEach(u=>push(u,'uis')); (sr.inf||[]).forEach(i=>push(i,'inf')); if (sr.func) push(sr.func,'func'); }
```
그리고 UIS/FUNC 이웃에서 SRS로도 가도록: `_neighbors`의 uis 분기에 `(INDEX.srs||[]).filter(s=>(s.uis||[]).includes(id)).forEach(s=>push(s.id,'srs'))` 추가. `_typeOf`에 `if (/^SRS-/.test(id)) return 'srs';`. `buildSpecGraph` classDef에 `classDef srs fill:#1b1030,stroke:#a371f7,color:#a371f7;`.

- [ ] **Step 3: 도메인 뷰에 기능명세(SRS) 목록**

`renderDomainView`에 'srs' 탭 추가(데이터 있을 때): `tabKeys`에 `(srs.length>0?['srs']:[])`. ACTIVE_TAB==='srs'면 해당 도메인 srs 카드 목록(id/name/uis/inf 수) → 클릭 openSpec. (INF 카드 렌더 재사용 패턴)

- [ ] **Step 4: CSS + 문법검증 + 커밋**

`.sl-rel-srs { color:#a371f7; border-color:#a371f7; background:rgba(163,113,247,.10);}` 추가.
Run: `node --check docs/viewer/docsify-sl.js` → 정상

```bash
git add docs/viewer/docsify-sl.js docs/viewer/sl-theme.css
git commit -m "feat(speclens): SRS 1급 노출 — goToId/크로스링크/연결그래프 노드/도메인 기능명세 탭"
```

---

## Phase C — 검증 + 릴리즈

### Task 5: 실데이터 합성 품질 점검 + 동기화 + 버전

**Files:** Modify `skills/sl-recon-doc/SKILL.md`, `docs/RECON_PIPELINE.md`, `CLAUDE.md`, `.claude-plugin/plugin.json`

- [ ] **Step 1: 합성 품질 수동 점검(샘플 1화면)**

nkshop 1개 도메인으로 recon-doc 9-0~9-3 실행(또는 srs-agent 단독 호출) → 생성된 SRS-F 1건이 "업무 서사(복붙 아님) + 규칙 종합(출처 표기) + 사실 일치"인지 사람 확인. 복붙이면 srs-agent 프롬프트 강화 반복.

- [ ] **Step 2: 문서 동기화**

sl-recon-doc 9-3 설명을 합성형으로 갱신. RECON_PIPELINE SRS 행 설명 갱신. scripts/README gen_docsify에 `srs[]` 추가.

- [ ] **Step 3: 버전 + 노트 + 커밋**

plugin.json → `3.14.0`. CLAUDE.md 노트: "SRS 합성형 재설계(업무서사+규칙종합, 토큰은 합성에만) + SpecLens 1급 노출(srs[] 인덱싱·기능명세 탭·연결그래프 노드)."

Run: `python -m pytest scripts/tests/ -q && node --check docs/viewer/docsify-sl.js`

```bash
git add -A && git commit -m "docs(srs): v3.14.0 합성형 SRS 동기화 + 버전 bump"
```

---

## Self-Review
- 합성 포맷(①~⑥) → Task1/2 ✅. SpecLens 인덱싱 → Task3 ✅. 뷰어 노출(goToId/그래프/탭) → Task4 ✅. 품질·동기화·버전 → Task5 ✅.
- Placeholder: 없음(코드 스텝 구체). 타입: srs[{id,name,domain,file,uis,inf,func}], _typeOf 'srs', classDef srs.
- 토큰 절감 핵심(기계 조립 vs LLM)은 srs-agent 프롬프트 규칙으로 강제(Task1 Step2) — 정량 검증은 Task5 수동 점검.
- 위험: srs-agent가 여전히 복붙할 수 있음 → Reflexion 점검표 + Task5 사람 확인 게이트로 완화.
