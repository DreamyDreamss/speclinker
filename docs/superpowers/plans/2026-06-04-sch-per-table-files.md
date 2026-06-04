# SCH 테이블당 개별 파일 구조 변경 — 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (권장) 또는 superpowers:executing-plans 로 task 단위 실행. 스텝은 `- [ ]` 체크박스로 추적.
>
> **Git:** 작업 디렉토리 = `D:/gen-harness/plugins/speclinker` (독립 git repo, `main`). 각 task는 검증 통과 후 **커밋**으로 마무리한다.
> - 커밋 전 **내 파일만 stage** (`git add <명시 경로>`). 기존 미커밋 변경(예: `scripts/dispatch_inf_gen.py`)은 건드리지 않는다.
> - 커밋 메시지 컨벤션: `feat: <설명>` (한글). 본문 끝에 다음 trailer 추가:
>   `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
> - Task 1~7 완료 후 마지막에 `CLAUDE.md` 버전 노트(`vX.Y.0`) 1줄 추가 + 통합 커밋 가능.

**Goal:** SCH(DB 스키마) 산출물을 도메인 집계형 1파일에서 테이블당 개별 파일로 바꾸고, 뷰어가 SCH를 색인·네비게이션하도록 만든다.

**Architecture:** INF 구조(`{도메인}/INF/INF-*.md` + 전역 색인)를 SCH에 대칭 적용 — `{도메인}/SCH/SCH-{CODE}-NNN.md`(개별) + 슬림 `DB_{도메인}.md`(도메인 ERD+목록) + 전역 `DB_Schema.md`(파일 직링크 색인). 런타임 스크립트(gen_docsify, link_inf_sch)와 뷰어(docsify-sl.js)가 새 구조를 소비하고, 생성 에이전트(ddd-db-agent)·템플릿·스킬이 새 구조를 산출하도록 갱신.

**Tech Stack:** Python 3 (스크립트), Vanilla JS + Docsify (뷰어), Markdown (에이전트/스킬/템플릿).

**참조 spec:** `docs/superpowers/specs/2026-06-04-sch-per-table-files-design.md`

---

## 파일 구조 (변경 맵)

| 파일 | 책임 | Task |
|------|------|------|
| `scripts/gen_docsify.py` | SCH 파일 스캔 → spec_index.json (schs[], totals.sch, domains.sch) | 1 |
| `scripts/link_inf_sch_new.py` | SCH/ 개별 파일에서 테이블맵 구성 → INF 참조표 링크 | 2 |
| `docs/viewer/docsify-sl.js` | goToId의 SCH 해소 + SCH 탭 카드 렌더 | 3 |
| `agents/ddd-db-agent.md` | 3산출물(개별 SCH+슬림 개요+전역 색인) 생성 지침 | 4 |
| `templates/DB_Schema_template.md` | 개별/개요/색인 템플릿 3종 | 5 |
| `skills/sl-recon-inf/SKILL.md`, `sl-recon-doc/SKILL.md`, `sl-genesis/SKILL.md` | 경로·카운트·색인 설명 정합 | 6 |
| (검증) 픽스처 프로젝트 + nkshop-bos-admin | E2E 네비게이션 체인 + 구조 게이트 | 7 |

테스트 픽스처는 `tests/fixtures/sch_*` 임시 디렉토리(각 task 내 `mktemp`)로 생성·정리.

---

## Task 1: gen_docsify.py — SCH 색인

**Files:**
- Modify: `scripts/gen_docsify.py`
- Test: 인라인 임시 픽스처 (heredoc python)

- [ ] **Step 1: 실패 테스트 작성·실행** — 새 구조 픽스처로 SCH가 색인되는지 확인

```bash
python - <<'PY'
import sys, tempfile, os, json
sys.path.insert(0, r'D:/gen-harness/plugins/speclinker/scripts')
import gen_docsify
d = tempfile.mkdtemp()
sd = os.path.join(d, 'docs','05_설계서','product','SCH'); os.makedirs(sd)
open(os.path.join(sd,'SCH-PRD-001.md'),'w',encoding='utf-8').write(
  "---\nsch-id: SCH-PRD-001\ntable: products\ndomain: product\ndomain-code: PRD\ninf: [INF-PRD-001, INF-PRD-002]\n---\n# SCH-PRD-001: products\n")
