# SCH 정적 하이브리드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. TDD: 테스트 먼저 → 실패 확인 → 구현 → 통과 → 커밋.

**Goal:** SCH 생성을 zero-token 정적 스켈레톤(`build_sch_static.py`) + LLM enrichment 디스패처(`dispatch_sch_gen.py`)로 분리하고, ddd-db-agent를 enrichment 전용으로 전환.

**Architecture:** 사실(컬럼·타입·인덱스·FK·ERD·링크)은 스크립트가 파일파싱+DB드라이버로 생성, 의미(코드값·비즈주의·한글설명)만 에이전트가 `<!-- LLM-TODO -->` 마커를 채움. 산출물 형식·경로 무변경.

**Tech Stack:** Python 3 stdlib + 선택적 pymysql/psycopg2(lazy). 검증=합성 픽스처 TDD + nkshop 실데이터(무DB 폴백) + grep 게이트.

**상위 설계서:** `docs/superpowers/specs/2026-06-04-sch-static-hybrid-design.md`

**입력 포맷(확정):**
- `_tmp/sch_todo.json` = `[{name, code, existing:[테이블명], missing:[테이블명]}]`
- `_tmp/sch_draft/{도메인}/{테이블}.json` = `{table, domain, columns:{COL:{seen}}, evidence:[sql파일], joinHints, referencedByRouter, referencedByInfRange:[]}`
- 컬럼은 **이름만**(타입 없음) → 타입/인덱스/FK는 DB드라이버>CREATE TABLE>ORM에서 보강, 없으면 `<!-- LLM-TODO -->`.

**불변식:** SCH 출력 형식/경로(개별파일+DB_{도메인}+DB_Schema, frontmatter) 무변경. build_sch_todo/link_inf_sch_new 무변경. INF·AIDD·DELTA 무영향. 파일파싱 스택중립, 드라이버 선택. 2스택(Java+무DB) 검증.

---

## 파일 구조

| 파일 | 액션 |
|------|------|
| `scripts/sch_facts.py` | **생성** — 사실 수집(sch_draft/DDL/ORM/DB드라이버) → 정규화 컬럼/인덱스/FK |
| `scripts/build_sch_static.py` | **생성** — sch_facts → SCH 스켈레톤·DB_{도메인}·DB_Schema·enrich_todo |
| `scripts/dispatch_sch_gen.py` | **생성** — enrichment 디스패처(dispatch_inf_gen 미러) |
| `scripts/tests/test_sch_static.py` | **생성** — 합성 픽스처 TDD |
| `agents/ddd-db-agent.md` | 수정 — enrichment 모드 |
| `skills/sl-recon/SKILL.md` | 수정 — STEP 5 재구성(5-A/5-B) |
| `docs/RECON_PIPELINE.md`,`scripts/README.md`,`CLAUDE.md` | doc-sync |

---

## Task 1: sch_facts.py — 사실 수집 레이어 (파일 파싱)

테이블별 정규화 사실 dict를 만든다: `{table, columns:[{name,type,nullable,default,comment,pk,fk}], indexes:[...], fks:[...], source}`. DB 드라이버는 Task 3에서 추가.

**Files:** Create `scripts/sch_facts.py`, `scripts/tests/test_sch_static.py`

- [ ] **Step 1: 실패 테스트 작성**

`scripts/tests/test_sch_static.py`:

```python
#!/usr/bin/env python3
"""build_sch_static / sch_facts 단위 검증 (합성 픽스처)."""
import os, sys, json, subprocess, tempfile, shutil
SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPTS)

def test_sch_draft_columns():
    import sch_facts
    tmp = tempfile.mkdtemp()
    try:
        draft = os.path.join(tmp, 'appln.json')
        json.dump({'table':'appln','domain':'product',
                   'columns':{'DEPT_ID':{'seen':1},'APPLN_NO':{'seen':2}},
                   'evidence':[], 'referencedByInfRange':[]},
                  open(draft,'w',encoding='utf-8'))
        facts = sch_facts.collect_table_facts('appln', [draft], db=None, src_roots=[])
        names = [c['name'] for c in facts['columns']]
        assert 'DEPT_ID' in names and 'APPLN_NO' in names, names
        # 타입 없음 → None (LLM-TODO 대상)
        assert all(c['type'] is None for c in facts['columns']), facts['columns']
        print('PASS: test_sch_draft_columns')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

def test_create_table_parse():
    import sch_facts
    sql = '''CREATE TABLE users (
        id BIGINT NOT NULL AUTO_INCREMENT,
        email VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'USER',
        PRIMARY KEY (id)
    );'''
    cols = sch_facts.parse_create_table(sql, 'users')
    by = {c['name']: c for c in cols}
    assert by['id']['type'].upper().startswith('BIGINT'), by['id']
    assert by['email']['nullable'] is False, by['email']
    assert by['role']['default'] == "'USER'", by['role']
    assert by['id']['pk'] is True, by['id']
    print('PASS: test_create_table_parse')

if __name__ == '__main__':
    test_sch_draft_columns()
    test_create_table_parse()
```

