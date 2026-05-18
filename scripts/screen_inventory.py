#!/usr/bin/env python3
"""
screen_inventory.py
knowledge-graph의 node type 기반으로 화면(page) 인벤토리 생성.
type="page" 노드를 1차 기준, import 엣지로 참조 컴포넌트를 추적한다.

Usage: python3 screen_inventory.py <workspace_dir> [kg_path]
  workspace_dir : project.env / docs/ 가 있는 디렉토리 (Claude 실행 위치)
  kg_path       : knowledge-graph 절대경로 (생략 시 자동 탐지)
Output: _tmp/screen_inventory.json 에 저장 + 요약 stdout
"""

import json, os, sys, collections

# ── 인자 처리 ─────────────────────────────────────────────────────────────────
workspace_dir = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.getcwd()
kg_path_arg   = sys.argv[2] if len(sys.argv) > 2 else None

os.makedirs(os.path.join(workspace_dir, '_tmp'), exist_ok=True)

# ── 그래프 경로 결정 ──────────────────────────────────────────────────────────
def resolve_kg_path(arg, wdir):
    if arg and os.path.exists(arg):
        return arg
    UI_KW = ('web', 'frontend', 'ui', 'client', 'front', 'react', 'vue', 'next', 'nuxt')
    try:
        env_path = os.path.join(wdir, 'project.env')
        env = dict(l.strip().split('=', 1) for l in open(env_path, encoding='utf-8')
                   if '=' in l and not l.startswith('#'))
        count = int(env.get('SOURCE_COUNT', 1))
        for i in range(1, count + 1):
            lbl = env.get(f'SOURCE_{i}_LABEL', '').lower()
            if any(k in lbl for k in UI_KW):
                c = os.path.join(wdir, f'.understand-anything/knowledge-graph-{lbl}.json')
                if os.path.exists(c):
                    return c
    except Exception:
        pass
    return os.path.join(wdir, '.understand-anything/knowledge-graph.json')

kg_path   = resolve_kg_path(kg_path_arg, workspace_dir)
plan_path = os.path.join(workspace_dir, 'docs/05_설계서/_domain_plan.json')

if not os.path.exists(kg_path):
    print(f'[ERROR] knowledge-graph 없음: {kg_path}', file=sys.stderr)
    sys.exit(1)
if not os.path.exists(plan_path):
    print(f'[ERROR] _domain_plan.json 없음: {plan_path}', file=sys.stderr)
    sys.exit(1)

kg   = json.load(open(kg_path, encoding='utf-8'))
plan = json.load(open(plan_path, encoding='utf-8'))

# ── 기초 데이터 구조 ──────────────────────────────────────────────────────────
nodes_by_id = {n['id']: n for n in kg.get('nodes', [])}

IMPORT_EDGE_TYPES = {'imports', 'import', 'uses', 'references', 'depends_on', 'requires', 'contains'}
imports_map = collections.defaultdict(list)
for edge in kg.get('edges', []):
    if edge.get('type', '') not in IMPORT_EDGE_TYPES:
        continue
    src = nodes_by_id.get(edge.get('source', ''), {}).get('filePath', '')
    tgt = nodes_by_id.get(edge.get('target', ''), {}).get('filePath', '')
    if src and tgt and src != tgt:
        imports_map[src].append(tgt)

EXCLUDE_IN_PATH = ('node_modules', '__tests__', '.test.', '.spec.', '.d.ts', 'dist/', 'build/')

# ── 1. graph node type 기반 화면 탐지 ─────────────────────────────────────────
PAGE_NODE_TYPES   = {'page'}
ROUTER_NODE_TYPES = {'router', 'entrypoint'}

page_nodes   = [n for n in kg.get('nodes', []) if n.get('type') in PAGE_NODE_TYPES   and n.get('filePath')]
router_nodes = [n for n in kg.get('nodes', []) if n.get('type') in ROUTER_NODE_TYPES and n.get('filePath')]

routes = []  # [{'route': str, 'entryFile': str, 'source': str}]

def extract_route(node):
    """tags에서 라우트 경로 추출, 없으면 파일명 기반"""
    for tag in node.get('tags', []):
        if tag.startswith('/') or tag.startswith('http'):
            return tag
    fname = os.path.splitext(os.path.basename(node.get('filePath', 'unknown')))[0]
    return '/' + fname

# 1-A: type=page 노드
for n in page_nodes:
    fp = n.get('filePath', '')
    if any(x in fp for x in EXCLUDE_IN_PATH):
        continue
    routes.append({'route': extract_route(n), 'entryFile': fp, 'source': 'graph:page'})

# 1-B: router 엣지로 연결된 page 탐색 (type=page 없을 때)
if not routes:
    ROUTES_EDGE_TYPES = {'routes', 'flow_step', 'triggers'}
    for edge in kg.get('edges', []):
        if edge.get('type', '') not in ROUTES_EDGE_TYPES:
            continue
        src_node = nodes_by_id.get(edge.get('source', ''), {})
        tgt_node = nodes_by_id.get(edge.get('target', ''), {})
        if src_node.get('type') not in ROUTER_NODE_TYPES:
            continue
        tgt_fp = tgt_node.get('filePath', '')
        if not tgt_fp or any(x in tgt_fp for x in EXCLUDE_IN_PATH):
            continue
        routes.append({'route': extract_route(tgt_node), 'entryFile': tgt_fp, 'source': 'graph:router-edge'})