idx = gen_docsify.generate_index(d, os.path.join(d,'docs','viewer','spec_index.json'))
assert idx['totals']['sch'] == 1, idx['totals']
assert idx['domains']['product']['sch'] == 1, idx['domains']
assert idx['schs'][0]['id'] == 'SCH-PRD-001'
assert idx['schs'][0]['table'] == 'products'
assert idx['schs'][0]['inf'] == ['INF-PRD-001','INF-PRD-002'], idx['schs'][0]['inf']
assert idx['schs'][0]['file'].endswith('docs/05_설계서/product/SCH/SCH-PRD-001.md')
print("PASS")
PY
```
Expected: 현재는 `KeyError: 'schs'` 또는 `totals.sch==0` 으로 **FAIL**.

- [ ] **Step 2: `_iter_sch_dirs` + `scan_schs` 구현** — `scan_uis` 다음(라인 141 이후)에 추가

```python
def _iter_sch_dirs(spec_root: str):
    """SCH 파일 디렉터리 iterator. 두 구조 지원:
    A) docs/05_설계서/SCH/{domain}/   B) docs/05_설계서/{domain}/SCH/
    yields (domain_name, dir_path)"""
    design_root = os.path.join(spec_root, 'docs', '05_설계서')
    if not os.path.isdir(design_root):
        return
    sch_root_a = os.path.join(design_root, 'SCH')
    if os.path.isdir(sch_root_a):
        for d in sorted(os.listdir(sch_root_a)):
            p = os.path.join(sch_root_a, d)
            if os.path.isdir(p):
                yield d, p
        return
    for domain in sorted(os.listdir(design_root)):
        sch_sub = os.path.join(design_root, domain, 'SCH')
        if os.path.isdir(sch_sub):
            yield domain, sch_sub


def _parse_inf_list(fm_block: str, fm: dict) -> list:
    """SCH frontmatter의 inf: 값을 리스트로. 인라인([a, b])·블록(- a) 모두 지원."""
    raw = fm.get('inf', '').strip()
    if raw.startswith('[') and raw.endswith(']'):
        return [x.strip() for x in raw[1:-1].split(',') if x.strip()]
    block = _extract_list_field(fm_block, 'inf')
    if block:
        return block
    return [x.strip() for x in raw.split(',') if x.strip()] if raw else []


def scan_schs(spec_root: str) -> list:
    """docs/05_설계서 하위 SCH-*.md 전수 스캔 (두 구조 지원)."""
    schs = []
    for domain_dir, domain_path in _iter_sch_dirs(spec_root):
        for fname in sorted(os.listdir(domain_path)):
            if not (fname.endswith('.md') and fname.startswith('SCH-')):
                continue
            fpath = os.path.join(domain_path, fname)
            try:
                with open(fpath, encoding='utf-8', errors='replace') as f:
                    content = f.read()
            except OSError:
                continue
            fm = parse_frontmatter(content)
            fb = _get_fm_block(content)
            schs.append({
                'id': fm.get('sch-id', fname.replace('.md', '')),
                'table': fm.get('table', ''),
                'domain': fm.get('domain', domain_dir),
                'domain_code': fm.get('domain-code', ''),
                'inf': _parse_inf_list(fb, fm),
                'file': os.path.relpath(fpath, spec_root).replace('\\', '/'),
            })
    return schs
```

- [ ] **Step 3: `generate_index`에 SCH 반영** — 라인 189~216 블록 수정

`infs`/`uis` 스캔 뒤에 `schs = scan_schs(spec_root)` 추가, 도메인 집계 루프에 SCH 카운트 추가, `index` dict의 `totals.sch`·`schs` 채움:

```python
    infs = scan_infs(spec_root)
    uis = scan_uis(spec_root)
    schs = scan_schs(spec_root)
    sprint = load_sprint_status(spec_root)
```

도메인 집계(기존 for inf / for ui 루프 다음)에 추가:

```python
    for sch in schs:
        d = sch['domain']
        if d:
            domains.setdefault(d, {'inf': 0, 'uis': 0, 'sch': 0, 'bat': 0, 'tbd_total': 0})
            domains[d]['sch'] += 1
```

index dict 수정:

```python
        'totals': {'inf': len(infs), 'uis': len(uis), 'sch': len(schs), 'bat': 0},
        'domains': domains,
        'infs': infs,
        'uis': uis,
        'schs': schs,
        'ia_tree': build_ia_tree(uis),
```

그리고 출력 로그에 SCH 추가:

```python
    print(f'     INF {len(infs)}개 | UIS {len(uis)}개 | SCH {len(schs)}개 | 도메인 {len(domains)}개')