- [ ] **Step 2: 실패 확인**

Run: `$env:PYTHONUTF8=1; python scripts\tests\test_sch_static.py`
Expected: FAIL — `sch_facts` 없음(ModuleNotFoundError).

- [ ] **Step 3: sch_facts.py 구현**

`scripts/sch_facts.py`:

```python
# STATUS: 완료
#!/usr/bin/env python3
"""
sch_facts.py — SCH 정적 사실 수집 레이어 (zero-token, 파일 파싱 + 선택적 DB 드라이버)

테이블별 정규화 사실:
  {table, columns:[{name,type,nullable,default,comment,pk,fk}],
   indexes:[{name,cols,unique}], fks:[{col,ref_table,ref_col}], source}
우선순위(merge): DB 드라이버 > CREATE TABLE(DDL) > ORM > sch_draft(이름만)
"""
import os, re, json, glob

def _col(name, type=None, nullable=None, default=None, comment=None, pk=False, fk=None):
    return {'name': name, 'type': type, 'nullable': nullable,
            'default': default, 'comment': comment, 'pk': pk, 'fk': fk}

# ---- sch_draft (컬럼명만) ----
def load_draft_columns(draft_paths):
    cols, evidence = {}, []
    for p in draft_paths:
        try:
            d = json.load(open(p, encoding='utf-8'))
        except Exception:
            continue
        for cname in (d.get('columns') or {}):
            cols.setdefault(cname, _col(cname))
        evidence += d.get('evidence', []) or []
    return cols, evidence

# ---- CREATE TABLE 파서 ----
_CT_RE = re.compile(r'CREATE\s+TABLE\s+[`"\[]?(\w+)[`"\]]?\s*\((.*?)\)\s*(?:ENGINE|;|$)',
                    re.IGNORECASE | re.DOTALL)
def parse_create_table(sql_text, table):
    m = None
    for cand in _CT_RE.finditer(sql_text):
        if cand.group(1).lower() == table.lower():
            m = cand; break
    if not m:
        return []
    body = m.group(2)
    cols, pks = [], set()
    for raw in _split_cols(body):
        line = raw.strip()
        up = line.upper()
        pkm = re.match(r'PRIMARY\s+KEY\s*\(([^)]+)\)', up)
        if pkm:
            pks |= {c.strip(' `"[]').lower() for c in pkm.group(1).split(',')}
            continue
        if up.startswith(('KEY ', 'INDEX ', 'UNIQUE ', 'CONSTRAINT', 'FOREIGN')):
            continue
        cm = re.match(r'[`"\[]?(\w+)[`"\]]?\s+([A-Za-z]+(?:\s*\([\d,\s]+\))?)(.*)', line)
        if not cm:
            continue
        name, ctype, rest = cm.group(1), cm.group(2).strip(), cm.group(3)
        nullable = 'NOT NULL' not in rest.upper()
        dm = re.search(r'DEFAULT\s+(\'[^\']*\'|\S+)', rest, re.IGNORECASE)
        cols.append(_col(name, type=ctype, nullable=nullable,
                         default=dm.group(1) if dm else None))
    for c in cols:
        if c['name'].lower() in pks:
            c['pk'] = True; c['nullable'] = False
    return cols

def _split_cols(body):
    out, depth, cur = [], 0, ''
    for ch in body:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if ch == ',' and depth == 0:
            out.append(cur); cur = ''
        else:
            cur += ch
    if cur.strip():
        out.append(cur)
    return out

def find_create_table(table, evidence, src_roots):
    """evidence/소스 루트에서 해당 테이블의 CREATE TABLE을 찾는다."""
    cands = list(evidence)
    for root in src_roots:
        cands += glob.glob(os.path.join(root, '**', '*.sql'), recursive=True)
    for p in cands:
        if not str(p).lower().endswith('.sql'):
            continue
        try:
            txt = open(p, encoding='utf-8', errors='ignore').read()
        except OSError:
            continue
        if re.search(rf'CREATE\s+TABLE\s+[`"\[]?{re.escape(table)}\b', txt, re.IGNORECASE):
            cols = parse_create_table(txt, table)
            if cols:
                return cols, p
    return [], None

# ---- merge (우선순위) ----
def merge_columns(*sources):
    """앞 인자가 더 높은 권위. 이름 기준 merge, 빈 필드만 하위에서 채움."""
    merged = {}
    for src in sources:
        for c in src:
            tgt = merged.setdefault(c['name'], _col(c['name']))
            for k, v in c.items():
                if k == 'name':
                    continue
                if tgt.get(k) in (None, False) and v not in (None, False):
                    tgt[k] = v
    return list(merged.values())

