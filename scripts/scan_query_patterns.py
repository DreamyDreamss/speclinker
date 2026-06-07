# STATUS: 완료
#!/usr/bin/env python3
"""
scan_query_patterns.py — 실쿼리에서 조인 경로 + 상시 필터 관례 채굴 (zero-LLM, B)

소스 SQL/XML(MyBatis 등)에서:
  1) 관찰된 조인쌍: alias.col = alias.col 등가조인을 alias→table 해소하여 (A.col ↔ B.col)
     → DB에 FK 미선언인 레거시에서도 "외래키 역할"의 논리 관계를 복원.
  2) 상시 필터 관례: soft-delete(_YN/_FL)·테넌트 스코프(COMP/SITE/CORP..._CD/_ID/_NO)
     컬럼의 alias.col = 'literal' 술어를 테이블에 귀속 + 빈도 집계.
     → "이 테이블 조회 시 항상 붙는 조건"을 AIDD 쿼리 생성기에 제공.

의미(왜 이 필터인지)는 ddd-db-agent enrichment가 보강 — 본 스크립트는 사실 채굴까지.

Usage:
  python scan_query_patterns.py <paths...> [--out docs/05_설계서/_machine/query_patterns.json]
출력: {"joins":[{table_a,col_a,table_b,col_b,freq,sources[]}],
       "filters":[{table,col,op,value,freq,sources[]}]}
"""
import os, sys, re, json, glob

# ---- 패턴 ----
# 테이블 선언: FROM/JOIN <table> [AS] [alias]
_TBL = re.compile(r'\b(?:FROM|JOIN)\s+([A-Za-z_][\w$]*)\s*(?:(?:AS)\s+)?([A-Za-z_]\w*)?',
                  re.IGNORECASE)
# FROM 절(콤마 구식 조인): FROM ... (WHERE|GROUP|ORDER|HAVING|JOIN 전까지)
_FROMCLAUSE = re.compile(
    r'\bFROM\s+(.*?)(?=\b(?:WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|JOIN|LEFT|RIGHT|INNER|OUTER|UNION|MINUS|\)|$))',
    re.IGNORECASE | re.DOTALL)
# 등가 조인: a.col = b.col  (양쪽 모두 qualified)
_EQJOIN = re.compile(r'([A-Za-z_]\w*)\.([A-Za-z_][\w$]*)\s*=\s*([A-Za-z_]\w*)\.([A-Za-z_][\w$]*)')
# qualified 술어: a.col OP ('literal' | :BIND(바인드파라미터) | (...))
# 바인드 파라미터도 포착 — 테넌트 스코프(COMP_CD=#{compCd})는 값이 아니라 "항상 이 컬럼 필터"가 핵심.
_PRED = re.compile(r"([A-Za-z_]\w*)\.([A-Za-z_][\w$]*)\s*(=|<>|!=|IN)\s*('[^']{1,24}'|:BIND|\([^)]{1,80}\))",
                   re.IGNORECASE)
# MyBatis statement 블록
_STMT_XML = re.compile(r'<(select|update|insert|delete)\b[^>]*>(.*?)</\1>', re.IGNORECASE | re.DOTALL)

# 상시 필터로 채택할 컬럼 (soft-delete / 상태 플래그)
_SOFTDEL = re.compile(r'(?:^|_)(?:DEL|USE|ACTIVE|ENABLE|VALID|EXPOSE|DISP)_?(?:YN|FL|FLAG)$', re.IGNORECASE)
_FLAGSUF = re.compile(r'_(?:YN|FL|FLAG)$', re.IGNORECASE)
# 테넌트/멀티사이트 스코프 컬럼
_TENANT = re.compile(r'(?:COMP|CMPNY|CORP|BIZ|SITE|MALL|STORE|SHOP|TENANT|ORG|BRAND)_?(?:CD|ID|NO)$',
                     re.IGNORECASE)

# 테이블/별칭으로 오인하기 쉬운 SQL 키워드
_KW = {'select','from','where','and','or','on','as','set','values','dual','join','left','right',
       'inner','outer','full','cross','group','order','by','having','union','all','distinct',
       'case','when','then','else','end','not','in','is','null','exists','between','like',
       'using','into','update','insert','delete','with','minus','intersect','asc','desc',
       'count','sum','max','min','avg','nvl','decode','to_char','to_date','sysdate'}

# MyBatis 바인드 파라미터 → :BIND 토큰으로 보존(술어 RHS 판별용), 나머지 노이즈는 제거
_BIND = re.compile(r'#\{[^}]*\}|\$\{[^}]*\}')
_NOISE = re.compile(r'<[^>]+>|/\*.*?\*/|--[^\n]*', re.DOTALL)


def _strip(text):
    text = text or ''
    text = text.replace('<![CDATA[', ' ').replace(']]>', ' ')
    text = _BIND.sub(' :BIND ', text)
    text = _NOISE.sub(' ', text)
    return text


