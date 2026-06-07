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
    try:
        return json.load(open(p, encoding='utf-8'))
    except Exception:
        return default

def next_seq(sch_dir, code):
    mx = 0
    if os.path.isdir(sch_dir):
        for f in os.listdir(sch_dir):
            m = re.match(rf'SCH-{code}-(\d+)\.md$', f)
            if m:
                mx = max(mx, int(m.group(1)))
    return mx + 1

def inf_range_for(root, domain, table):
    p = os.path.join(root, '_tmp/sch_draft', domain, table + '.json')
    d = load_json(p, {})
    return d.get('referencedByInfRange', []) or []

def col_table_md(columns):
    out = ['| 컬럼명 | 타입 | NULL | 키 | 기본값 | 설명 |',
           '|--------|------|------|----|--------|------|']
    for c in columns:
        typ = c['type'] or '<!-- LLM-TODO -->'
        nul = 'N' if c['nullable'] is False else ('Y' if c['nullable'] else '?')
        key = 'PK' if c['pk'] else ('FK' if c.get('fk') else '')
        dft = c['default'] if c['default'] not in (None, '') else '—'
        desc = c['comment'] or '<!-- LLM-TODO -->'
        out.append(f"| {c['name']} | {typ} | {nul} | {key} | {dft} | {desc} |")
    return '\n'.join(out)


def load_query_patterns(root):
    """scan_query_patterns 산출 — 관찰 조인쌍 + 상시필터. 없으면 빈 구조."""
    for rel in ('docs/05_설계서/_machine/query_patterns.json', '_tmp/query_patterns.json'):
        d = load_json(os.path.join(root, rel))
        if d:
            return d
    return {'joins': [], 'filters': []}


def join_rows_md(table, fks, qp):
    """DB 선언 FK(ref_col 포함) + 코드에서 관찰된 조인을 통합한 행 + 상시필터 여부."""
    T = table.upper()
    rows, seen = [], set()
    for f in fks:
        rc = f.get('ref_col') or f.get('ref_column') or '—'
        k = (f['col'].upper(), f['ref_table'].upper(), str(rc).upper())
        seen.add(k)
        rows.append(f"| {f['col']} | {f['ref_table']} | {rc} | DB FK | {f.get('on_delete', '—')} |")
    for j in qp.get('joins', []):
        pairs = []
        if j['table_a'] == T:
            pairs.append((j['col_a'], j['table_b'], j['col_b']))
        if j['table_b'] == T:
            pairs.append((j['col_b'], j['table_a'], j['col_a']))
        for mycol, otable, ocol in pairs:
            k = (mycol.upper(), otable.upper(), ocol.upper())
            if k in seen:
                continue
            seen.add(k)
            rows.append(f"| {mycol} | {otable} | {ocol} | 쿼리관찰({j['freq']}) | — |")
    return '\n'.join(rows) or '| — | — | — | — | — |'


def standing_filter_md(table, qp):
    """상시 필터(soft-delete/테넌트) 접이식 섹션. 없으면 ('', False)."""
    T = table.upper()
    filt = [f for f in qp.get('filters', []) if f['table'] == T]
    if not filt:
        return '', False
    rows = '\n'.join(
        f"| {f['col']} | {f['op']} {f['value']} | {f['freq']} | <!-- LLM-TODO --> | {', '.join(f.get('sources', [])[:2]) or '—'} |"
        for f in filt)
    block = (
        "\n<details>\n"
        f"<summary>🔧 쿼리 작성 가이드 — 상시 필터 (관찰 {len(filt)}건)</summary>\n\n"
        "> 이 테이블 조회 시 코드에서 반복 관찰된 술어. AIDD 쿼리 생성 시 누락하면 결과가 틀어진다.\n\n"
        "| 컬럼 | 조건 | 빈도 | 의미 | 출처 |\n"
        "|------|------|------|------|------|\n"
        f"{rows}\n\n"
        "</details>\n")
    return block, True

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

def collect_anchors(facts, draft_json):
    """SCH 근거 소스를 구조화 anchors(소스 파일)로 — DDL/쿼리/라우터. JIT 소스 정밀조회용.
    (INF anchors가 file:line 풀체인이라면, SCH anchors는 테이블을 정의·사용하는 소스 파일 목록.)"""
    anchors, seen = [], set()
    def add(path, role):
        p = (path or '').replace('\\', '/').strip()
        if not p or p in seen:
            return
        seen.add(p)
        anchors.append(f'{p} ({role})')
    src = facts.get('source', '') or ''
    if src.startswith('ddl:'):
        add(src[4:], 'DDL')
    for q in (facts.get('evidence') or [])[:8]:
        add(q, 'query')
    for r in ((draft_json or {}).get('referencedByRouter') or [])[:4]:
        add(r, 'router')
    return anchors[:12]