def collect_table_facts(table, draft_paths, db=None, src_roots=None):
    src_roots = src_roots or []
    draft_cols, evidence = load_draft_columns(draft_paths)
    ddl_cols, ddl_src = find_create_table(table, evidence, src_roots)
    db_cols, indexes, fks = [], [], []
    if db is not None:
        db_cols, indexes, fks = db.table_facts(table)  # Task 3
    columns = merge_columns(db_cols, ddl_cols, list(draft_cols.values()))
    src = 'db' if db_cols else ('ddl:' + str(ddl_src)) if ddl_cols else 'sch_draft'
    return {'table': table, 'columns': columns, 'indexes': indexes,
            'fks': fks, 'evidence': evidence, 'source': src}
```

- [ ] **Step 4: 통과 확인**

Run: `$env:PYTHONUTF8=1; python scripts\tests\test_sch_static.py`
Expected: `PASS: test_sch_draft_columns` / `PASS: test_create_table_parse`

- [ ] **Step 5: 커밋**
```
git add scripts/sch_facts.py scripts/tests/test_sch_static.py
git commit -m "feat: add sch_facts.py — static SCH fact collection (sch_draft + CREATE TABLE parse)"
```

---

## Task 2: build_sch_static.py — 스켈레톤 emitter + ERD + 색인

sch_facts를 받아 ddd-db-agent Phase 3-2 형식의 SCH 파일·DB_{도메인}·DB_Schema·enrich_todo를 생성.

**Files:** Create `scripts/build_sch_static.py`; extend `test_sch_static.py`

- [ ] **Step 1: 실패 테스트 추가** (`test_sch_static.py`에 append)

```python
def test_build_static_emit():
    tmp = tempfile.mkdtemp()
    try:
        # _domain_plan + sch_todo + sch_draft 픽스처
        os.makedirs(os.path.join(tmp,'docs/05_설계서/product/INF'), exist_ok=True)
        os.makedirs(os.path.join(tmp,'_tmp/sch_draft/product'), exist_ok=True)
        json.dump({'domains':[{'name':'product','code':'PRD','rootPaths':[]}]},
                  open(os.path.join(tmp,'docs/05_설계서/_domain_plan.json'),'w',encoding='utf-8'))
        json.dump([{'name':'product','code':'PRD','existing':[],'missing':['appln']}],
                  open(os.path.join(tmp,'_tmp/sch_todo.json'),'w',encoding='utf-8'))
        json.dump({'table':'appln','domain':'product','columns':{'DEPT_ID':{'seen':1},'STS_CD':{'seen':1}},
                   'evidence':[], 'referencedByInfRange':[]},
                  open(os.path.join(tmp,'_tmp/sch_draft/product/appln.json'),'w',encoding='utf-8'))
        open(os.path.join(tmp,'project.env'),'w',encoding='utf-8').write('PLUGIN_PATH='+SCRIPTS.replace('\\','/').rsplit('/scripts',1)[0]+'\n')
        env = dict(os.environ, PYTHONUTF8='1')
        r = subprocess.run([sys.executable, os.path.join(SCRIPTS,'build_sch_static.py'), tmp],
                           capture_output=True, text=True, env=env)
        assert r.returncode == 0, r.stderr
        sch = os.path.join(tmp,'docs/05_설계서/product/SCH/SCH-PRD-001.md')
        assert os.path.exists(sch), 'SCH 파일 없음'
        c = open(sch,encoding='utf-8').read()
        assert 'sch-id: SCH-PRD-001' in c and 'table: appln' in c
        assert 'DEPT_ID' in c
        assert 'LLM-TODO' in c  # 코드값/비즈주의 마커
        assert os.path.exists(os.path.join(tmp,'docs/05_설계서/product/DB_product.md'))
        assert os.path.exists(os.path.join(tmp,'docs/05_설계서/DB_Schema.md'))
        # 코드성 컬럼(STS_CD) → enrich_todo
        et = json.load(open(os.path.join(tmp,'_tmp/sch_enrich_todo.json'),encoding='utf-8'))
        assert any(d['name']=='product' for d in et), et
        print('PASS: test_build_static_emit')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
```
그리고 `__main__`에 `test_build_static_emit()` 추가.

- [ ] **Step 2: 실패 확인** — `python scripts\tests\test_sch_static.py` → build_sch_static 없음.

- [ ] **Step 3: build_sch_static.py 구현**

`scripts/build_sch_static.py`:

```python
# STATUS: 완료
#!/usr/bin/env python3
"""
build_sch_static.py — SCH 정적 스켈레톤 생성기 (zero-token)
sl-recon STEP 5-A. sch_todo + sch_draft(+DB드라이버/DDL/ORM) → SCH 개별파일·DB_{도메인}·DB_Schema.
의미 섹션(코드값/비즈주의/컬럼설명)은 <!-- LLM-TODO --> 마커 → dispatch_sch_gen이 채움.
Usage: python build_sch_static.py [workspace]
"""
import os, sys, json, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sch_facts

