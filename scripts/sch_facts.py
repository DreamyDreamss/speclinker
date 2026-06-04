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
            m = cand
            break
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
            c['pk'] = True
            c['nullable'] = False
    return cols

def _split_cols(body):
    out, depth, cur = [], 0, ''
    for ch in body:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if ch == ',' and depth == 0:
            out.append(cur)
            cur = ''
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
        db_cols, indexes, fks = db.table_facts(table)
    columns = merge_columns(db_cols, ddl_cols, list(draft_cols.values()))
    src = 'db' if db_cols else (('ddl:' + str(ddl_src)) if ddl_cols else 'sch_draft')
    return {'table': table, 'columns': columns, 'indexes': indexes,
            'fks': fks, 'evidence': evidence, 'source': src}


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
                                   user=env.get('DB_USER', ''), password=env.get('DB_PASSWORD', ''),
                                   database=env.get('DB_NAME', ''), connect_timeout=5)
            return _DB(conn, env.get('DB_NAME', ''), 'mysql')
        if dbtype in ('postgres', 'postgresql'):
            import psycopg2
            conn = psycopg2.connect(host=env['DB_HOST'], port=int(env.get('DB_PORT', 5432)),
                                    user=env.get('DB_USER', ''), password=env.get('DB_PASSWORD', ''),
                                    dbname=env.get('DB_NAME', ''), connect_timeout=5)
            return _DB(conn, 'public', 'postgres')
    except Exception as e:
        print(f'[WARN] DB 연결 실패 → 파일 파싱 폴백: {e}')
    return None

class _DB:
    def __init__(self, conn, schema, kind):
        self.conn, self.schema, self.kind = conn, schema, kind

    def _q(self, sql, args):
        cur = self.conn.cursor()
        cur.execute(sql, args)
        rows = cur.fetchall()
        cur.close()
        return rows

    def table_facts(self, table):
        cols, idx, fks = [], [], []
        try:
            if self.kind == 'mysql':
                sql = ("SELECT column_name,column_type,is_nullable,column_default,column_comment,column_key "
                       "FROM information_schema.columns WHERE table_schema=%s AND table_name=%s "
                       "ORDER BY ordinal_position")
            else:
                sql = ("SELECT column_name,data_type,is_nullable,column_default,'','' "
                       "FROM information_schema.columns WHERE table_schema=%s AND table_name=%s "
                       "ORDER BY ordinal_position")
            for r in self._q(sql, (self.schema, table)):
                cols.append(_col(r[0], type=r[1], nullable=(str(r[2]).upper() == 'YES'),
                                 default=r[3], comment=(r[4] or None),
                                 pk=(str(r[5]).upper() == 'PRI')))
        except Exception as e:
            print(f'[WARN] {table} 컬럼 조회 실패: {e}')
        return cols, idx, fks
