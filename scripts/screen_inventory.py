#!/usr/bin/env python3
"""
screen_inventory.py
knowledge-graph의 node type 기반으로 화면(page) 인벤토리 생성.
type="page" 노드를 1차 기준, import 엣지로 참조 컴포넌트를 추적한다.
Spring MVC @Controller + JSP 패턴도 지원한다.

Usage: python3 screen_inventory.py <workspace_dir> [kg_path]
  workspace_dir : project.env / docs/ 가 있는 디렉토리 (Claude 실행 위치)
  kg_path       : knowledge-graph 절대경로 (생략 시 자동 탐지)
Output: _tmp/screen_inventory.json 에 저장 + 요약 stdout
"""

import json, os, sys, collections, re
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

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

kg_path        = resolve_kg_path(kg_path_arg, workspace_dir)
plan_path      = os.path.join(workspace_dir, 'docs/05_설계서/_domain_plan.json')
confirmed_path = os.path.join(workspace_dir, '.speclinker', 'screen_plan.confirmed.json')

# ── Phase 7 패스: confirmed.json → screen_inventory 변환 ──────────────────────
def _convert_confirmed(confirmed_doc, plan_doc, wdir):
    domains = plan_doc.get('domains', [])
    uis_ctr = {d['name']: d['uis']['start'] for d in domains}

    def _n(p): return p.replace('\\', '/')
    def _abs(rel): return os.path.join(wdir, rel) if rel else ''

    def _assign(entry, route, hint=''):
        if hint:
            for d in domains:
                if d['name'].lower() == hint.lower():
                    return d['name']
        np = _n(entry)
        for d in domains:
            if any(np.startswith(_n(r).rstrip('/')) for r in d.get('rootPaths', [])):
                return d['name']
        if route:
            seg0 = next((s.lower() for s in route.lstrip('/').split('/') if s), '')
            for d in domains:
                dn = d['name'].lower()
                if dn == seg0 or seg0 in dn or dn in seg0:
                    return d['name']
        for d in domains:
            if d['name'].lower() in np.lower():
                return d['name']
        return domains[0]['name'] if domains else ''

    out = []
    seen = set()
    for scr in confirmed_doc.get('screens', []):
        entry_rel = scr.get('entry', '') or scr.get('entry_file', '')
        if not entry_rel:
            continue
        entry_abs = _abs(entry_rel)
        key = _n(entry_abs)
        if key in seen:
            continue
        seen.add(key)

        route  = scr.get('route', '')
        domain = _assign(entry_abs, route, scr.get('domain', ''))
        if domain not in uis_ctr:
            continue

        # confirmed.json에 uisId가 있으면 우선 사용 (숫자 또는 "UIS-F-NNN" 형식 모두 지원)
        raw_uis = scr.get('uisId') or scr.get('uis_id') or scr.get('UIS_ID')
        if raw_uis is not None:
            if isinstance(raw_uis, int):
                uis_id = raw_uis
            else:
                m = re.search(r'(\d+)', str(raw_uis))
                uis_id = int(m.group(1)) if m else uis_ctr[domain]
        else:
            uis_id = uis_ctr[domain]
            uis_ctr[domain] += 1

        # screenId: confirmed.json의 screen_id / screenId 우선
        screen_id = (scr.get('screenId') or scr.get('screen_id') or
                     os.path.splitext(os.path.basename(entry_abs))[0])
        # PascalCase 보정 (pr201Form → Pr201Form)
        if screen_id and screen_id[0].islower():
            screen_id = screen_id[0].upper() + screen_id[1:]

        # screenName: confirmed.json의 screenName 또는 screen_id
        screen_name = scr.get('screenName') or scr.get('screen_name') or screen_id

        item = {
            'route':          route,
            'domain':         domain,
            'entryFile':      entry_abs,
            'componentFiles': [_abs(c) for c in scr.get('component_files', []) if c],
            'uisId':          uis_id,
            'screenId':       screen_id,
            'screenName':     screen_name,
            'infDir':         '../../INF/',
            'source':         scr.get('source', 'confirmed'),
        }
        # BFS 메뉴 경로 메타 보존 (build_capture_plan.py에서 menu-click preActions 생성에 사용)
        meta = scr.get('metadata', {})
        if meta.get('menu_l1') or meta.get('menu_l2'):
            item['menuMeta'] = {'menu_l1': meta.get('menu_l1', ''), 'menu_l2': meta.get('menu_l2', '')}
        out.append(item)
    return out