```

- [ ] **Step 4: 테스트 재실행** — Step 1 스크립트 다시 실행 → `PASS` 출력 확인.

- [ ] **Step 5: 회귀 확인** — INF/UIS 색인이 여전히 동작하는지 nkshop-bos-admin로 검증

```bash
python "D:/gen-harness/plugins/speclinker/scripts/gen_docsify.py" "D:/nkshop-bos/nkshop-bos-admin" 2>&1 | head -5
```
Expected: `INF 569개 ... SCH {N}개` 형식(구 SCH 파일이 없으면 SCH 0이지만 에러 없이 완료). 검증 체크포인트.

---

## Task 2: link_inf_sch_new.py — SCH/ 개별 파일 기반 테이블맵

**Files:**
- Modify: `scripts/link_inf_sch_new.py` (`build_sch_map` 함수, 라인 11~33)
- Test: 인라인 임시 픽스처

- [ ] **Step 1: 실패 테스트 작성·실행**

```bash
python - <<'PY'
import sys, tempfile, os
sys.path.insert(0, r'D:/gen-harness/plugins/speclinker/scripts')
import importlib.util
spec = importlib.util.spec_from_file_location("lis", r'D:/gen-harness/plugins/speclinker/scripts/link_inf_sch_new.py')
lis = importlib.util.module_from_spec(spec); spec.loader.exec_module(lis)
d = tempfile.mkdtemp()
dr = os.path.join(d,'docs','05_설계서','product')
os.makedirs(os.path.join(dr,'SCH')); os.makedirs(os.path.join(dr,'INF'))
open(os.path.join(dr,'SCH','SCH-PRD-001.md'),'w',encoding='utf-8').write(
  "---\nsch-id: SCH-PRD-001\ntable: products\ndomain: product\n---\n# SCH-PRD-001: products\n")
m = lis.build_sch_map(os.path.join(d,'docs','05_설계서'))
assert m.get('products',{}).get('sch_id') == 'SCH-PRD-001', m
print("PASS build_sch_map")
PY
```
Expected: 현재 `build_sch_map`은 `DB_*.md`만 스캔하므로 `m`이 비어 **FAIL**.

- [ ] **Step 2: `build_sch_map` 재구현** — 라인 11~33 전체 교체

```python
def build_sch_map(design_root):
    """{도메인}/SCH/SCH-*.md (또는 SCH/{도메인}/) 의 frontmatter/H1에서
    테이블명 -> {sch_id, domain} 맵 생성."""
    sch_map = {}
    if not os.path.isdir(design_root):
        return sch_map
    for dirpath, _, filenames in os.walk(design_root):
        if os.path.basename(dirpath) != 'SCH':
            # SCH/ 디렉토리(또는 그 하위 도메인) 안의 파일만 본다
            if os.path.basename(os.path.dirname(dirpath)) != 'SCH':
                continue
        for fname in filenames:
            if not (fname.startswith('SCH-') and fname.endswith('.md')):
                continue
            content = _read(os.path.join(dirpath, fname))
            if not content:
                continue
            domain = ''
            table = ''
            sch_id = fname[:-3]
            fm = re.match(r'^---\s*\n(.*?)\n---', content, re.DOTALL)
            if fm:
                for line in fm.group(1).split('\n'):
                    s = line.strip()
                    mt = re.match(r'^table\s*:\s*(.+)$', s)
                    md = re.match(r'^domain\s*:\s*(.+)$', s)
                    mi = re.match(r'^sch-id\s*:\s*(.+)$', s)
                    if mt: table = mt.group(1).strip().strip("\"'")
                    if md: domain = md.group(1).strip().strip("\"'")
                    if mi: sch_id = mi.group(1).strip().strip("\"'")
            if not table:
                hm = re.search(r'^#\s+SCH-[\w-]+\s*[:\-]+\s*([\w_]+)', content, re.MULTILINE)
                if hm: table = hm.group(1).strip()
            if table:
                key = table.lower()
                if key not in sch_map:
                    sch_map[key] = {'sch_id': sch_id, 'domain': domain}
    return sch_map
```

> `update_ref_section`(INF `## 참조 테이블` `[TBD]`→`[[SCH-XXX]]`)·`main`은 변경 없음.

- [ ] **Step 3: 테스트 재실행** → `PASS build_sch_map`.