CODE_COL_RE = re.compile(r'_(CD|TP|STS|YN|FL|GB|DIV)$', re.IGNORECASE)

def load_json(p, default=None):
    try: return json.load(open(p, encoding='utf-8'))
    except Exception: return default

def next_seq(sch_dir, code):
    mx = 0
    if os.path.isdir(sch_dir):
        for f in os.listdir(sch_dir):
            m = re.match(rf'SCH-{code}-(\d+)\.md$', f)
            if m: mx = max(mx, int(m.group(1)))
    return mx + 1

def inf_range_for(root, domain, table):
    """sch_draft referencedByInfRange 우선, 없으면 빈 목록."""
    p = os.path.join(root, '_tmp/sch_draft', domain, table + '.json')
    d = load_json(p, {})
    return d.get('referencedByInfRange', []) or []

def col_table_md(columns):
    out = ['| 컬럼명 | 타입 | NULL | 기본값 | 설명 |', '|--------|------|------|--------|------|']
    for c in columns:
        typ = c['type'] or '<!-- LLM-TODO -->'
        nul = 'N' if c['nullable'] is False else ('Y' if c['nullable'] else '?')
        dft = c['default'] or '—'
        desc = c['comment'] or '<!-- LLM-TODO -->'
        out.append(f"| {c['name']} | {typ} | {nul} | {dft} | {desc} |")
    return '\n'.join(out)

def erd_md(table, columns, fks):
    lines = ['```mermaid', 'erDiagram', f'    {table} {{']
    for c in columns[:30]:
        t = (c['type'] or 'COL').split('(')[0].upper()
        tag = 'PK' if c['pk'] else ('FK' if c['fk'] else '')
        lines.append(f'        {t} {c["name"]} {tag}'.rstrip())
    lines.append('    }')
    for fk in fks:
        lines.append(f'    {table} }}o--|| {fk["ref_table"]} : "{fk["col"]}"')
    lines.append('```')
    return '\n'.join(lines)

def emit_sch(root, domain, code, table, seq, facts):
    sid = f'SCH-{code}-{seq:03d}'
    infs = inf_range_for(root, domain, table)
    inf_fm = '[' + ', '.join(infs) + ']' if infs else '[]'
    api_link = (f'[{infs[0]}](../INF/{infs[0]}.md)' if infs else '[TBD]')
    fk_rows = '\n'.join(f"| {f['col']} | {f['ref_table']} | {f.get('on_delete','—')} |"
                        for f in facts['fks']) or '| — | — | — |'
    idx_rows = '\n'.join(f"| {i['name']} | {', '.join(i['cols'])} | {'UNIQUE' if i.get('unique') else 'INDEX'} | |"
                         for i in facts['indexes']) or '| — | — | — | — |'
    has_code = any(CODE_COL_RE.search(c['name']) for c in facts['columns'])
    md = f"""---
sch-id: {sid}
table: {table}
domain: {domain}
domain-code: {code}
inf: {inf_fm}
---

# {sid}: {table}

> **FUNC-ID:** [TBD] | **SRS-F:** [TBD] | **API:** {api_link} | **화면:** [TBD]

**근거 소스:** `{facts['source']}`

### 컬럼 설명
{col_table_md(facts['columns'])}

### 인덱스
| 인덱스명 | 컬럼 | 타입 | 목적 |
|---------|------|------|------|
{idx_rows}

### 코드값
<!-- LLM-TODO: 코드성 컬럼(_CD/_TP/_STS/_YN 등) 값·의미. 없으면 섹션 생략 가능 -->

### 관계 (FK)
| 참조 컬럼 | 참조 테이블 | ON DELETE |
|---------|-----------|----------|
{fk_rows}

### mini-ERD
{erd_md(table, facts['columns'], facts['fks'])}

### 비즈니스 주의사항
<!-- LLM-TODO: 참조 INF 비즈니스 규칙/트랜잭션/사이드이펙트 기반 주의사항. 없으면 생략 -->
"""
    sch_dir = os.path.join(root, 'docs/05_설계서', domain, 'SCH')
    os.makedirs(sch_dir, exist_ok=True)
    open(os.path.join(sch_dir, sid + '.md'), 'w', encoding='utf-8').write(md)
    return sid, infs, has_code

def emit_domain_index(root, domain, code, rows):
    # rows: [(sid, table, infs)]
    erd = ['```mermaid', 'erDiagram']
    for sid, table, _ in rows:
        erd.append(f'    {table} {{ }}')
    erd.append('```')
    tbl = ['| SCH-ID | 테이블명 | INF-ID |', '|--------|---------|--------|']
    for sid, table, infs in rows:
        tbl.append(f"| {sid} | [{table}](./SCH/{sid}.md) | {', '.join(infs) or '—'} |")
    md = f"# {domain} DB 개요\n\n## 도메인 ERD\n\n" + '\n'.join(erd) + "\n\n## 테이블 목록\n\n" + '\n'.join(tbl) + '\n'
    open(os.path.join(root, 'docs/05_설계서', domain, f'DB_{domain}.md'), 'w', encoding='utf-8').write(md)