if os.path.exists(confirmed_path):
    if not os.path.exists(plan_path):
        print(f'[ERROR] _domain_plan.json 없음: {plan_path}', file=sys.stderr)
        sys.exit(1)
    confirmed_doc = json.load(open(confirmed_path, encoding='utf-8'))
    plan_doc      = json.load(open(plan_path, encoding='utf-8'))
    result = _convert_confirmed(confirmed_doc, plan_doc, workspace_dir)
    out_path = os.path.join(workspace_dir, '_tmp', 'screen_inventory.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    sources = {}
    for r in result:
        sources.setdefault(r['source'], 0)
        sources[r['source']] += 1
    print(f'[screen_inventory] screen_plan.confirmed.json 사용 (Phase 7 패스)')
    print(f'감지 화면: {len(result)}개')
    print(f'탐지 방식: {dict(sources)}')
    for r in result[:5]:
        nf = len(r.get('componentFiles', []))
        print(f'  {r["route"]:40} → {os.path.basename(r["entryFile"])} (+참조 {nf}개)')
    if len(result) > 5:
        print(f'  ... 외 {len(result)-5}개')
    print(f'저장: {out_path}')
    sys.exit(0)

# ── KG 패스 (confirmed.json 없을 때 fallback) ─────────────────────────────────
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

# ── Spring MVC 유틸리티 ───────────────────────────────────────────────────────

def _get_source_roots(wdir):
    """project.env의 SOURCE_N_PATH 목록 반환"""
    roots = []
    try:
        env = dict(l.strip().split('=', 1) for l in open(os.path.join(wdir, 'project.env'), encoding='utf-8')
                   if '=' in l and not l.startswith('#'))
        for i in range(1, int(env.get('SOURCE_COUNT', 1)) + 1):
            p = env.get(f'SOURCE_{i}_PATH', '')
            if p and os.path.isdir(p):
                roots.append(p)
    except Exception:
        pass
    return roots or [wdir]


def _find_jsp_root(src_roots):
    """WEB-INF/jsp 디렉토리 탐색"""
    SKIP_DIRS = {'node_modules', '.git', 'target', 'build', 'test', 'sample'}
    for src_root in src_roots:
        for root, dirs, _ in os.walk(src_root):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            if os.path.basename(root) == 'jsp' and 'WEB-INF' in root.replace('\\', '/'):
                return root
    return None


def _extract_method_blocks(content):
    """컨트롤러 소스에서 (annotation_text, body_text) 쌍 추출"""
    ANNO_RE = re.compile(r'@(Request|Get|Post|Put|Delete|Patch|Head|Options)Mapping')
    results = []
    lines   = content.split('\n')
    n       = len(lines)
    i       = 0

    while i < n:
        if not ANNO_RE.search(lines[i]):
            i += 1
            continue

        # 어노테이션 수집 (괄호 균형 맞을 때까지)
        ann_lines   = []
        paren_depth = 0
        while i < n:
            ann_lines.append(lines[i])
            paren_depth += lines[i].count('(') - lines[i].count(')')
            i += 1
            if paren_depth == 0:
                break
        ann_text = '\n'.join(ann_lines)

        # public/protected/private 메서드 시그니처까지 스킵
        while i < n and not re.search(r'\b(public|protected|private)\s', lines[i]):
            i += 1

        # 메서드 바디 수집 (중괄호 추적)
        body_lines  = []
        brace_depth = 0
        started     = False
        while i < n:
            body_lines.append(lines[i])
            brace_depth += lines[i].count('{') - lines[i].count('}')
            if '{' in lines[i]:
                started = True
            if started and brace_depth == 0:
                i += 1
                break
            i += 1

        if body_lines:
            results.append((ann_text, '\n'.join(body_lines)))

    return results


def _resolve_jsp_file(full_url, view_name, method_path, jsp_root):
    """URL / view name으로 JSP 파일 경로 결정"""
    if not jsp_root:
        return None

    norm = lambda p: p.replace('\\', '/')

    # 1) explicit ModelAndView view name
    if view_name:
        c = os.path.join(jsp_root, view_name + '.jsp')
        if os.path.exists(c):
            return c

    # 2) URL 전체 경로
    url_path = full_url.lstrip('/')
    c = os.path.join(jsp_root, url_path + '.jsp')
    if os.path.exists(c):
        return c

    # 3) 파일명 검색 (메서드 매핑값만 사용)
    if method_path:
        fname = method_path.lstrip('/').split('/')[-1] + '.jsp'
        for root, dirs, files in os.walk(jsp_root):
            dirs[:] = [d for d in dirs if d not in ('node_modules',)]
            if fname in files:
                return os.path.join(root, fname)

    return None


# ── 1-D: Spring MVC @Controller + JSP 화면 탐지 ──────────────────────────────

SKIP_METHOD_RE = re.compile(
    r'method\s*=\s*RequestMethod\.(POST|PUT|DELETE|PATCH)'
    r'|@(PostMapping|PutMapping|DeleteMapping|PatchMapping)'
)
# annotation에서 JSON 응답 신호
ANNO_JSON_RE = re.compile(
    r'produces\s*=\s*["\{][^"]*application/json'
    r'|MediaType\.APPLICATION_JSON'
)
CLASS_MAPPING_RE  = re.compile(r'@RequestMapping\s*\(\s*(?:value\s*=\s*)?"(/[^"]*)"')
METHOD_MAPPING_RE = re.compile(r'@(?:Request|Get)Mapping\s*\(\s*(?:value\s*=\s*)?"([^"]+)"')
METHOD_MAPPING_BARE_RE = re.compile(r'@GetMapping\s*\(\s*\)')
VIEW_NAME_RE      = re.compile(r'new\s+ModelAndView\s*\(\s*"([^"]+)"')
RETURN_STRING_RE  = re.compile(r'return\s+"([^"]+)"')

# 메서드 바디에서 JSON 응답 신호 (jwork 전용 + 표준 Spring)
JSON_SIGNALS = (
    'MAPPING_JACKSON_JSON_VIEW', 'MappingJackson2JsonView',  # jwork/Spring JSON view
    'GridResultUtil',                                          # jwork grid
    '@ResponseBody',                                           # 표준 Spring ResponseBody
    'ResponseEntity',                                          # REST 반환 타입
    'application/json',                                        # produces
    'writeValueAsString', 'ObjectMapper',                      # 직접 JSON 직렬화
    'PrintWriter', 'response.getWriter',                       # 직접 response write
)

# 비즈니스 로직이 없는 패키지 제외
SKIP_JAVA_PKGS = ('sample', 'jwork', 'test', 'tests')

def _scan_spring_mvc(wdir):
    """Spring MVC 컨트롤러에서 화면 인벤토리 추출"""
    src_roots = _get_source_roots(wdir)
    jsp_root  = _find_jsp_root(src_roots)

    if jsp_root:
        print(f'[Spring MVC] JSP 루트: {jsp_root}')
    else:
        print('[Spring MVC] WEB-INF/jsp 디렉토리 없음 — 컨트롤러 파일을 entryFile로 사용')

    found = []

    for src_root in src_roots:
        for dirpath, dirs, filenames in os.walk(src_root):
            dirs[:] = [d for d in dirs if d not in ('node_modules', '.git', 'target', 'build')]
            # 비즈니스 외 패키지 제외 (경로 기준)
            norm_dp = dirpath.replace('\\', '/')
            if any(f'/{pkg}/' in norm_dp or norm_dp.endswith(f'/{pkg}') for pkg in SKIP_JAVA_PKGS):
                dirs[:] = []
                continue

            for fname in filenames:
                if not fname.endswith('Controller.java'):
                    continue
                fpath = os.path.join(dirpath, fname)
                try:
                    content = open(fpath, encoding='utf-8', errors='ignore').read()
                except Exception:
                    continue

                if '@Controller' not in content or '@RestController' in content:
                    continue

                # 클래스 레벨 @RequestMapping
                cm = CLASS_MAPPING_RE.search(content)
                class_path = cm.group(1).rstrip('/*') if cm else ''

                for ann_text, body_text in _extract_method_blocks(content):
                    # POST/PUT/DELETE/PATCH 메서드 스킵
                    if SKIP_METHOD_RE.search(ann_text):
                        continue

                    # annotation 레벨 JSON 신호 스킵 (produces=application/json 등)
                    if ANNO_JSON_RE.search(ann_text):
                        continue

                    # 메서드 바디 JSON 응답 신호 스킵
                    if any(sig in body_text for sig in JSON_SIGNALS):
                        continue

                    # @ResponseBody 어노테이션이 ann_text 전체 블록에 있으면 스킵
                    if '@ResponseBody' in ann_text:
                        continue

                    # 메서드 레벨 매핑 경로
                    mm = METHOD_MAPPING_RE.search(ann_text)
                    if mm:
                        method_path = mm.group(1).strip('/')
                    elif METHOD_MAPPING_BARE_RE.search(ann_text):
                        method_path = ''
                    else:
                        continue

                    # 전체 URL 조합
                    if method_path:
                        full_url = class_path.rstrip('/') + '/' + method_path.lstrip('/')
                    else:
                        full_url = class_path
                    if not full_url.startswith('/'):
                        full_url = '/' + full_url

                    # 명시적 view name 추출
                    vn_match = VIEW_NAME_RE.search(body_text)
                    explicit_view = None
                    if vn_match:
                        vn = vn_match.group(1)
                        if not any(sig in vn for sig in JSON_SIGNALS):
                            explicit_view = vn

                    # JSP 파일 결정
                    jsp_file = _resolve_jsp_file(full_url, explicit_view, method_path, jsp_root)
                    entry_file = jsp_file if jsp_file else fpath

                    found.append({
                        'route':          full_url,
                        'entryFile':      entry_file,
                        'source':         'spring-mvc:controller',
                        'controllerFile': fpath,
                    })

    print(f'[Spring MVC] 화면 감지: {len(found)}개')
    return found

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

    # 1-D: Spring MVC @Controller + JSP (graph 탐지 실패 시)
    if not routes:
        spring_routes = _scan_spring_mvc(workspace_dir)
        routes.extend(spring_routes)

    # JSP fallback (Spring MVC도 없을 때)
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

# knowledge graph에서 Spring MVC 컨트롤러가 탐지된 경우에도 보완 실행
# (graph가 controller를 router/entrypoint로 잡았지만 JSP 매핑이 누락된 경우)
if routes and all(r.get('source', '').startswith('graph:') for r in routes):
    spring_routes = _scan_spring_mvc(workspace_dir)
    if spring_routes:
        existing_urls = {r['route'] for r in routes}
        for sr in spring_routes:
            if sr['route'] not in existing_urls:
                routes.append(sr)

# ── 2. import BFS 추적 (2단계) ────────────────────────────────────────────────
def trace_imports(entry_file, depth=2, extra_files=None):
    visited = {entry_file}
    if extra_files:
        visited.update(extra_files)
    queue = [entry_file]
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

def assign_domain(entry_file, route=''):
    np = norm_path(entry_file)
    # rootPaths 직접 매핑
    for d in plan['domains']:
        if any(np.startswith(norm_path(r).rstrip('/')) for r in d.get('rootPaths', [])):
            return d['name']
    # URL 세그먼트로 도메인 추측 (Spring MVC: /order/... → order)
    if route:
        segments = [s for s in route.lstrip('/').split('/') if s]
        if segments:
            seg0 = segments[0].lower()
            for d in plan['domains']:
                if d['name'].lower() == seg0 or seg0 in d['name'].lower() or d['name'].lower() in seg0:
                    return d['name']
    # 파일 경로 내 도메인명 매칭
    np_lower = np.lower()
    for d in plan['domains']:
        if d['name'].lower() in np_lower:
            return d['name']
    return plan['domains'][0]['name']  # fallback

result = []
seen   = set()

for r in routes:
    key = norm_path(r['entryFile'])
    if key in seen:
        continue
    seen.add(key)

    domain = assign_domain(r['entryFile'], r.get('route', ''))
    if uis_counter.get(domain) is None:
        continue
    uis_id = uis_counter[domain]
    uis_counter[domain] += 1

    # Spring MVC: controller 파일을 componentFiles에 포함
    extra = []
    if r.get('source', '').startswith('spring-mvc') and r.get('controllerFile'):
        ctrl = r['controllerFile']
        if ctrl != r['entryFile']:
            extra = [ctrl]

    result.append({
        'route':          r['route'],
        'domain':         domain,
        'entryFile':      r['entryFile'],
        'componentFiles': trace_imports(r['entryFile'], extra_files=extra) + [f for f in extra if f not in trace_imports(r['entryFile'])],
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
    print(f'  {r["route"]:40} → {os.path.basename(r["entryFile"])} (+참조 {nf}개)')
if len(result) > 5:
    print(f'  ... 외 {len(result)-5}개')
print(f'저장: {out_path}')