- [ ] **Step 4: 엔드투엔드 링크 테스트** — INF 참조표가 실제로 채워지는지

```bash
python - <<'PY'
import importlib.util, tempfile, os
spec = importlib.util.spec_from_file_location("lis", r'D:/gen-harness/plugins/speclinker/scripts/link_inf_sch_new.py')
lis = importlib.util.module_from_spec(spec); spec.loader.exec_module(lis)
d = tempfile.mkdtemp()
dr = os.path.join(d,'docs','05_설계서','product'); os.makedirs(os.path.join(dr,'SCH')); os.makedirs(os.path.join(dr,'INF'))
open(os.path.join(dr,'SCH','SCH-PRD-001.md'),'w',encoding='utf-8').write(
  "---\nsch-id: SCH-PRD-001\ntable: products\ndomain: product\n---\n# SCH-PRD-001: products\n")
open(os.path.join(dr,'INF','INF-PRD-001.md'),'w',encoding='utf-8').write(
  "---\ninf-id: INF-PRD-001\ntables: [products]\n---\n# INF\n\n## 참조 테이블\n\n| 테이블 | SCH |\n|--------|-----|\n| products | [TBD] |\n")
import sys; sys.argv = ['x', d]
lis.main()
out = open(os.path.join(dr,'INF','INF-PRD-001.md'),encoding='utf-8').read()
assert '[[SCH-PRD-001]]' in out, out
print("PASS e2e link")
PY
```
Expected: `PASS e2e link`. 검증 체크포인트.

---

## Task 3: docsify-sl.js — SCH 해소 + SCH 탭

**Files:**
- Modify: `docs/viewer/docsify-sl.js` (`goToId` ~라인 463-469, `renderDomainView` sch 분기 ~라인 344-346)

- [ ] **Step 1: `goToId`에 SCH 해소 추가** — `const ui = INDEX.uis && ...` 다음 줄에 추가

기존:
```javascript
    goToId(id) {
      if (!INDEX) return;
      const inf = INDEX.infs && INDEX.infs.find(i => i.id === id);
      if (inf) { this.openSpec(inf.file); return; }
      const ui = INDEX.uis && INDEX.uis.find(u => u.id === id);
      if (ui) this.openSpec(ui.file);
    },
```
교체:
```javascript
    goToId(id) {
      if (!INDEX) return;
      const inf = INDEX.infs && INDEX.infs.find(i => i.id === id);
      if (inf) { this.openSpec(inf.file); return; }
      const sch = INDEX.schs && INDEX.schs.find(s => s.id === id);
      if (sch) { this.openSpec(sch.file); return; }
      const ui = INDEX.uis && INDEX.uis.find(u => u.id === id);
      if (ui) this.openSpec(ui.file);
    },
```

- [ ] **Step 2: SCH 탭 카드 렌더** — `renderDomainView`의 else 분기(라인 344-346) 수정

기존:
```javascript
    } else {
      body = `<div style="padding:24px;color:var(--text-muted)">SCH/BAT 뷰 — 준비 중</div>`;
    }
```
교체:
```javascript
    } else if (ACTIVE_TAB === 'sch') {
      const schs = (INDEX.schs || []).filter(s => s.domain === domain);
      body = `<div class="sl-inf-list">${
        schs.length > 0
          ? schs.map(renderSchCard).join('')
          : '<div style="padding:16px;color:var(--text-muted)">SCH 파일 없음</div>'
      }</div>`;
    } else {
      body = `<div style="padding:24px;color:var(--text-muted)">BAT 뷰 — 준비 중</div>`;
    }
```

- [ ] **Step 3: `renderSchCard` 추가** — `renderInfCard` 함수(라인 356) 앞에 추가

```javascript
  function renderSchCard(sch) {
    const infs = (sch.inf || []).join(', ');
    return `
      <div class="sl-inf-card" onclick="SlViewer.openSpec('${escAttr(sch.file)}')">
        <span class="sl-method-badge" style="background:var(--status-done)">SCH</span>
        <span class="sl-inf-id">${sch.id}</span>
        <span class="sl-inf-path">${escAttr(sch.table || '')}${infs ? ' · ' + escAttr(infs) : ''}</span>
      </div>`;
  }
```

- [ ] **Step 4: SCH 라우팅 doneEach 확인** — 라인 478의 hash 분기는 이미 `/SCH-` 포함하므로 변경 불필요(확인만).

- [ ] **Step 5: 구조 검증** — 새 심볼이 들어갔는지 grep

