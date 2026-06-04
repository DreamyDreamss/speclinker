# JIT 변경 그라운딩 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. TDD: 테스트 먼저 → 실패 → 구현 → 통과 → 커밋.

**Goal:** `/sl-change` AS-IS 주입을 그래프 기반 영향슬라이스 + 소스앵커 JIT read로 전환. 첨부(PPT/Word/Excel) 추출 보강.

**Architecture:** 스크립트(zero-LLM)가 INF/SCH frontmatter에서 그래프(forward INF→table, reverse table→INF ripple) 빌드 → SR 엔티티로 영향슬라이스 특정 → 근거소스 앵커(file:line) 브리프 산출. 실소스 read는 change 에이전트가 수행. 프로세 스펙은 납품물·폴백 유지.

**Tech Stack:** Python stdlib + 선택 python-pptx/docx/openpyxl(lazy). 검증=합성 픽스처 TDD + nkshop 실데이터.

**상위 설계서:** `docs/superpowers/specs/2026-06-04-jit-change-grounding-design.md`

**입력 포맷(확정, nkshop):**
- INF frontmatter: `inf-id, method, path, domain, domain-code, tables:[YAML리스트], screens:[]`
- INF 본문 근거소스: `> **근거 소스:** \`src/.../X.java:162-229\`` (file:line)
- SCH frontmatter: `sch-id, table, domain, domain-code, inf:[리스트]`

**불변식:** RECON 산출물 형식·경로 무변경(납품+그래프소스 겸). sl-change 외 무영향. spec_graph 없어도 동작(스펙서 빌드).

---

## 파일 구조

| 파일 | 액션 |
|------|------|
| `scripts/spec_graph_build.py` | **생성** — INF/SCH frontmatter·앵커 파싱 → 그래프(forward/reverse) |
| `scripts/build_change_context.py` | **생성** — SR 엔티티 → 영향슬라이스 + 앵커 브리프 |
| `scripts/extract_attachments.py` | **생성** — pptx/docx/xlsx/pdf 텍스트 추출(lazy) |
| `scripts/tests/test_change_context.py` | **생성** — TDD |
| `skills/sl-change/SKILL.md` | 수정 — Step 1-D(첨부) + JIT 그라운딩 |
| `scripts/README.md`,`CLAUDE.md` | doc-sync |

---

## Task 1: spec_graph_build.py — 스펙에서 그래프 빌드

INF/SCH frontmatter + 근거소스 앵커를 파싱해 노드/엣지(forward INF→table, reverse table→INF) 구축.

**Files:** Create `scripts/spec_graph_build.py`, `scripts/tests/test_change_context.py`

- [ ] **Step 1: 실패 테스트**

`scripts/tests/test_change_context.py`:
```python
#!/usr/bin/env python3
"""build_change_context / spec_graph_build 검증 (합성 픽스처)."""
import os, sys, json, subprocess, tempfile, shutil
SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPTS)

def _inf(d, domain, code, n, method, path, tables, anchor):
    p = os.path.join(d, f'docs/05_설계서/{domain}/INF')
    os.makedirs(p, exist_ok=True)
    tl = '\n'.join(f'  - {t}' for t in tables)
    open(os.path.join(p, f'INF-{code}-{n:03d}.md'),'w',encoding='utf-8').write(
        f"---\ninf-id: INF-{code}-{n:03d}\nmethod: {method}\npath: {path}\n"
        f"domain: {domain}\ndomain-code: {code}\ntables:\n{tl}\nscreens: []\n---\n\n"
        f"# INF-{code}-{n:03d}\n\n> **근거 소스:** `{anchor}`\n\n## 비즈니스 규칙\n- 예시\n")

def test_graph_reverse_ripple():
    import spec_graph_build as g
    tmp = tempfile.mkdtemp()
    try:
        # 두 INF가 같은 테이블 SHARED_T 사용 (다른 도메인)
        _inf(tmp,'order','ORD',1,'POST','/order/list',['ORDERS','SHARED_T'],'src/order/OrderCtl.java:10-50')
        _inf(tmp,'product','PRD',1,'GET','/product/get',['SHARED_T'],'src/product/PrdCtl.java:5-20')
        graph = g.build_graph(tmp)
        # reverse: SHARED_T → 두 INF
        users = graph['table_to_inf'].get('SHARED_T', [])
        assert 'INF-ORD-001' in users and 'INF-PRD-001' in users, users
        # 앵커 보존
        assert ':10-50' in graph['inf']['INF-ORD-001']['anchors'][0], graph['inf']['INF-ORD-001']
        print('PASS: test_graph_reverse_ripple')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == '__main__':
    test_graph_reverse_ripple()
```