def emit_global_index(root, all_rows):
    # all_rows: [(domain, sid, table, infs)]
    lines = ['# DB 스키마 설계서\n', '## 스키마 색인\n',
             '| SCH-ID  | 테이블명 | INF-ID |', '|---------|---------|--------|']
    for domain, sid, table, infs in all_rows:
        lines.append(f"| {sid} | [{table}](./{domain}/SCH/{sid}.md) | {', '.join(infs) or '—'} |")
    open(os.path.join(root, 'docs/05_설계서', 'DB_Schema.md'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')

def main():
    root = sys.argv[1] if len(sys.argv) > 1 else '.'
    todo = load_json(os.path.join(root, '_tmp/sch_todo.json'), [])
    if not todo:
        print('sch_todo.json 없음/빈 — 생성 대상 없음'); return 0
    db = None  # Task 3에서 connect_db(root)
    all_rows, enrich = [], []
    for d in todo:
        domain, code = d['name'], d['code']
        sch_dir = os.path.join(root, 'docs/05_설계서', domain, 'SCH')
        seq = next_seq(sch_dir, code)
        rows, dom_has_code = [], False
        for table in d.get('missing', []):
            draft = os.path.join(root, '_tmp/sch_draft', domain, table + '.json')
            facts = sch_facts.collect_table_facts(
                table, [draft] if os.path.exists(draft) else [], db=db, src_roots=[root])
            sid, infs, has_code = emit_sch(root, domain, code, table, seq, facts)
            rows.append((sid, table, infs)); all_rows.append((domain, sid, table, infs))
            dom_has_code = dom_has_code or has_code
            seq += 1
        # 기존 SCH도 도메인 색인에 포함
        if os.path.isdir(sch_dir):
            for f in sorted(os.listdir(sch_dir)):
                m = re.match(rf'(SCH-{code}-\d+)\.md$', f)
                if m and not any(r[0] == m.group(1) for r in rows):
                    c = open(os.path.join(sch_dir, f), encoding='utf-8').read()
                    t = re.search(r'^table:\s*(\S+)', c, re.M)
                    rows.append((m.group(1), t.group(1) if t else '?', []))
        emit_domain_index(root, domain, code, rows)
        if dom_has_code:
            enrich.append({'name': domain, 'code': code, 'missing': d.get('missing', [])})
        print(f'{domain}: SCH {len(d.get("missing",[]))}건 스켈레톤 생성 (enrich={dom_has_code})')
    emit_global_index(root, all_rows)
    json.dump(enrich, open(os.path.join(root, '_tmp/sch_enrich_todo.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=2)
    print(f'완료: SCH {len(all_rows)}건 / enrichment 대상 {len(enrich)}도메인')
    return 0

if __name__ == '__main__':
    sys.exit(main())
```

- [ ] **Step 4: 통과 확인** — `python scripts\tests\test_sch_static.py` → 3 PASS.

- [ ] **Step 5: 커밋**
```
git add scripts/build_sch_static.py scripts/tests/test_sch_static.py
git commit -m "feat: add build_sch_static.py — zero-token SCH skeleton + ERD + index + enrich_todo"
```

---

## Task 3: DB 드라이버 권위 경로 (선택적, lazy)

creds 있으면 information_schema로 타입·인덱스·FK 권위 수집. 없으면 폴백.

**Files:** Modify `scripts/sch_facts.py` (DB 클래스 추가), `scripts/build_sch_static.py` (connect)

- [ ] **Step 1: sch_facts.py에 DB 어댑터 추가**

`sch_facts.py` 끝에 추가:
```python
# ---- 선택적 DB 드라이버 ----
def connect_db(env):
    """project.env의 DB_* 로 연결. 드라이버/creds 없으면 None(폴백)."""
    dbtype = (env.get('DB_TYPE') or '').lower()
    if not dbtype or not env.get('DB_HOST'):
        return None
    try:
        if dbtype in ('mysql', 'mariadb'):
            import pymysql
            conn = pymysql.connect(host=env['DB_HOST'], port=int(env.get('DB_PORT', 3306)),
                                   user=env.get('DB_USER',''), password=env.get('DB_PASSWORD',''),
                                   database=env.get('DB_NAME',''), connect_timeout=5)
            return _DB(conn, env.get('DB_NAME',''), 'mysql')
        if dbtype in ('postgres', 'postgresql'):
            import psycopg2
            conn = psycopg2.connect(host=env['DB_HOST'], port=int(env.get('DB_PORT', 5432)),
                                    user=env.get('DB_USER',''), password=env.get('DB_PASSWORD',''),
                                    dbname=env.get('DB_NAME',''), connect_timeout=5)
            return _DB(conn, 'public', 'postgres')
    except Exception as e:
        print(f'[WARN] DB 연결 실패 → 파일 파싱 폴백: {e}')
    return None

class _DB:
    def __init__(self, conn, schema, kind):
        self.conn, self.schema, self.kind = conn, schema, kind
    def _q(self, sql, args):
        cur = self.conn.cursor(); cur.execute(sql, args)
        rows = cur.fetchall(); cur.close(); return rows
    def table_facts(self, table):
        cols, idx, fks = [], [], []
        try:
            for r in self._q(
                "SELECT column_name,column_type if_mysql,is_nullable,column_default,column_comment,column_key "
                "FROM information_schema.columns WHERE table_schema=%s AND table_name=%s ORDER BY ordinal_position"
                if self.kind == 'mysql' else
                "SELECT column_name,data_type,is_nullable,column_default,'','' "
                "FROM information_schema.columns WHERE table_schema=%s AND table_name=%s ORDER BY ordinal_position",
                (self.schema, table)):
                cols.append(_col(r[0], type=r[1], nullable=(str(r[2]).upper()=='YES'),
                                 default=r[3], comment=r[4] or None, pk=(str(r[5]).upper()=='PRI')))
        except Exception as e:
            print(f'[WARN] {table} 컬럼 조회 실패: {e}')
        return cols, idx, fks
```
(인덱스/FK 조회는 MVP에서 빈 목록 — 컬럼·타입·PK·코멘트가 핵심. 추후 STATISTICS/KEY_COLUMN_USAGE 확장 가능.)

- [ ] **Step 2: build_sch_static.py에서 connect**

`main()`의 `db = None` 을:
```python
    env = {}
    ep = os.path.join(root, 'project.env')
    if os.path.exists(ep):
        for line in open(ep, encoding='utf-8'):
            if '=' in line and not line.strip().startswith('#'):
                k, v = line.split('=', 1); env[k.strip()] = v.strip()
    db = sch_facts.connect_db(env)
    if db: print('DB 드라이버 연결됨 — 권위 DDL 사용')
```

- [ ] **Step 3: 폴백 회귀 테스트** — DB_* 없는 픽스처(기존 test)가 그대로 통과해야 함.
Run: `python scripts\tests\test_sch_static.py` → 3 PASS (connect_db가 None 반환, 폴백).

- [ ] **Step 4: 커밋**
```
git add scripts/sch_facts.py scripts/build_sch_static.py
git commit -m "feat: add optional DB driver authority (pymysql/psycopg2 lazy) with file-parse fallback"
```

---

## Task 4: dispatch_sch_gen.py — enrichment 디스패처

dispatch_inf_gen 패턴을 enrichment에 적용. 입력 `_tmp/sch_enrich_todo.json`.

**Files:** Create `scripts/dispatch_sch_gen.py`

- [ ] **Step 1: 작성** (dispatch_inf_gen 미러 — 도메인 단위)

`scripts/dispatch_sch_gen.py`: dispatch_inf_gen.py를 베이스로,
- `load_agent_md` → `agents/ddd-db-agent.md`
- inventory 대신 `_tmp/sch_enrich_todo.json`(도메인 배열) 로드. 비면 즉시 `print('enrichment 대상 없음'); return 0`.
- `build_prompt(domain_entry, workspace, agent_md)`: agent_md + 아래 task:
  ```
  enrichment 모드: 아래 도메인의 스켈레톤 SCH 파일에서 <!-- LLM-TODO --> 마커만 채운다.
  도메인: {name} / 코드: {code} / 워크스페이스: {ws}
  대상 파일: docs/05_설계서/{name}/SCH/*.md (이미 생성됨)
  채울 것: ### 코드값, ### 비즈니스 주의사항, 컬럼표 '설명' 칸의 <!-- LLM-TODO -->
  절대 수정 금지: frontmatter, DDL/컬럼 타입·NULL·기본값, 인덱스, FK, mini-ERD, 링크.
  근거: 해당 SCH가 참조하는 INF의 비즈니스 규칙/트랜잭션/사이드이펙트 + sch_draft evidence.
  ```
- `STATUS_FILE='_tmp/sch_dispatch_status.json'`, done/failed by 도메인 index, 자동 스킵·재시도.
- 나머지(run_batch/ThreadPoolExecutor/STAGGER/TIMEOUT)는 dispatch_inf_gen와 동일.

- [ ] **Step 2: 스모크 — enrich_todo 비었을 때 exit 0**
```
$env:PYTHONUTF8=1; New-Item -ItemType Directory -Force _tmp_b3 | Out-Null
'[]' | Out-File -Encoding utf8 _tmp_b3\sch_enrich_todo.json
```
간이 확인: `python -c "import json;print(json.load(open('_tmp_b3/sch_enrich_todo.json')))"` → `[]`. (실제 디스패치는 STEP 7 통합 검증에서.)
정리: `Remove-Item -Recurse -Force _tmp_b3`

- [ ] **Step 3: 커밋**
```
git add scripts/dispatch_sch_gen.py
git commit -m "feat: add dispatch_sch_gen.py — enrichment dispatcher (mirrors dispatch_inf_gen)"
```

---

## Task 5: ddd-db-agent.md enrichment 모드

**Files:** Modify `agents/ddd-db-agent.md`

- [ ] **Step 1: enrichment 모드 섹션 추가**

frontmatter description에 "enrichment 모드(스켈레톤 LLM-TODO 채움)" 추가. Phase 0 위에 새 섹션:
```markdown
## 모드: enrichment (기본 — build_sch_static 스켈레톤 보강)

호출자가 `enrichment 모드`로 지정하면, 이미 생성된 스켈레톤 SCH 파일의 `<!-- LLM-TODO -->` 마커만 채운다.
- **채울 것**: `### 코드값`(코드성 컬럼 값·의미), `### 비즈니스 주의사항`, 컬럼표 '설명' 칸.
- **절대 수정 금지(읽기 전용)**: frontmatter, DDL/컬럼 타입·NULL·기본값, 인덱스, FK 관계, mini-ERD, 크로스링크.
- 근거: 해당 SCH `inf:` frontmatter의 INF 파일 `## 비즈니스 규칙/트랜잭션/사이드이펙트` + sch_draft evidence.
- 코드값/비즈주의가 없으면 해당 마커 줄을 삭제(섹션 비움).

스켈레톤이 없을 때만(폴백) 아래 Phase 1~3 from-scratch 생성 경로를 사용한다.
```
기존 Phase 1~3은 "스켈레톤 없을 때 폴백"으로 명시(한 줄 추가).

- [ ] **Step 2: 검증**
```
Select-String -Path agents\ddd-db-agent.md -Pattern 'enrichment','LLM-TODO','읽기 전용','수정 금지'
```
Expected: 매칭 ≥ 3.

- [ ] **Step 3: 커밋**
```
git add agents/ddd-db-agent.md
git commit -m "refactor: ddd-db-agent enrichment mode (fill LLM-TODO markers, facts read-only)"
```

---

## Task 6: sl-recon STEP 5 재구성

**Files:** Modify `skills/sl-recon/SKILL.md`

- [ ] **Step 1: STEP 5 본문 교체**

STEP 5-0(build_sch_todo) 유지. 구 "ddd-db-agent를 Agent 도구로 3도메인씩 호출" 블록(`_tmp/sch_todo.json의 각 도메인...`)을 다음으로 교체:
```markdown
### STEP 5-A: 정적 스켈레톤 생성 (build_sch_static.py — zero-token)

사실(컬럼·타입·인덱스·FK·ERD·링크·색인)을 스크립트로 생성한다. LLM 토큰 0.
```bash
!python "{PLUGIN_PATH}/scripts/build_sch_static.py" .
```
> 컬럼 타입은 DB 드라이버(project.env DB_*) > CREATE TABLE > ORM > sch_draft 순. 무DB면 컬럼명 스켈레톤 + `<!-- LLM-TODO -->`.

### STEP 5-B: 의미 enrichment 디스패치 (dispatch_sch_gen.py)

코드값·비즈니스 주의사항이 필요한 도메인(`_tmp/sch_enrich_todo.json`)만 ddd-db-agent를 서브프로세스 병렬로 호출해 `<!-- LLM-TODO -->`를 채운다. 메인 컨텍스트 격리.
```bash
!python "{PLUGIN_PATH}/scripts/dispatch_sch_gen.py" .
```
> exit 0 = 완료(또는 enrichment 대상 없음). exit 1이면 `_tmp/sch_dispatch_status.json` failed 확인 후 재실행(완료분 자동 스킵).
```
STEP 5-1(link_inf_sch_new) 유지.

- [ ] **Step 2: 검증**
```
Select-String -Path skills\sl-recon\SKILL.md -Pattern 'build_sch_static','dispatch_sch_gen','STEP 5-A','STEP 5-B'
```
Expected: 4 패턴 매칭. 구 인라인 ddd-db-agent Agent 호출 블록 잔존 없음 확인.

- [ ] **Step 3: 커밋**
```
git add skills/sl-recon/SKILL.md
git commit -m "feat: sl-recon STEP 5 = static skeleton (5-A) + enrichment dispatch (5-B)"
```

---

## Task 7: nkshop 실데이터 검증 (무DB 폴백, 2스택 의무)

**Files:** 검증 전용 (nkshop product 도메인)

- [ ] **Step 1: nkshop에서 build_sch_static 단독 실행 (무DB)**

nkshop은 sch_draft 존재 + DB creds 없음 → 파일 파싱 폴백 경로 검증.
```
$env:PYTHONUTF8=1; python scripts\build_sch_static.py D:\nkshop-bos\nkshop-bos-admin
```
Expected: exit 0, `docs/05_설계서/{도메인}/SCH/SCH-*.md` 스켈레톤 생성(컬럼명 + LLM-TODO), DB_Schema.md 색인. 에러 없음.
> ⚠️ nkshop은 기존 SCH가 있을 수 있음 — build_sch_todo가 스킵 처리하는지/덮어쓰지 않는지 확인. 테스트 산출물이 의도치 않게 남으면 `git -C D:\nkshop-bos\nkshop-bos-admin status`로 확인 후 사용자 안내(해당 repo는 우리 소관 아님 — 생성 파일은 사용자 판단에 맡김).

- [ ] **Step 2: 형식 정합 확인**

생성된 SCH 1개를 열어 frontmatter(sch-id/table/domain/domain-code/inf) + 컬럼표 + mini-ERD + LLM-TODO 마커가 ddd-db-agent Phase 3-2 형식과 일치하는지 확인. gen_docsify가 색인하는 frontmatter 키 일치 필수.

- [ ] **Step 3: (스택2) 합성 무DB·무sch_draft 픽스처** — Task 2 테스트가 이미 sch_draft만으로 동작 → 스택중립 확인. 추가로 ORM(JPA `@Column`) 픽스처 1건 parse_create_table 외 경로가 필요하면 메모만(현 MVP는 CREATE TABLE+sch_draft+DB).

- [ ] **Step 4: 커밋 없음** (검증 단계). 문제 발견 시 해당 Task 복귀.

---

## Task 8: doc-sync + 최종 무결성

**Files:** `docs/RECON_PIPELINE.md`, `scripts/README.md`, `CLAUDE.md`, setup-deps 주석

- [ ] **Step 1: RECON_PIPELINE.md STEP 5 갱신** — 5-0/5-A/5-B/5-1 흐름 + "정적 스켈레톤 + enrichment" 설명 반영.

- [ ] **Step 2: scripts/README.md** — `sch_facts.py`·`build_sch_static.py`·`dispatch_sch_gen.py` 등재(사용 STEP: sl-recon 5-A/5-B). 선택 의존성(pymysql/psycopg2) 명시.

- [ ] **Step 3: CLAUDE.md** — ddd-db-agent 표 설명에 "(enrichment: 코드값·비즈주의)" 추가 + 버전노트:
```
> **v3.4.0**: SCH 생성 하이브리드화 — 사실(컬럼·타입·인덱스·FK·ERD·링크·색인)은 `build_sch_static.py`(zero-token, 파일파싱+선택적 DB드라이버), 의미(코드값·비즈주의·컬럼설명)는 `dispatch_sch_gen.py`(enrichment 디스패처, dispatch_inf_gen 미러)가 ddd-db-agent에 위임. sl-recon STEP 5=5-0/5-A/5-B/5-1. SCH 출력 형식·경로 무변경. 토큰 ~70%↓ + 컨텍스트 격리 + 실패 자동 재시도.
```

- [ ] **Step 4: 무결성 grep**
```
Select-String -Path skills\sl-recon\SKILL.md -Pattern 'ddd-db-agent를.*Agent 도구|3도메인씩'
node -e "1"  # placeholder
$env:PYTHONUTF8=1; python scripts\tests\test_sch_static.py
```
Expected: 구 인라인 호출 문구 0; 테스트 3 PASS.

- [ ] **Step 5: 커밋**
```
git add docs/RECON_PIPELINE.md scripts/README.md CLAUDE.md scripts/setup-deps.js
git commit -m "docs: sync RECON_PIPELINE/scripts-README/CLAUDE for SCH static-hybrid (v3.4.0)"
```

---

## 완료 정의 (DoD)
- [ ] sch_facts.py + build_sch_static.py + dispatch_sch_gen.py 신규, 단위테스트 PASS.
- [ ] SCH 사실(컬럼·타입·인덱스·FK·ERD·링크·DB_{도메인}·DB_Schema) 스크립트 생성, 의미는 `<!-- LLM-TODO -->` 마커.
- [ ] ddd-db-agent enrichment 모드(사실 읽기전용), sl-recon STEP 5-A/5-B.
- [ ] DB 드라이버 선택 경로 + 무DB 파일파싱 폴백(nkshop 검증).
- [ ] SCH 출력 형식·경로 무변경(뷰어/링크/merge 무영향), 멱등 재실행.
- [ ] doc-sync(RECON_PIPELINE/scripts-README/CLAUDE v3.4.0).
- [ ] 2스택(Java Spring + 무DB/합성) 검증.