```bash
grep -n "renderSchCard\|INDEX.schs" "D:/gen-harness/plugins/speclinker/docs/viewer/docsify-sl.js"
```
Expected: `renderSchCard` 정의 1 + 호출 1, `INDEX.schs` 2건(goToId, sch 탭). 검증 체크포인트.

---

## Task 4: ddd-db-agent.md — 3산출물 생성 지침

**Files:**
- Modify: `agents/ddd-db-agent.md` (Phase 3, 라인 205~336 / Self-Critique 라인 340~381 / Phase 0 sch_draft 안내)

- [ ] **Step 1: Phase 3-2를 "슬림 도메인 개요"로 교체** — 라인 238~336의 "도메인 상세 파일" 섹션을 아래로 대체

```markdown
### 3-2. 개별 테이블 파일 (`docs/05_설계서/{도메인}/SCH/SCH-{CODE}-NNN.md`)

> **경로 규칙**: 테이블 1개 = 파일 1개. `{도메인}/SCH/` 하위에 둔다(INF의 `{도메인}/INF/`와 대칭).
> 상대경로 기준점이 한 단계 깊으므로 INF 링크는 `../INF/…`, 상위 산출물은 `../../…`.

**frontmatter (색인·뷰어 네비게이션용 — 필수):**
\```yaml
---
sch-id: SCH-{CODE}-NNN
table: {테이블명}
domain: {도메인}
domain-code: {CODE}
inf: [INF-{CODE}-NNN, ...]
---
\```

**본문 필수 구조:**
\```markdown
# SCH-{CODE}-001: users

> GENESIS: **REQ-F:** [REQ-F-001](../../../01_요구사항정의서/RD_v1.0.md#REQ-F-001) | **SRS-F:** [SRS-F-001](../../../03_기능명세서/SRS_v1.0.md#SRS-F-001) | **API:** [INF-{CODE}-001](../INF/INF-{CODE}-001.md) | **화면:** [UIS-{CODE}-001](../UI/UIS-{CODE}-001_화면명/spec.md)
> RECON: **FUNC-ID:** [FUNC-{도메인}-001](../../../00_FUNC/FUNC_v1.0.md) | **SRS-F:** [TBD] | **API:** [INF-{CODE}-001](../INF/INF-{CODE}-001.md)

**근거 소스:** `{모델/ORM 파일 경로:라인번호}`

### DDL
### 컬럼 설명
### 인덱스
### 코드값            (해당 컬럼 없으면 생략 — 기존 규칙 유지)
### 관계 (FK)
### mini-ERD          (mermaid erDiagram — 이 테이블 + 직결 FK 이웃만)
### 비즈니스 주의사항  (참조 INF 규칙 있을 때)
\```

> DDL/컬럼/인덱스/코드값/비즈니스주의 의 작성 방법은 기존 규칙과 동일.
> **3NF 검증 결과/통과 여부 섹션은 제외**(노이즈). 정규화는 테이블 분리 설계 시 참고만.
> **ERD 분리 원칙:** 개별 파일은 mini-ERD(자기 테이블+직결 FK)만. 도메인 전체 ERD는 3-3에.

### 3-3. 슬림 도메인 개요 (`docs/05_설계서/{도메인}/DB_{도메인}.md`)

> **DDL 절대 없음.** 도메인 전체 ERD 1개 + 테이블 색인만.

\```markdown
# {도메인} DB 개요

## 도메인 ERD
\```mermaid
erDiagram
  ... 도메인 내 모든 테이블·관계 ...
\```

## 테이블 목록
| SCH-ID | 테이블명 | INF-ID |
|--------|---------|--------|
| SCH-{CODE}-001 | [users](./SCH/SCH-{CODE}-001.md) | INF-{CODE}-001 |
\```
```

- [ ] **Step 2: Phase 3-1 전역 색인의 2열 링크를 파일 직링크로 교체** — 라인 218~233 색인 표 예시·주의사항 수정

색인 표 2열 예시를 앵커→파일로:
```markdown
| SCH-AUTH-001 | [users](./auth/SCH/SCH-AUTH-001.md) | INF-AUTH-001 |
```
"파서 주의사항"의 2열 규칙을 교체:
```markdown
- 2열: `[테이블명](./도메인/SCH/SCH-{CODE}-NNN.md)` (개별 파일 직링크 — 앵커 없음)
- SCH 순번: 기존 `{도메인}/SCH/SCH-{CODE}-*.md` 스캔 후 max+1 자동 채번
```

