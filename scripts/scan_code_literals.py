# STATUS: 완료
#!/usr/bin/env python3
"""
scan_code_literals.py — 쿼리 코드값 리터럴 + 공통코드 그룹신호 추출 (zero-LLM, 4-2)

소스 SQL에서:
  1) 코드 리터럴: 코드성 컬럼(_CD/_TP/_STS/_YN/_GB/_FL/_DIV) = 'literal' / IN ('a','b')
  2) 컬럼→그룹 매핑(소스 정적): JT_CODE WHERE CODE_GRP_ID='X' AND CODE=t.COL 패턴
의미 해소(DB/MCP 조회)는 ddd-db-agent enrichment가 수행 — 본 스크립트는 스캔까지.

Usage:
  python scan_code_literals.py <paths...> [--out _tmp/code_literals.json]
출력: [{column, values:[], group?(소스서 복원), files:[]}]
"""
import os, sys, re, json, glob

CODE_SUF = r'(?:_CD|_TP|_STS|_YN|_GB|_FL|_DIV)'
_EQ = re.compile(rf"(\w*{CODE_SUF})\s*(?:=|<>|!=|<=>)\s*'([^']{{1,16}})'", re.IGNORECASE)
_IN = re.compile(rf"(\w*{CODE_SUF})\s+IN\s*\(([^)]+)\)", re.IGNORECASE)
_LIT = re.compile(r"'([^']{1,16})'")
# 컬럼→그룹: JT_CODE(또는 *CODE*) WHERE CODE_GRP_ID='X' AND CODE = t.COL  (순서 양방향)
_GRP1 = re.compile(r"CODE_GRP_ID\s*=\s*'([^']+)'[^;]{0,200}?CODE\s*=\s*(?:\w+\.)?(\w+)", re.IGNORECASE)
_GRP2 = re.compile(r"CODE\s*=\s*(?:\w+\.)?(\w+)[^;]{0,200}?CODE_GRP_ID\s*=\s*'([^']+)'", re.IGNORECASE)

def scan_sql(text):
    cols = {}  # column -> {values:set, group}
    def slot(c):
        return cols.setdefault(c.upper(), {'column': c.upper(), 'values': set(), 'group': None})
    for m in _EQ.finditer(text or ''):
        slot(m.group(1))['values'].add(m.group(2))
    for m in _IN.finditer(text or ''):
        s = slot(m.group(1))
        for lm in _LIT.finditer(m.group(2)):
            s['values'].add(lm.group(1))
    # 그룹신호(소스 정적)
    for m in _GRP1.finditer(text or ''):
        grp, col = m.group(1), m.group(2)
        if col.upper() in cols or col.upper().endswith(('CD', 'TP', 'STS', 'YN')):
            slot(col)['group'] = grp
    for m in _GRP2.finditer(text or ''):
        col, grp = m.group(1), m.group(2)
        if col.upper() in cols or col.upper().endswith(('CD', 'TP', 'STS', 'YN')):
            slot(col)['group'] = grp
    out = []
    for c in cols.values():
        out.append({'column': c['column'], 'values': sorted(c['values']), 'group': c['group']})
    return out

def scan_paths(paths, out_path):
    agg = {}  # column -> {values:set, group, files:set}
    files = []
    for p in paths:
        if os.path.isdir(p):
            files += glob.glob(os.path.join(p, '**', '*.xml'), recursive=True)
            files += glob.glob(os.path.join(p, '**', '*.sql'), recursive=True)
        elif os.path.isfile(p):
            files.append(p)
    for fp in files:
        try:
            txt = open(fp, encoding='utf-8', errors='ignore').read()
        except OSError:
            continue
        for lit in scan_sql(txt):
            a = agg.setdefault(lit['column'], {'values': set(), 'group': None, 'files': set()})
            a['values'].update(lit['values'])
            if lit['group']:
                a['group'] = lit['group']
            a['files'].add(os.path.basename(fp))
    result = [{'column': c, 'values': sorted(v['values']), 'group': v['group'],
               'files': sorted(v['files'])[:5]}
              for c, v in sorted(agg.items()) if v['values']]
    os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
    json.dump(result, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    return len(result)

def main():
    argv = sys.argv[1:]
    out = '_tmp/code_literals.json'
    if '--out' in argv:
        i = argv.index('--out'); out = argv[i + 1]; argv = argv[:i] + argv[i + 2:]
    paths = [a for a in argv if not a.startswith('--')] or ['.']
    n = scan_paths(paths, out)
    print(f'코드 리터럴 컬럼 {n}개 → {out}')
    # 그룹 복원율 요약
    data = json.load(open(out, encoding='utf-8'))
    grouped = sum(1 for d in data if d['group'])
    print(f'  소스서 그룹 복원: {grouped}/{n}  (나머지는 DB probe-match/enrichment 대상)')
    return 0

if __name__ == '__main__':
    sys.exit(main())