def emit_sch(root, domain, code, table, seq, facts, qp=None, draft_json=None):
    qp = qp or {'joins': [], 'filters': []}
    sid = f'SCH-{code}-{seq:03d}'
    infs = inf_range_for(root, domain, table)
    inf_fm = '[' + ', '.join(infs) + ']' if infs else '[]'
    api_link = f'[{infs[0]}](../INF/{infs[0]}.md)' if infs else '[TBD]'
    fk_rows = join_rows_md(table, facts['fks'], qp)
    filt_block, has_filter = standing_filter_md(table, qp)
    idx_rows = '\n'.join(f"| {i['name']} | {', '.join(i['cols'])} | {'UNIQUE' if i.get('unique') else 'INDEX'} | |"
                         for i in facts['indexes']) or '| — | — | — | — |'
    has_code = any(CODE_COL_RE.search(c['name']) for c in facts['columns'])
    anchors = collect_anchors(facts, draft_json)
    anchors_yaml = ('\nanchors:\n' + '\n'.join(f'  - "{a}"' for a in anchors)) if anchors else ''
    md = f"""---
sch-id: {sid}
table: {table}
domain: {domain}
domain-code: {code}
inf: {inf_fm}{anchors_yaml}
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

### 관계 (FK / 관찰된 조인)
| 자식 컬럼 | 참조 테이블 | 참조 컬럼 | 출처 | ON DELETE |
|---------|-----------|---------|------|----------|
{fk_rows}

> 출처 `DB FK`=DB 선언 제약, `쿼리관찰(N)`=소스 SQL에서 N회 등장한 등가조인(논리 FK).
{filt_block}
### mini-ERD
{erd_md(table, facts['columns'], facts['fks'])}

### 비즈니스 주의사항
<!-- LLM-TODO: 참조 INF 비즈니스 규칙/트랜잭션/사이드이펙트 기반 주의사항. 없으면 생략 -->
"""
    sch_dir = os.path.join(root, 'docs/05_설계서', domain, 'SCH')
    os.makedirs(sch_dir, exist_ok=True)
    open(os.path.join(sch_dir, sid + '.md'), 'w', encoding='utf-8').write(md)
    return sid, infs, has_code, has_filter

def emit_domain_index(root, domain, code, rows):
    erd = ['```mermaid', 'erDiagram']
    for sid, table, _ in rows:
        erd.append(f'    {table} {{ }}')
    erd.append('```')
    tbl = ['| SCH-ID | 테이블명 | INF-ID |', '|--------|---------|--------|']
    for sid, table, infs in rows:
        tbl.append(f"| {sid} | [{table}](./SCH/{sid}.md) | {', '.join(infs) or '—'} |")
    md = (f"# {domain} DB 개요\n\n## 도메인 ERD\n\n" + '\n'.join(erd)
          + "\n\n## 테이블 목록\n\n" + '\n'.join(tbl) + '\n')
    open(os.path.join(root, 'docs/05_설계서', domain, f'DB_{domain}.md'), 'w', encoding='utf-8').write(md)

def emit_global_index(root, all_rows):
    lines = ['# DB 스키마 설계서\n', '## 스키마 색인\n',
             '| SCH-ID  | 테이블명 | INF-ID |', '|---------|---------|--------|']
    for domain, sid, table, infs in all_rows:
        lines.append(f"| {sid} | [{table}](./{domain}/SCH/{sid}.md) | {', '.join(infs) or '—'} |")
    open(os.path.join(root, 'docs/05_설계서', 'DB_Schema.md'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')

def main():
    root = sys.argv[1] if len(sys.argv) > 1 else '.'
    todo = load_json(os.path.join(root, '_tmp/sch_todo.json'), [])
    if not todo:
        print('sch_todo.json 없음/빈 — 생성 대상 없음')
        return 0
    env = {}
    ep = os.path.join(root, 'project.env')
    if os.path.exists(ep):
        for line in open(ep, encoding='utf-8'):
            if '=' in line and not line.strip().startswith('#'):
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip()
    db = sch_facts.connect_db(env)
    if db:
        print('DB 드라이버 연결됨 — 권위 DDL 사용')
    qp = load_query_patterns(root)
    if qp.get('joins') or qp.get('filters'):
        print(f"query_patterns 로드: 조인쌍 {len(qp.get('joins', []))} / 상시필터 {len(qp.get('filters', []))}")
    all_rows, enrich = [], []
    for d in todo:
        domain, code = d['name'], d['code']
        sch_dir = os.path.join(root, 'docs/05_설계서', domain, 'SCH')
        seq = next_seq(sch_dir, code)
        rows, dom_has_code, dom_needs_type, dom_has_filter = [], False, False, False
        for table in d.get('missing', []):
            draft = os.path.join(root, '_tmp/sch_draft', domain, table + '.json')
            draft_json = load_json(draft, {}) if os.path.exists(draft) else {}
            facts = sch_facts.collect_table_facts(
                table, [draft] if os.path.exists(draft) else [], db=db, src_roots=[root])
            sid, infs, has_code, has_filter = emit_sch(
                root, domain, code, table, seq, facts, qp, draft_json)
            rows.append((sid, table, infs))
            all_rows.append((domain, sid, table, infs))
            dom_has_code = dom_has_code or has_code
            dom_has_filter = dom_has_filter or has_filter
            # 타입 미상(컬럼 type=None)이면 enrichment에서 DB MCP(ora_describe_table)로 채워야 함
            dom_needs_type = dom_needs_type or any(c.get('type') is None for c in facts.get('columns', []))
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
        dom_enrich = dom_has_code or dom_needs_type or dom_has_filter
        if dom_enrich:
            enrich.append({'name': domain, 'code': code, 'missing': d.get('missing', []),
                           'needs_type': dom_needs_type, 'has_filter': dom_has_filter})
        print(f'{domain}: SCH {len(d.get("missing", []))}건 스켈레톤 생성 '
              f'(enrich={dom_enrich}, 타입미상={dom_needs_type}, 상시필터={dom_has_filter})')
    emit_global_index(root, all_rows)
    json.dump(enrich, open(os.path.join(root, '_tmp/sch_enrich_todo.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=2)
    print(f'완료: SCH {len(all_rows)}건 / enrichment 대상 {len(enrich)}도메인')
    return 0

if __name__ == '__main__':
    sys.exit(main())