- [ ] **Step 3: Self-Critique 갱신** — 라인 360 "도메인 파일 분리" 항목 및 관련 체크 교체

```markdown
[ ] 개별 파일 분리: 각 테이블이 `{도메인}/SCH/SCH-{CODE}-NNN.md` 1파일로 생성됐는가?
    → DB_{도메인}.md(개요)와 DB_Schema.md(색인)에 DDL이 없는가? 있으면 개별 파일로 이동.
[ ] frontmatter: 모든 SCH 파일에 sch-id/table/domain/domain-code/inf 가 있는가?
    → 없으면 gen_docsify가 색인하지 못해 뷰어 네비게이션이 끊긴다.
[ ] 색인 링크: DB_Schema.md 2열이 `[테이블명](./도메인/SCH/SCH-NNN.md)` 파일 직링크인가?
[ ] ERD 분리: 개별 파일은 mini-ERD, DB_{도메인}.md는 도메인 전체 ERD 1개인가?
```

- [ ] **Step 4: Phase 0 sch 카운트/완료보고 경로 정합** — 라인 392~393 완료보고의 파일 목록을 새 경로로

```markdown
- docs/05_설계서/DB_Schema.md (전역 색인)
- docs/05_설계서/{도메인}/DB_{도메인}.md (슬림 개요 + 도메인 ERD)
- docs/05_설계서/{도메인}/SCH/SCH-{CODE}-NNN.md × {N}개 (개별 테이블)
```

- [ ] **Step 5: 구조 검증 grep**

```bash
grep -nE "SCH/SCH-\{CODE\}|슬림 도메인 개요|frontmatter|mini-ERD" "D:/gen-harness/plugins/speclinker/agents/ddd-db-agent.md" | head
```
Expected: 새 경로·개요·frontmatter·mini-ERD 마커 존재. 구 "도메인 상세 파일" 표현이 색인/개요로 대체됐는지 육안 확인. 검증 체크포인트.

---

## Task 5: templates/DB_Schema_template.md — 템플릿 3종

**Files:**
- Modify: `templates/DB_Schema_template.md` (전체 교체)

- [ ] **Step 1: 현재 템플릿 확인** — `Read templates/DB_Schema_template.md` 로 기존 구조 파악(도메인 집계형 전제).

- [ ] **Step 2: 3종 템플릿으로 재작성** — 파일 전체를 아래 골격으로 교체

```markdown
# DB 스키마 템플릿 (테이블당 개별 파일 구조)

## A. 전역 색인 — docs/05_설계서/DB_Schema.md
| SCH-ID | 테이블명 | INF-ID |
|--------|---------|--------|
| SCH-{CODE}-001 | [{테이블}](./{도메인}/SCH/SCH-{CODE}-001.md) | INF-{CODE}-001 |
(DDL 없음. 1열=순수 ID, 2열=파일 직링크, 3열=INF 쉼표구분)

## B. 슬림 도메인 개요 — docs/05_설계서/{도메인}/DB_{도메인}.md
# {도메인} DB 개요
## 도메인 ERD  (mermaid erDiagram — 도메인 전체 관계)
## 테이블 목록  (| SCH-ID | [테이블](./SCH/SCH-...md) | INF-ID |)
(DDL 없음)

## C. 개별 테이블 — docs/05_설계서/{도메인}/SCH/SCH-{CODE}-NNN.md
---
sch-id: SCH-{CODE}-NNN
table: {테이블}
domain: {도메인}
domain-code: {CODE}
inf: [INF-{CODE}-NNN]
---
# SCH-{CODE}-NNN: {테이블}
> 크로스링크 블록(모드별)
**근거 소스:** `{파일:라인}`
### DDL
### 컬럼 설명
### 인덱스
### 코드값
### 관계 (FK)
### mini-ERD
### 비즈니스 주의사항
```
(3NF 검증 결과/통과 여부 섹션 없음 — 의도적 제외)

- [ ] **Step 3: 검증** — `grep -n "SCH/SCH-\|sch-id:\|mini-ERD" templates/DB_Schema_template.md` 로 3종 마커 확인. 검증 체크포인트.

---

## Task 6: 스킬 경로·카운트 정합

**Files:**
- Modify: `skills/sl-recon-inf/SKILL.md` (라인 65 sch_done, STEP 8 산출물 경로)
- Modify: `skills/sl-recon-doc/SKILL.md` (라인 92, 238~240 색인 설명)
- Modify: `skills/sl-genesis/SKILL.md` (Phase-B SCH 구조 설명)