- [ ] **Step 2: 실패 확인** — `python scripts\tests\test_change_context.py` → ModuleNotFoundError.

- [ ] **Step 3: 구현**

`scripts/spec_graph_build.py`:
```python
# STATUS: 완료
#!/usr/bin/env python3
"""
spec_graph_build.py — INF/SCH frontmatter·근거소스 앵커에서 그래프 빌드 (zero-LLM)
spec_graph.json 없어도 docs/05_설계서에서 직접 구축.
그래프: {inf:{id:{method,path,domain,tables,anchors}}, sch:{id:{table,domain,inf,anchors}},
        table_to_inf:{table:[inf-id]}, table_to_sch:{table:[sch-id]}}
"""
import os, re, glob

def _frontmatter(text):
    if not text.startswith('---'):
        return {}, text
    end = text.find('\n---', 3)
    if end < 0:
        return {}, text
    fm_raw, body = text[3:end], text[end+4:]
    fm, cur_list_key = {}, None
    for line in fm_raw.splitlines():
        if re.match(r'^\s+-\s+', line) and cur_list_key:
            fm[cur_list_key].append(line.strip()[2:].strip())
            continue
        m = re.match(r'^(\w[\w-]*):\s*(.*)$', line)
        if not m:
            continue
        k, v = m.group(1), m.group(2).strip()
        if v == '' :
            fm[k] = []
            cur_list_key = k
        elif v.startswith('['):
            inner = v.strip('[]').strip()
            fm[k] = [x.strip() for x in inner.split(',') if x.strip() and x.strip() != 'TBD']
            cur_list_key = None
        else:
            fm[k] = v
            cur_list_key = None
    return fm, body

def _anchors(body):
    """근거 소스 file:line 앵커 추출."""
    out = []
    for m in re.finditer(r'근거\s*소스[^`]*`([^`]+)`', body):
        out.append(m.group(1).strip())
    # 추가 백틱 경로(.java/.xml/.ts 등 :line 포함)
    for m in re.finditer(r'`([^`]+\.(?:java|xml|ts|tsx|py|kt|go)(?::\d+(?:-\d+)?)?)`', body):
        a = m.group(1).strip()
        if a not in out:
            out.append(a)
    return out

def build_graph(root):
    graph = {'inf': {}, 'sch': {}, 'table_to_inf': {}, 'table_to_sch': {}}
    design = os.path.join(root, 'docs', '05_설계서')
    for fp in glob.glob(os.path.join(design, '*', 'INF', 'INF-*.md')):
        fm, body = _frontmatter(open(fp, encoding='utf-8').read())
        iid = fm.get('inf-id')
        if not iid:
            continue
        tables = [t.upper() for t in (fm.get('tables') or [])]
        graph['inf'][iid] = {'method': fm.get('method'), 'path': fm.get('path'),
                             'domain': fm.get('domain'), 'tables': tables,
                             'anchors': _anchors(body), 'file': os.path.relpath(fp, root).replace('\\','/')}
        for t in tables:
            graph['table_to_inf'].setdefault(t, []).append(iid)
    for fp in glob.glob(os.path.join(design, '*', 'SCH', 'SCH-*.md')):
        fm, body = _frontmatter(open(fp, encoding='utf-8').read())
        sid = fm.get('sch-id')
        if not sid:
            continue
        table = (fm.get('table') or '').upper()
        graph['sch'][sid] = {'table': table, 'domain': fm.get('domain'),
                             'inf': fm.get('inf') or [], 'anchors': _anchors(body),
                             'file': os.path.relpath(fp, root).replace('\\','/')}
        if table:
            graph['table_to_sch'].setdefault(table, []).append(sid)
    return graph
```

- [ ] **Step 4: 통과 확인** — `python scripts\tests\test_change_context.py` → PASS.

- [ ] **Step 5: 커밋**
```
git add scripts/spec_graph_build.py scripts/tests/test_change_context.py
git commit -m "feat: add spec_graph_build.py — build INF/SCH graph + source anchors from specs"
```

---

## Task 2: build_change_context.py — 영향슬라이스 + 앵커 브리프

**Files:** Create `scripts/build_change_context.py`; extend test

- [ ] **Step 1: 테스트 추가**
```python
def test_change_context_brief():
    import tempfile, shutil, subprocess, sys, os, json
    tmp = tempfile.mkdtemp()
    try:
        _inf(tmp,'order','ORD',1,'POST','/order/list',['ORDERS','SHARED_T'],'src/order/OrderCtl.java:10-50')
        _inf(tmp,'product','PRD',1,'GET','/product/get',['SHARED_T'],'src/product/PrdCtl.java:5-20')
        env = dict(os.environ, PYTHONUTF8='1')
        # 엔티티: SHARED_T (테이블) 변경 → ripple로 두 INF
        r = subprocess.run([sys.executable, os.path.join(SCRIPTS,'build_change_context.py'),
                            tmp, '--entities', 'SHARED_T'], capture_output=True, text=True, env=env)
        assert r.returncode == 0, r.stderr
        brief = os.path.join(tmp,'docs/변경관리/_adhoc/_asis_brief.md')
        c = open(brief, encoding='utf-8').read()
        assert 'INF-ORD-001' in c and 'INF-PRD-001' in c, 'ripple 누락'
        assert 'OrderCtl.java:10-50' in c, '앵커 누락'
        assert 'ripple' in c.lower() or '공유' in c, 'ripple 경고 누락'
        print('PASS: test_change_context_brief')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
```
`__main__`에 추가.

- [ ] **Step 2: 실패 확인.**

- [ ] **Step 3: 구현**

`scripts/build_change_context.py`:
```python
# STATUS: 완료
#!/usr/bin/env python3
"""
build_change_context.py — SR 엔티티 → 영향슬라이스 + 소스앵커 브리프 (zero-LLM, JIT 리트리버)
sl-change AS-IS 그라운딩. 요약 스펙 본문은 싣지 않고 앵커(file:line)만 → 에이전트가 실소스 read.
Usage:
  python build_change_context.py <workspace> [--sr SR-ID] --entities "kw1,kw2,INF-..,TABLE.."
"""
import os, sys, re, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spec_graph_build as sgb

def parse_args(argv):
    ws, sr, ents = '.', '_adhoc', []
    i = 0
    while i < len(argv):
        if argv[i] == '--sr' and i+1 < len(argv):
            sr = argv[i+1]; i += 2
        elif argv[i] == '--entities' and i+1 < len(argv):
            ents = [e.strip() for e in re.split(r'[,\s]+', argv[i+1]) if e.strip()]; i += 2
        elif not argv[i].startswith('--'):
            ws = argv[i]; i += 1
        else:
            i += 1
    return ws, sr, ents

def match_seed(graph, ents):
    """엔티티 → 직접 매칭 INF/SCH/table 시드."""
    inf_seed, table_seed = set(), set()
    up = [e.upper() for e in ents]
    for e, eu in zip(ents, up):
        if eu in graph['inf']:
            inf_seed.add(eu)
        if eu in graph['table_to_inf'] or eu in graph['table_to_sch']:
            table_seed.add(eu)
        # 키워드: path/method 부분일치
        for iid, n in graph['inf'].items():
            if e and (e.lower() in (n.get('path') or '').lower()):
                inf_seed.add(iid)
    return inf_seed, table_seed

def expand(graph, inf_seed, table_seed):
    """forward + reverse(ripple) 1홉 확장."""
    infs, tables, schs, ripple = set(inf_seed), set(table_seed), set(), []
    for iid in inf_seed:
        for t in graph['inf'][iid]['tables']:
            tables.add(t)
    for t in tables:
        users = graph['table_to_inf'].get(t, [])
        for u in users:
            if u not in infs:
                ripple.append((t, u))  # 공유테이블 사용처
            infs.add(u)
        for s in graph['table_to_sch'].get(t, []):
            schs.add(s)
    return infs, tables, schs, ripple

def emit_brief(root, sr, graph, infs, tables, schs, ripple, ents):
    lines = [f'# AS-IS 브리프 — {sr}', '',
             f'요청 엔티티: {", ".join(ents)}', '',
             '> 요약 스펙 본문 대신 **소스앵커**를 싣는다. 에이전트는 아래 file:line을 Read하여 최신·정밀 AS-IS를 확보한다.', '']
    lines.append('## 영향 INF (+ 근거소스 앵커)')
    for iid in sorted(infs):
        n = graph['inf'].get(iid, {})
        lines.append(f"- **{iid}** {n.get('method','')} {n.get('path','')}  ·  {n.get('file','')}")
        for a in n.get('anchors', []):
            lines.append(f"    - 소스: `{a}`")
    lines.append('\n## 영향 SCH')
    for sid in sorted(schs):
        n = graph['sch'].get(sid, {})
        lines.append(f"- **{sid}** ({n.get('table','')})  ·  {n.get('file','')}")
        for a in n.get('anchors', []):
            lines.append(f"    - 소스: `{a}`")
    lines.append('\n## 영향 테이블')
    lines.append(', '.join(sorted(tables)) or '(없음)')
    if ripple:
        lines.append('\n## ⚠️ Ripple 경고 (공유테이블 사용처 — 회귀 위험)')
        for t, u in ripple:
            lines.append(f"- `{t}` 변경 시 **{u}** 영향 (시드 외 사용처)")
    out_dir = os.path.join(root, 'docs', '변경관리', sr)
    os.makedirs(out_dir, exist_ok=True)
    p = os.path.join(out_dir, '_asis_brief.md')
    open(p, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    return p

def main():
    ws, sr, ents = parse_args(sys.argv[1:])
    if not ents:
        print('엔티티 없음 — --entities 필요'); return 1
    graph = sgb.build_graph(ws)
    inf_seed, table_seed = match_seed(graph, ents)
    infs, tables, schs, ripple = expand(graph, inf_seed, table_seed)
    p = emit_brief(ws, sr, graph, infs, tables, schs, ripple, ents)
    print(f'AS-IS 브리프: {p}')
    print(f'영향 INF {len(infs)} / SCH {len(schs)} / 테이블 {len(tables)} / ripple {len(ripple)}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
```

- [ ] **Step 4: 통과 확인** — 2 PASS.

- [ ] **Step 5: 커밋**
```
git add scripts/build_change_context.py scripts/tests/test_change_context.py
git commit -m "feat: add build_change_context.py — impact slice + source anchors brief (JIT retriever)"
```

---

## Task 3: extract_attachments.py — 첨부 텍스트 추출

**Files:** Create `scripts/extract_attachments.py`

- [ ] **Step 1: 구현 (lazy deps, graceful skip)**

`scripts/extract_attachments.py`:
```python
# STATUS: 완료
#!/usr/bin/env python3
"""
extract_attachments.py — 변경 첨부(PPT/Word/Excel/PDF) 텍스트 추출 (선택 의존성 lazy)
Usage: python extract_attachments.py <attach_dir> [out_md]
출력: out_md (기본 attach_dir/../_extracted.md)
"""
import os, sys, glob

def _pptx(p):
    try:
        from pptx import Presentation
    except ImportError:
        return None
    out = []
    for i, s in enumerate(Presentation(p).slides, 1):
        txt = [sh.text for sh in s.shapes if getattr(sh, 'has_text_frame', False) and sh.text.strip()]
        if txt:
            out.append(f'[슬라이드 {i}]\n' + '\n'.join(txt))
    return '\n\n'.join(out)

def _docx(p):
    try:
        import docx
    except ImportError:
        return None
    return '\n'.join(par.text for par in docx.Document(p).paragraphs if par.text.strip())

def _xlsx(p):
    try:
        import openpyxl
    except ImportError:
        return None
    wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
    out = []
    for ws in wb.worksheets:
        out.append(f'[시트 {ws.title}]')
        for row in ws.iter_rows(values_only=True):
            cells = [str(c) for c in row if c is not None]
            if cells:
                out.append('\t'.join(cells))
    return '\n'.join(out)

def _txt(p):
    return open(p, encoding='utf-8', errors='ignore').read()

EXT = {'.pptx': _pptx, '.docx': _docx, '.xlsx': _xlsx,
       '.txt': _txt, '.md': _txt, '.csv': _txt}

def main():
    if len(sys.argv) < 2:
        print('Usage: extract_attachments.py <attach_dir> [out_md]'); return 1
    adir = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(adir.rstrip('/\\')), '_extracted.md')
    blocks = []
    for fp in sorted(glob.glob(os.path.join(adir, '*'))):
        ext = os.path.splitext(fp)[1].lower()
        name = os.path.basename(fp)
        if ext == '.pdf':
            blocks.append(f'## {name}\n[PDF — 에이전트가 Read 도구로 직접 읽기 권장]')
            continue
        fn = EXT.get(ext)
        if not fn:
            blocks.append(f'## {name}\n[추출 미지원 포맷 {ext} — 내용 직접 입력 요청]')
            continue
        txt = fn(fp)
        if txt is None:
            blocks.append(f'## {name}\n[추출 불가 — 라이브러리 미설치(pptx/docx/openpyxl). 직접 입력 요청]')
        else:
            blocks.append(f'## {name}\n{txt.strip()}')
    open(out, 'w', encoding='utf-8').write('\n\n---\n\n'.join(blocks) + '\n')
    print(f'추출 완료: {out} ({len(blocks)}개 파일)')
    return 0

if __name__ == '__main__':
    sys.exit(main())
```

- [ ] **Step 2: 스모크 (txt만 — 라이브러리 무관)**
```
$env:PYTHONUTF8=1
New-Item -ItemType Directory -Force _tmp_att | Out-Null
'고객 요청: 환불 정책 변경' | Out-File -Encoding utf8 _tmp_att\req.txt
python scripts\extract_attachments.py _tmp_att _tmp_att\out.md
Get-Content _tmp_att\out.md
Remove-Item -Recurse -Force _tmp_att
```
Expected: out.md에 `## req.txt` + 본문.

- [ ] **Step 3: 커밋**
```
git add scripts/extract_attachments.py
git commit -m "feat: add extract_attachments.py — pptx/docx/xlsx text extraction (lazy deps)"
```

---

## Task 4: sl-change Step 1-D + JIT 그라운딩

**Files:** Modify `skills/sl-change/SKILL.md`

- [ ] **Step 1: Step 1-C 뒤에 Step 1-D(첨부 추출) 추가**

`### 1-C. 첨부파일 목록 확인` 섹션 뒤에:
```markdown
### 1-D. 첨부 본문 추출 (extract_attachments.py)

Jira 첨부를 `docs/변경관리/{SR-ID}/attachments/`에 다운로드(MCP `jira_download_attachments`) 후 텍스트 추출:
```bash
!python "{PLUGIN_PATH}/scripts/extract_attachments.py" docs/변경관리/{SR-ID}/attachments
```
산출 `docs/변경관리/{SR-ID}/_extracted.md`(PPT/Word/Excel 본문)를 요구사항 분석에 병합한다.
PDF·이미지는 Read 도구로 직접 읽는다. 라이브러리 미설치 포맷은 사용자에게 내용 입력 요청.
```

- [ ] **Step 2: Step 5(AS-IS 조회)를 JIT 그라운딩으로 교체**

`## Step 5 — AS-IS 조회` 본문 앞부분(도메인 스펙 로드)을 다음으로 교체:
```markdown
SR + `_extracted.md`에서 엔티티(테이블명·INF-ID·path 키워드)를 추출해 **그래프 기반 영향슬라이스**를 만든다.
```bash
!python "{PLUGIN_PATH}/scripts/build_change_context.py" . --sr {SR-ID} --entities "{엔티티 쉼표구분}"
```
산출 `docs/변경관리/{SR-ID}/_asis_brief.md`에는 영향 INF/SCH/UIS + **근거소스 앵커(file:line)** + **ripple 경고**(공유테이블 사용처)가 담긴다.

**JIT read:** 브리프의 소스앵커 `file:line`을 **Read 도구로 직접 읽어** 최신·정밀 AS-IS를 확보한다(요약 스펙 대신 실소스). ripple 경고의 사용처는 회귀 영향분석(Step 6)에 반드시 반영한다.

> 프로세 INF/SCH 본문은 앵커가 비거나 소스가 없을 때만 폴백으로 로드한다.
```
기존 5-1/5-2(RTM 도메인행·도메인 스펙 로드)는 "폴백" 표기로 격하.

- [ ] **Step 3: 검증**
```
Select-String -Path skills\sl-change\SKILL.md -Pattern 'extract_attachments','build_change_context','_asis_brief','JIT read','ripple'
```
Expected: 5 매칭.

- [ ] **Step 4: 커밋**
```
git add skills/sl-change/SKILL.md
git commit -m "feat: sl-change Step 1-D attachment extract + JIT graph grounding (source-anchor read)"
```

---

## Task 5: nkshop 검증 + doc-sync + 무결성

- [ ] **Step 1: nkshop 실데이터 그래프/브리프 (Windows 경로 주의)**

```
$env:PYTHONUTF8=1
python scripts\build_change_context.py D:\nkshop-bos\nkshop-bos-admin --sr TESTSR --entities "JT_CODE"
```
Expected: exit 0, `_asis_brief.md`에 JT_CODE를 쓰는 다수 INF(ripple) + 각 근거소스 file:line 앵커. (JT_CODE는 공통코드라 광범위 사용 → ripple 검출 확인). ⚠️ nkshop에 `docs/변경관리/TESTSR/` 생성됨 — 검증 후 안내(우리 repo 아님, 사용자 판단). 가능하면 임시 SR-ID 사용 후 해당 폴더 정리 권고.

- [ ] **Step 2: 단위테스트 회귀** — `python scripts\tests\test_change_context.py` → 2 PASS.

- [ ] **Step 3: doc-sync**
- `scripts/README.md`: spec_graph_build.py·build_change_context.py·extract_attachments.py 등재(사용 STEP sl-change).
- `CLAUDE.md`: sl-change 라우팅/설명에 "그래프 JIT AS-IS 주입" + 버전노트:
```
> **v3.5.0**: sl-change AS-IS 주입을 요약스펙 로드 → **그래프 기반 영향슬라이스 + 소스앵커 JIT read**로 전환. `spec_graph_build.py`(스펙 frontmatter서 forward/reverse 그래프), `build_change_context.py`(SR 엔티티→영향슬라이스+근거소스 앵커+ripple 경고 브리프, zero-LLM), `extract_attachments.py`(PPT/Word/Excel 추출, lazy). 에이전트는 앵커 file:line을 Read해 최신·정밀 AS-IS 확보(요약 손실 회피). 프로세 스펙은 납품물·폴백 유지. spec_graph.json 없어도 동작.
```

- [ ] **Step 4: 무결성 + 커밋**
```
$env:PYTHONUTF8=1; python scripts\tests\test_change_context.py
git add scripts/README.md CLAUDE.md
git commit -m "docs: sync scripts-README/CLAUDE for JIT change grounding (v3.5.0)"
```

---

## 완료 정의 (DoD)
- [ ] spec_graph_build/build_change_context/extract_attachments 신규 + 단위테스트 PASS.
- [ ] SR 엔티티 → 영향슬라이스(forward+reverse ripple) + 근거소스 앵커 브리프.
- [ ] sl-change: Step 1-D(첨부 추출) + Step 5 JIT 그라운딩(앵커 read), 프로세 스펙 폴백.
- [ ] spec_graph.json 부재서도 동작(nkshop 검증), 첨부 lazy 폴백.
- [ ] doc-sync(scripts-README/CLAUDE v3.5.0).
- [ ] 2스택(Java nkshop + 합성).