# 1-C: 파일 패턴 fallback
if not routes:
    all_paths = [n.get('filePath', '') for n in kg.get('nodes', []) if n.get('filePath')]

    def norm(p): return p.replace('\\', '/')

    normed = [norm(p) for p in all_paths]

    # Next.js App Router
    for p, np in zip(all_paths, normed):
        if not (np.endswith('/page.tsx') or np.endswith('/page.jsx')):
            continue
        parts = np.split('/app/', 1)
        if len(parts) < 2:
            continue
        route_parts = [r for r in parts[1].split('/')[:-1] if not (r.startswith('(') and r.endswith(')'))]
        routes.append({'route': '/' + '/'.join(route_parts) if route_parts else '/', 'entryFile': p, 'source': 'fallback:nextjs-app'})

    # Next.js Pages Router
    if not routes:
        for p, np in zip(all_paths, normed):
            if '/pages/' not in np or not np.endswith(('.tsx', '.jsx', '.ts', '.js')):
                continue
            fname = os.path.basename(np)
            if fname.startswith('_') or '/api/' in np:
                continue
            rel = np.split('/pages/', 1)[1]
            route_path = os.path.splitext(rel)[0].replace('/index', '') or '/'
            if not route_path.startswith('/'):
                route_path = '/' + route_path
            routes.append({'route': route_path, 'entryFile': p, 'source': 'fallback:nextjs-pages'})

    # JSP fallback
    if not routes:
        for p, np in zip(all_paths, normed):
            if not np.endswith('.jsp') or any(x in np for x in EXCLUDE_IN_PATH):
                continue
            fname = os.path.splitext(os.path.basename(np))[0]
            routes.append({'route': '/' + fname, 'entryFile': p, 'source': 'fallback:jsp'})

    # SPA component fallback
    if not routes:
        PAGE_KW    = ('page', 'screen', 'view', 'Page', 'Screen', 'View', 'Form', 'List')
        EXCLUDE_KW = ('component', 'layout', 'common', 'shared', 'util', 'helper',
                      'template', 'modal', 'popup', 'dialog', 'index', 'App', 'main')
        COMPONENT_EXTS = ('.tsx', '.jsx', '.vue', '.ts', '.js', '.java', '.py')
        for p, np in zip(all_paths, normed):
            fname = os.path.splitext(os.path.basename(p))[0]
            if not p.endswith(COMPONENT_EXTS) or any(x in p for x in EXCLUDE_IN_PATH):
                continue
            if any(kw in fname for kw in PAGE_KW) and not any(kw in fname for kw in EXCLUDE_KW):
                route = '/' + fname.replace('Page', '').replace('Screen', '').replace('View', '')
                routes.append({'route': route, 'entryFile': p, 'source': 'fallback:spa'})

# ── 2. import BFS 추적 (2단계) ────────────────────────────────────────────────
def trace_imports(entry_file, depth=2):
    visited, queue = {entry_file}, [entry_file]
    for _ in range(depth):
        next_q = []
        for f in queue:
            for imp in imports_map.get(f, []):
                if imp not in visited and not any(x in imp for x in EXCLUDE_IN_PATH):
                    visited.add(imp)
                    next_q.append(imp)
        queue = next_q
    return sorted(f for f in visited if f != entry_file)

# ── 3. 도메인 배정 + UIS-F ID 채번 ───────────────────────────────────────────
uis_counter = {d['name']: d['uis']['start'] for d in plan['domains']}

def norm_path(p): return p.replace('\\', '/')

def assign_domain(entry_file):
    np = norm_path(entry_file)
    for d in plan['domains']:
        if any(np.startswith(norm_path(r).rstrip('/')) for r in d.get('rootPaths', [])):
            return d['name']
    # 경로 매칭 실패 시 파일 경로 일부로 재시도 (대소문자 무관)
    np_lower = np.lower()
    for d in plan['domains']:
        if d['name'].lower() in np_lower:
            return d['name']
    return plan['domains'][0]['name']  # fallback

result = []
seen = set()

for r in routes:
    key = norm_path(r['entryFile'])
    if key in seen:
        continue
    seen.add(key)

    domain = assign_domain(r['entryFile'])
    if uis_counter.get(domain) is None:
        continue
    uis_id = uis_counter[domain]
    uis_counter[domain] += 1

    result.append({
        'route':          r['route'],
        'domain':         domain,
        'entryFile':      r['entryFile'],
        'componentFiles': trace_imports(r['entryFile']),
        'uisId':          uis_id,
        'infDir':         '../../INF/',
        'source':         r.get('source', 'unknown'),
    })

# ── 4. 결과 저장 + 요약 출력 ─────────────────────────────────────────────────
out_path = os.path.join(workspace_dir, '_tmp', 'screen_inventory.json')
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

sources = {}
for r in result:
    sources.setdefault(r['source'], 0)
    sources[r['source']] += 1

print(f'감지 화면: {len(result)}개')
print(f'탐지 방식: {dict(sources)}')
for r in result[:5]:
    nf = len(r.get('componentFiles', []))
    print(f'  {r["route"]:30} → {os.path.basename(r["entryFile"])} (+참조 {nf}개)')
if len(result) > 5:
    print(f'  ... 외 {len(result)-5}개')
print(f'저장: {out_path}')