- [ ] **Step 1: sl-recon-inf 라인 65 sch_done 수정** — `{도메인}/SCH/` 디렉토리 기준으로

기존:
```python
    sch_done = len([f for f in os.listdir(f'docs/05_설계서/{name}') if f.startswith('SCH-')]) if os.path.isdir(f'docs/05_설계서/{name}') else 0
```
교체:
```python
    _schd = f'docs/05_설계서/{name}/SCH'
    sch_done = len([f for f in os.listdir(_schd) if f.startswith('SCH-') and f.endswith('.md')]) if os.path.isdir(_schd) else 0
```

- [ ] **Step 2: sl-recon-inf STEP 8 산출물 경로 문구 갱신** — ddd-db-agent 호출 설명/결과 경로를 `{도메인}/SCH/SCH-NNN.md` + 슬림 `DB_{도메인}.md` + 전역 `DB_Schema.md` 3종으로 기술. (라인 433~453 영역의 산출물 설명 문장 수정 — 구 "DB_{도메인}.md에 테이블 누적" 표현 제거)

- [ ] **Step 3: sl-recon-doc 색인 설명 갱신** — 라인 238 `DB_{도메인}.md × N개`를 "슬림 개요 + `{도메인}/SCH/SCH-*.md` 개별 파일"로, 라인 240 `DB_Schema.md`는 "파일 직링크 색인"으로 문구 수정.

- [ ] **Step 4: sl-genesis 정합** — 라인 53/159/173 의 SCH 산출물이 개별 파일 구조임을 명시(범위 사전배정은 유지하되 산출 형태=개별 파일). 색인 3종 생성 시 DB_Schema.md=파일 직링크 명시.

- [ ] **Step 5: 검증** — 각 스킬에서 구 표현 잔존 여부 grep

```bash
grep -rnE "DB_\{도메인\}.md.*테이블|#SCH-|SCH-\] 시작하는 파일" "D:/gen-harness/plugins/speclinker/skills/sl-recon-inf/SKILL.md" "D:/gen-harness/plugins/speclinker/skills/sl-recon-doc/SKILL.md" "D:/gen-harness/plugins/speclinker/skills/sl-genesis/SKILL.md"
```
Expected: 구 집계형/앵커 전제 표현 0건. 검증 체크포인트.

---

## Task 7: 통합 검증 (E2E 네비게이션 체인 + 구조 게이트)

**Files:** 없음(검증 전용). 임시 픽스처 프로젝트 + nkshop-bos-admin.

- [ ] **Step 1: 새 구조 픽스처 E2E** — 개별 SCH 파일 → 색인 → 링크 → 서빙 → 200 + schs 색인 확인

```bash
python - <<'PY'
import sys, tempfile, os, json, subprocess, importlib.util, urllib.parse, urllib.request, urllib.error, threading
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
SC = r'D:/gen-harness/plugins/speclinker/scripts'
d = tempfile.mkdtemp()
prd = os.path.join(d,'docs','05_설계서','product')
os.makedirs(os.path.join(prd,'SCH')); os.makedirs(os.path.join(prd,'INF'))
open(os.path.join(prd,'SCH','SCH-PRD-001.md'),'w',encoding='utf-8').write(
 "---\nsch-id: SCH-PRD-001\ntable: products\ndomain: product\ndomain-code: PRD\ninf: [INF-PRD-001]\n---\n# SCH-PRD-001: products\n### DDL\n")
open(os.path.join(prd,'DB_product.md'),'w',encoding='utf-8').write(
 "# product DB 개요\n## 테이블 목록\n| SCH-ID | 테이블명 | INF-ID |\n|--|--|--|\n| SCH-PRD-001 | [products](./SCH/SCH-PRD-001.md) | INF-PRD-001 |\n")
open(os.path.join(prd,'INF','INF-PRD-001.md'),'w',encoding='utf-8').write(
 "---\ninf-id: INF-PRD-001\ntables: [products]\n---\n# INF\n## 참조 테이블\n\n| 테이블 | SCH |\n|--|--|\n| products | [TBD] |\n")
# 1) gen_docsify: 자산 복사 + schs 색인
import gen_docsify  # SC가 sys.path에 있어야
sys.path.insert(0, SC); import importlib; importlib.reload(gen_docsify)
gen_docsify.copy_viewer_assets(d)
idx = gen_docsify.generate_index(d, os.path.join(d,'docs','viewer','spec_index.json'))
assert idx['totals']['sch']==1 and idx['schs'][0]['file'].endswith('SCH-PRD-001.md'), idx['totals']
# 2) link_inf_sch: 참조표 채움
spec = importlib.util.spec_from_file_location("lis", os.path.join(SC,'link_inf_sch_new.py'))
lis = importlib.util.module_from_spec(spec); spec.loader.exec_module(lis)
sys.argv=['x', d]; lis.main()
inf_txt = open(os.path.join(prd,'INF','INF-PRD-001.md'),encoding='utf-8').read()
assert '[[SCH-PRD-001]]' in inf_txt, inf_txt
# 3) 서빙 + 200 (프로젝트 루트)
import http.server, socketserver, functools
os.chdir(d)
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=d)
httpd = socketserver.TCPServer(('127.0.0.1', 0), Handler); port = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
def code(p):
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/'+urllib.parse.quote(p), timeout=5) as r: return r.status
    except urllib.error.HTTPError as e: return e.code
for p in ['docs/viewer/index.html','docs/viewer/spec_index.json',idx['schs'][0]['file']]:
    c = code(p); assert c==200, (p,c); print(f"  200  {p}")
httpd.shutdown()
print("PASS Task7 E2E 네비게이션 체인")
PY
```
Expected: 세 URL 200 + `PASS Task7 E2E 네비게이션 체인`.