def _statements(text, is_xml):
    if is_xml:
        blocks = [m.group(2) for m in _STMT_XML.finditer(text)]
        if blocks:
            return [_strip(b) for b in blocks]
    return [_strip(s) for s in re.split(r';', text)]


def _alias_map(stmt):
    """alias(소문자)→table(대문자). 테이블명 자신도 키로 등록."""
    amap = {}
    def reg(tbl, alias):
        if not tbl or tbl.lower() in _KW:
            return
        T = tbl.upper()
        amap.setdefault(T.lower(), T)          # 테이블명으로 qualify한 경우
        if alias and alias.lower() not in _KW:
            amap[alias.lower()] = T
    for m in _TBL.finditer(stmt):
        reg(m.group(1), m.group(2))
    # 구식 콤마 조인: FROM a A, b B
    for fm in _FROMCLAUSE.finditer(stmt):
        for part in fm.group(1).split(','):
            toks = [t for t in re.split(r'\s+', part.strip()) if t]
            if not toks:
                continue
            tbl = toks[0]
            alias = toks[1] if len(toks) > 1 and toks[1].upper() != 'AS' else (
                toks[2] if len(toks) > 2 else None)
            reg(tbl, alias)
    return amap


def scan_text(text, is_xml, joins, filters):
    for stmt in _statements(text, is_xml):
        amap = _alias_map(stmt)
        if not amap:
            continue
        # 조인쌍
        for m in _EQJOIN.finditer(stmt):
            al, cl, ar, cr = m.group(1).lower(), m.group(2).upper(), m.group(3).lower(), m.group(4).upper()
            ta, tb = amap.get(al), amap.get(ar)
            if not ta or not tb or ta == tb:
                continue
            # 정규화: (table,col) 쌍을 정렬해 무방향 중복 제거
            a, b = (ta, cl), (tb, cr)
            if a > b:
                a, b = b, a
            key = (a[0], a[1], b[0], b[1])
            joins[key] = joins.get(key, 0) + 1
        # 상시 필터(soft-delete/테넌트만 채택)
        for m in _PRED.finditer(stmt):
            al, col, op, val = m.group(1).lower(), m.group(2).upper(), m.group(3).upper(), m.group(4)
            tbl = amap.get(al)
            if not tbl:
                continue
            if not (_SOFTDEL.search(col) or _FLAGSUF.search(col) or _TENANT.search(col)):
                continue
            val = re.sub(r'\s+', '', val)[:40]
            key = (tbl, col, op, val)
            filters[key] = filters.get(key, 0) + 1


def scan_paths(paths, out_path):
    files = []
    for p in paths:
        if os.path.isdir(p):
            for ext in ('*.xml', '*.sql'):
                files += glob.glob(os.path.join(p, '**', ext), recursive=True)
        elif os.path.isfile(p):
            files.append(p)
    joins, filters = {}, {}
    join_src, filter_src = {}, {}
    for fp in files:
        low = fp.lower()
        if any(s in low.replace('\\', '/') for s in ('/_tmp/', '/docs/', '/node_modules/', '/.git/')):
            continue
        try:
            txt = open(fp, encoding='utf-8', errors='ignore').read()
        except OSError:
            continue
        if not re.search(r'\b(SELECT|FROM|JOIN)\b', txt, re.IGNORECASE):
            continue
        bj, bf = dict(joins), dict(filters)
        scan_text(txt, low.endswith('.xml'), joins, filters)
        base = os.path.basename(fp)
        for k in joins:
            if joins[k] != bj.get(k, 0):
                join_src.setdefault(k, set()).add(base)
        for k in filters:
            if filters[k] != bf.get(k, 0):
                filter_src.setdefault(k, set()).add(base)

    out = {
        'joins': [
            {'table_a': k[0], 'col_a': k[1], 'table_b': k[2], 'col_b': k[3],
             'freq': v, 'sources': sorted(join_src.get(k, set()))[:5]}
            for k, v in sorted(joins.items(), key=lambda x: -x[1])
        ],
        'filters': [
            {'table': k[0], 'col': k[1], 'op': k[2], 'value': k[3],
             'freq': v, 'sources': sorted(filter_src.get(k, set()))[:5]}
            for k, v in sorted(filters.items(), key=lambda x: (-x[1], x[0]))
        ],
    }
    os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
    json.dump(out, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    return len(out['joins']), len(out['filters'])


def main():
    argv = sys.argv[1:]
    out = 'docs/05_설계서/_machine/query_patterns.json'
    if '--out' in argv:
        i = argv.index('--out'); out = argv[i + 1]; argv = argv[:i] + argv[i + 2:]
    paths = [a for a in argv if not a.startswith('--')] or ['.']
    nj, nf = scan_paths(paths, out)
    print(f'관찰 조인쌍 {nj}개 / 상시필터 {nf}개 → {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
