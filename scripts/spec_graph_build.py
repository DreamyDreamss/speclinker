# STATUS: 완료
#!/usr/bin/env python3
"""
spec_graph_build.py — INF/SCH frontmatter·근거소스 앵커에서 그래프 빌드 (zero-LLM)
spec_graph.json 없어도 docs/05_설계서에서 직접 구축.
그래프: {inf:{id:{method,path,domain,tables,anchors,file}}, sch:{id:{table,domain,inf,anchors,file}},
        table_to_inf:{table:[inf-id]}, table_to_sch:{table:[sch-id]}}
"""
import os, re, glob, json

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

    # ---- UIS (화면 설계서) — 한글 frontmatter + 본문 INF 참조 + screen_inventory 소스앵커 ----
    graph['uis'] = {}
    graph['screen_to_inf'] = {}
    # screen_inventory_static.json(있으면): [{route, entryFile, domain, screenId}] → screenId/route→entryFile
    si_by_screen, si_by_route = {}, {}
    si_path = os.path.join(root, '_tmp', 'screen_inventory_static.json')
    if os.path.exists(si_path):
        try:
            for e in json.load(open(si_path, encoding='utf-8')):
                ef = e.get('entryFile')
                if not ef:
                    continue
                if e.get('screenId'):
                    si_by_screen[e['screenId']] = ef
                if e.get('route'):
                    si_by_route[e['route']] = ef
        except Exception:
            pass
    _INF_RE = re.compile(r'INF-[A-Z0-9]+-\d+')
    # path → inf-id 인덱스 (api_hints raw경로 조인용 — link_uis_inf 미실행이어도 화면→INF 연결)
    path_to_inf = {}
    for iid, n in graph['inf'].items():
        p = (n.get('path') or '').lower()
        if not p:
            continue
        path_to_inf[p] = iid
        if not p.startswith('/app/'):
            path_to_inf['/app' + p] = iid
        else:
            path_to_inf[re.sub(r'^/app(?=/)', '', p)] = iid
    def _join_hint(h):
        # "POST /product/prdreg/productList" 또는 "/product/prdreg/productList" → inf-id
        m = re.search(r'(/[A-Za-z0-9_./\-{}]+)', h or '')
        if not m:
            return None
        hp = m.group(1).split('?')[0].lower()
        return path_to_inf.get(hp) or path_to_inf.get('/app' + hp) or path_to_inf.get(re.sub(r'^/app(?=/)', '', hp))
    for fp in glob.glob(os.path.join(design, '*', '**', 'spec.md'), recursive=True):
        try:
            fm, body = _frontmatter(open(fp, encoding='utf-8').read())
        except OSError:
            continue
        uid = fm.get('UIS-ID') or fm.get('uis-id')
        if not uid:
            continue
        screen_id = fm.get('화면ID') or fm.get('screen-id') or ''
        route = fm.get('라우트') or fm.get('route') or ''
        # INF 연결: 본문 INF-ID(link_uis_inf 후) ∪ frontmatter api_hints 경로조인(미실행이어도)
        infs = set(_INF_RE.findall(body))
        for h in (fm.get('api_hints') or []):
            j = _join_hint(h)
            if j:
                infs.add(j)
        infs = sorted(infs)
        # 앵커: frontmatter anchors(view+핸들러 full-chain) ∪ screen_inventory entryFile
        anchors = list(fm.get('anchors') or [])
        ef = si_by_screen.get(screen_id) or si_by_route.get(route)
        if ef and ef.replace('\\', '/') not in anchors:
            anchors.append(ef.replace('\\', '/'))
        graph['uis'][uid] = {'screen_id': screen_id, 'screen_name': fm.get('화면명'),
                             'route': route, 'domain': fm.get('도메인'),
                             'infs': infs, 'anchors': anchors,
                             'file': os.path.relpath(fp, root).replace('\\', '/')}
        if infs:
            graph['screen_to_inf'].setdefault(uid, []).extend(infs)
    return graph