- [ ] **Step 2: 구조 게이트 grep** — 전 파일에서 구 패턴 잔존 0 확인

```bash
echo "[앵커 잔존?]"; grep -rn "DB_{도메인}.md#SCH\|DB_도메인.md#SCH" "D:/gen-harness/plugins/speclinker/agents" "D:/gen-harness/plugins/speclinker/skills" "D:/gen-harness/plugins/speclinker/templates" || echo "  없음(OK)"
echo "[gen_docsify schs?]"; grep -c "scan_schs\|'schs'" "D:/gen-harness/plugins/speclinker/scripts/gen_docsify.py"
echo "[viewer schs?]"; grep -c "INDEX.schs\|renderSchCard" "D:/gen-harness/plugins/speclinker/docs/viewer/docsify-sl.js"
```
Expected: 앵커 잔존 없음, gen_docsify schs ≥2, viewer schs ≥3.

- [ ] **Step 3: 실프로젝트 회귀** — nkshop-bos-admin 재색인 + 뷰어 200 (Task 1 회귀 재확인)

```bash
python "D:/gen-harness/plugins/speclinker/scripts/gen_docsify.py" "D:/nkshop-bos/nkshop-bos-admin" 2>&1 | tail -3
```
Expected: 에러 없이 `INF .. | UIS .. | SCH .. | 도메인 ..` 출력. (구 SCH 파일이 집계형이면 SCH 0 — 정상. 새 구조 SCH는 다음 recon 재생성 시 생김.)

- [ ] **Step 4 (선택): 실에이전트 1도메인 재생성** — `_tmp/sch_draft/`가 있으면 nkshop-bos-admin의 소도메인 1개에 대해 ddd-db-agent를 실제 호출하여 `{도메인}/SCH/SCH-*.md`·슬림 `DB_{도메인}.md`·색인이 새 형식으로 나오는지 육안 확인. 전제 미충족 시 Step 1 픽스처 E2E로 갈음(이미 통과).

---

## Self-Review (작성자 체크)

- **Spec 커버리지:** §2 구조→T4·T5, §3-1 개별파일→T4·T5, §3-2 슬림개요→T4·T5, §3-3 전역색인→T4·T5, §4 변경표 8파일→T1~T6, §5 뷰어 네비게이션→T3(+T1 색인), §6 마이그레이션 없음→T7 Step3 주석, §7 범용성→T7(픽스처는 스택중립 경로), §8 파서 불변식→T4 Step2·T7 Step2. 갭 없음.
- **Placeholder:** 각 코드 스텝에 실제 코드/명령 수록. "적절히 처리" 류 없음.
- **타입/시그니처 일관:** `scan_schs`/`_iter_sch_dirs`/`_parse_inf_list`(T1), `build_sch_map`(T2), `renderSchCard`/`INDEX.schs`(T3) — task 간 명칭 일치. spec_index 키 `schs`/`totals.sch`/`domains[].sch` 전 task 통일.
