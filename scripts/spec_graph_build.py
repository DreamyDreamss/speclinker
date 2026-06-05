# STATUS: 완료
#!/usr/bin/env python3
"""
spec_graph_build.py — INF/SCH frontmatter·근거소스 앵커에서 그래프 빌드 (zero-LLM)
spec_graph.json 없어도 docs/05_설계서에서 직접 구축.
그래프: {inf:{id:{method,path,domain,tables,anchors,file}}, sch:{id:{table,domain,inf,anchors,file}},
        table_to_inf:{table:[inf-id]}, table_to_sch:{table:[sch-id]}}
"""
import os, re, glob

def _frontmatter(text):
    if not text.startswith('---'):
        return {}, text
    end = text.find('\n---', 3)
    if end < 0:
        return {}, text
    fm_raw, body = text[3:end], text[end + 4:]
    fm, cur_list_key = {}, None
    for line in fm_raw.splitlines():
        if re.match(r'^\s+-\s+', line) and cur_list_key:
            fm[cur_list_key].append(line.strip()[2:].strip())
            continue
        m = re.match(r'^(\w[\w-]*):\s*(.*)$', line)
        if not m:
            continue
        k, v = m.group(1), m.group(2).strip()
        if v == '':
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
        # 4-1: frontmatter anchors[](full-chain) + 본문 근거소스 병합(중복 제거)
        fm_anchors = fm.get('anchors') or []
        all_anchors = list(dict.fromkeys([*fm_anchors, *_anchors(body)]))
        graph['inf'][iid] = {'method': fm.get('method'), 'path': fm.get('path'),
                             'domain': fm.get('domain'), 'tables': tables,
                             'anchors': all_anchors,
                             'file': os.path.relpath(fp, root).replace('\\', '/')}
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
                             'file': os.path.relpath(fp, root).replace('\\', '/')}
        if table:
            graph['table_to_sch'].setdefault(table, []).append(sid)
    return graph
