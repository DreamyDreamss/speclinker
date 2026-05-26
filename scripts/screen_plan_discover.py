#!/usr/bin/env python3
"""
screen_plan_discover.py — Phase 7.1 (Screen-first RECON)
정적 화면 발견기. LLM 없음, 파일시스템만 분석.
profile.yaml의 frontend.framework로 분기, null이면 전체 분석기 시도 후 max 선택.

Usage:
  python3 screen_plan_discover.py <workspace_dir> [--profile <path>]

Output:
  _tmp/screen_plan_static.json  (screen_plan_schema.yaml 형식 호환)
"""

import sys
import os
import re
import json
import argparse
from datetime import datetime, timezone

# ── 상수 ─────────────────────────────────────────────────────────────────────
SKIP_DIRS  = frozenset({'node_modules', '.git', 'target', 'build', 'dist', '__pycache__',
                        '.next', '.nuxt', '.svelte-kit', 'coverage', '.cache', 'out',
                        '.turbo', '.vercel', 'storybook-static', '.storybook'})
SKIP_SEGS  = ('node_modules/', '.git/', '/__tests__/', '/.test.', '/.spec.',
              '/.d.ts', '/dist/', '/build/', '.test.', '.spec.')
COMP_EXTS  = ('.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte')

PAGE_KW    = ('Page', 'Screen', 'View', 'Form', 'List', 'Detail', 'Edit', 'Create',
              'Register', 'Manage', 'Mng', 'Add', 'Update')
NON_PAGE_KW = ('Component', 'Layout', 'Header', 'Footer', 'Sidebar', 'Nav', 'Breadcrumb',
               'Modal', 'Dialog', 'Popup', 'Toast', 'Drawer', 'Loading', 'Skeleton',
               'Spinner', 'Icon', 'Button', 'Input', 'Field', 'Table', 'Card', 'Badge',
               'common', 'shared', 'util', 'helper', 'hook', 'store', 'context',
               'provider', 'service', 'api', 'types', 'const', 'config', 'mixin',
               'directive', 'filter', 'composable', 'index')

# ── 공통 유틸리티 ──────────────────────────────────────────────────────────────

def norm(p):
    return p.replace('\\', '/')


def relpath(abs_path, base):
    try:
        return norm(os.path.relpath(abs_path, base))
    except ValueError:
        return norm(abs_path)


def is_skip(path):
    np = norm(path)
    return any(x in np for x in SKIP_SEGS)


def infer_name(route, entry=''):
    """라우트 / 파일명에서 사람 친화 화면명 추론"""
    if entry:
        fname = os.path.splitext(os.path.basename(entry))[0]
        for kw in PAGE_KW:
            if fname.endswith(kw) and fname != kw:
                fname = fname[:-len(kw)]
        name = re.sub(r'([a-z])([A-Z])', r'\1 \2', fname)
        if name and name not in ('index', 'page', 'app', 'main', 'App', 'Index'):
            return name
    if route and route != '/':
        segs = [s for s in route.split('/') if s
                and not s.startswith(':') and not s.startswith('[')]
        if segs:
            return segs[-1].replace('-', ' ').replace('_', ' ').title()
    return route or 'Unknown'


def make_screen(route, entry, component_files, source, framework_hint, metadata=None):
    return {
        "id": "",
        "route": route,
        "name": infer_name(route, entry),
        "entry": entry,
        "component_files": component_files,
        "domain": "",
        "source": source,
        "framework_hint": framework_hint,
        "status": "pending",
        "layout_role": "master",
        "parent_screen": None,
        "tabs": [],
        "capture": {
            "preview_status": "none",
            "cdp_required": False,
            "route_keyword": "",
        },
        "metadata": metadata or {},
    }


def trace_imports_bfs(entry_abs, workspace, depth=2):
    """entry 파일에서 BFS 2단계 import 추적 (정규식, 상대경로만)"""
    IMPORT_RE = re.compile(
        r'''(?:import\s+(?:[^'"]*?\s+from\s+)?|require\s*\()\s*['"]([^'"]+)['"]'''
    )
    visited   = {norm(entry_abs)}
    result    = []
    queue     = [entry_abs]

    for _ in range(depth):
        next_q = []
        for f in queue:
            try:
                content = open(f, encoding='utf-8', errors='ignore').read()
            except Exception:
                continue
            fdir = os.path.dirname(f)
            for m in IMPORT_RE.finditer(content):
                raw = m.group(1)
                if not raw.startswith('.'):
                    continue
                cand = os.path.normpath(os.path.join(fdir, raw))
                if os.path.isdir(cand):
                    # 디렉토리 → index.* 탐색
                    for ext in COMP_EXTS:
                        c = os.path.join(cand, 'index' + ext)
                        if os.path.exists(c):
                            cand = c
                            break
                elif not os.path.exists(cand):
                    resolved = False
                    for ext in COMP_EXTS:
                        c = cand + ext
                        if os.path.exists(c):
                            cand = c
                            resolved = True
                            break
                    if not resolved:
                        for ext in COMP_EXTS:
                            c = os.path.join(cand, 'index' + ext)
                            if os.path.exists(c):
                                cand = c
                                break
                if not os.path.isfile(cand) or is_skip(cand):
                    continue
                nkey = norm(cand)
                if nkey not in visited:
                    visited.add(nkey)
                    result.append(relpath(cand, workspace))
                    next_q.append(cand)
        queue = next_q

    return result


# ── Framework 자동 감지 ────────────────────────────────────────────────────────

def _detect_framework_from_fs(workspace):
    """파일시스템 신호로 framework 추정 (profile 없을 때 fallback)"""
    # config 파일 우선
    for fname, fw in (
        ('next.config.js', 'next'), ('next.config.ts', 'next'), ('next.config.mjs', 'next'),
        ('nuxt.config.js', 'nuxt'), ('nuxt.config.ts', 'nuxt'),
        ('angular.json', 'angular'),
    ):
        if os.path.exists(os.path.join(workspace, fname)):
            return fw
    # 특징 파일
    if os.path.exists(os.path.join(workspace, 'src', 'app.module.ts')):
        return 'angular'
    # package.json deps
    pkg = os.path.join(workspace, 'package.json')
    if os.path.exists(pkg):
        try:
            pj = json.load(open(pkg, encoding='utf-8'))
            deps = {}
            deps.update(pj.get('dependencies', {}))
            deps.update(pj.get('devDependencies', {}))
            if 'next' in deps:            return 'next'
            if '@angular/core' in deps:   return 'angular'
            if 'nuxt' in deps:            return 'nuxt'
            if 'react-router-dom' in deps or 'react-router' in deps:
                return 'react'
            if 'vue-router' in deps:      return 'vue'
            if '@sveltejs/kit' in deps:   return 'svelte'
        except Exception:
            pass
    # Java/Spring 신호
    for fname in ('pom.xml', 'build.gradle', 'build.gradle.kts'):
        fp = os.path.join(workspace, fname)
        if os.path.exists(fp):
            try:
                c = open(fp, encoding='utf-8', errors='ignore').read()
                if 'spring' in c.lower():
                    return 'spring-mvc'
            except Exception:
                pass
    return None


# ── 1. Next.js (App Router + Pages Router) ────────────────────────────────────

def _discover_next_pages(workspace, source_roots):
    screens = []

    for src_root in source_roots:
        # App Router
        for app_candidate in ('app', 'src/app'):
            app_dir = os.path.join(src_root, app_candidate)
            if not os.path.isdir(app_dir):
                continue
            for dirpath, dirs, filenames in os.walk(app_dir):
                dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
                for fname in filenames:
                    if fname not in ('page.tsx', 'page.jsx', 'page.ts', 'page.js'):
                        continue
                    fpath = os.path.join(dirpath, fname)
                    if is_skip(fpath):
                        continue
                    rel_dir = norm(os.path.relpath(dirpath, app_dir))
                    parts = [p for p in rel_dir.split('/')
                             if p != '.' and not (p.startswith('(') and p.endswith(')'))]
                    route = ('/' + '/'.join(parts)) if parts else '/'
                    screens.append(make_screen(
                        route=route,
                        entry=relpath(fpath, workspace),
                        component_files=trace_imports_bfs(fpath, workspace),
                        source='file-based',
                        framework_hint='next-app-router',
                    ))
            if screens:
                return screens

        # Pages Router
        for pages_candidate in ('pages', 'src/pages'):
            pages_dir = os.path.join(src_root, pages_candidate)
            if not os.path.isdir(pages_dir):
                continue
            for dirpath, dirs, filenames in os.walk(pages_dir):
                dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
                for fname in filenames:
                    if not any(fname.endswith(ext) for ext in ('.tsx', '.jsx', '.ts', '.js')):
                        continue
                    if fname.startswith('_') or fname.startswith('.'):
                        continue
                    fpath = os.path.join(dirpath, fname)
                    if '/api/' in norm(fpath) or is_skip(fpath):
                        continue
                    rel = norm(os.path.relpath(fpath, pages_dir))
                    route_path = os.path.splitext(rel)[0]
                    route_path = re.sub(r'/index$', '', route_path) or '/'
                    if not route_path.startswith('/'):
                        route_path = '/' + route_path
                    screens.append(make_screen(
                        route=route_path,
                        entry=relpath(fpath, workspace),
                        component_files=trace_imports_bfs(fpath, workspace),
                        source='file-based',
                        framework_hint='next-pages-router',
                    ))
            if screens:
                return screens

    return screens


# ── 2. React Router ───────────────────────────────────────────────────────────

def _find_react_router_files(src_root):
    candidates = [
        'src/App.tsx', 'src/App.jsx', 'src/App.ts', 'src/App.js',
        'src/router.tsx', 'src/router.jsx', 'src/router.ts', 'src/router.js',
        'src/routes.tsx', 'src/routes.jsx', 'src/routes.ts', 'src/routes.js',
        'src/router/index.tsx', 'src/router/index.jsx',
        'src/router/index.ts', 'src/router/index.js',
        'src/routes/index.tsx', 'src/routes/index.jsx',
        'src/routes/index.ts', 'src/routes/index.js',
        'App.tsx', 'App.jsx', 'router.tsx', 'router.jsx',
    ]
    found = []
    for c in candidates:
        fp = os.path.join(src_root, c)
        if os.path.exists(fp):
            found.append(fp)
    # router 디렉토리 추가 탐색
    for sub in ('src/router', 'router', 'src/routes', 'routes'):
        d = os.path.join(src_root, sub)
        if os.path.isdir(d):
            for fn in os.listdir(d):
                fp = os.path.join(d, fn)
                if fp not in found and any(fn.endswith(ext) for ext in COMP_EXTS):
                    found.append(fp)
    return found


def _resolve_import_path(raw, from_file, workspace):
    """from_file 기준 상대경로 raw를 절대경로로 변환, 없으면 ''"""
    if not raw.startswith('.'):
        return ''
    base = os.path.dirname(from_file)
    cand = os.path.normpath(os.path.join(base, raw))
    if os.path.exists(cand):
        return relpath(cand, workspace)
    for ext in COMP_EXTS:
        c = cand + ext
        if os.path.exists(c):
            return relpath(c, workspace)
    for ext in COMP_EXTS:
        c = os.path.join(cand, 'index' + ext)
        if os.path.exists(c):
            return relpath(c, workspace)
    return ''


def _comp_to_entry(comp_name, router_file, workspace):
    """컴포넌트명으로 import 문 추적 → 상대경로 반환"""
    try:
        content = open(router_file, encoding='utf-8', errors='ignore').read()
    except Exception:
        return ''
    # import DefaultName from '...' or import { Name } from '...'
    patterns = [
        rf'import\s+{re.escape(comp_name)}\s+from\s+[\'"]([^\'"]+)[\'"]',
        rf'import\s+\{{[^}}]*{re.escape(comp_name)}[^}}]*\}}\s+from\s+[\'"]([^\'"]+)[\'"]',
    ]
    for pat in patterns:
        m = re.search(pat, content)
        if m:
            return _resolve_import_path(m.group(1), router_file, workspace)
    return ''


def _discover_react_router(workspace, source_roots):
    screens = []
    seen_routes = set()

    RR_SIGNALS = (
        'createBrowserRouter', 'createHashRouter', 'createMemoryRouter',
        'BrowserRouter', 'HashRouter', 'Route', 'useRoutes',
        'react-router',
    )

    for src_root in source_roots:
        router_files = _find_react_router_files(src_root)

        for rf in router_files:
            try:
                content = open(rf, encoding='utf-8', errors='ignore').read()
            except Exception:
                continue
            if not any(sig in content for sig in RR_SIGNALS):
                continue

            # JSX 방식: <Route path="..." element|component={...} />
            # 단일행 패턴 (대부분의 경우)
            for m in re.finditer(
                r'<Route[^>]*\bpath\s*=\s*[{]?\s*[\'"]([^\'"]+)[\'"][^>]*>|'
                r'<Route[^>]*\bpath\s*=\s*[{]?\s*[\'"]([^\'"]+)[\'"][^/]*/\s*>',
                content
            ):
                route = m.group(1) or m.group(2) or ''
                if not route or route in seen_routes:
                    continue
                seen_routes.add(route)
                # element 컴포넌트명 추출
                ctx_start = max(0, m.start() - 20)
                ctx_end   = min(len(content), m.end() + 200)
                ctx = content[ctx_start:ctx_end]
                comp_m = re.search(r'element\s*=\s*\{?\s*<(\w+)', ctx)
                comp_name = comp_m.group(1) if comp_m else ''
                entry = _comp_to_entry(comp_name, rf, workspace) if comp_name else ''
                comp_files = []
                if entry:
                    abs_entry = os.path.join(workspace, entry.replace('/', os.sep))
                    if os.path.exists(abs_entry):
                        comp_files = trace_imports_bfs(abs_entry, workspace)
                screens.append(make_screen(
                    route=route, entry=entry, component_files=comp_files,
                    source='router-config', framework_hint='react-router',
                ))

            # Object 방식: { path: '...', element: ... }
            for m in re.finditer(r'\{\s*path\s*:\s*[\'"]([^\'"*]+)[\'"]', content):
                route = m.group(1)
                if not route or route in seen_routes:
                    continue
                seen_routes.add(route)
                # element 또는 Component 추출
                ctx = content[m.start():min(len(content), m.start() + 300)]
                comp_m = re.search(
                    r'element\s*:\s*(?:<(\w+)|React\.createElement\s*\(\s*(\w+))'
                    r'|component\s*:\s*(\w+)'
                    r'|Component\s*:\s*(\w+)',
                    ctx
                )
                comp_name = ''
                if comp_m:
                    comp_name = next((g for g in comp_m.groups() if g), '')
                entry = _comp_to_entry(comp_name, rf, workspace) if comp_name else ''
                comp_files = []
                if entry:
                    abs_entry = os.path.join(workspace, entry.replace('/', os.sep))
                    if os.path.exists(abs_entry):
                        comp_files = trace_imports_bfs(abs_entry, workspace)
                screens.append(make_screen(
                    route=route, entry=entry, component_files=comp_files,
                    source='router-config', framework_hint='react-router',
                ))

    return screens


# ── 3. Vue Router ─────────────────────────────────────────────────────────────

def _find_vue_router_files(src_root):
    candidates = [
        'src/router/index.js', 'src/router/index.ts',
        'src/router.js', 'src/router.ts',
        'router/index.js', 'router/index.ts',
        'router.js', 'router.ts',
    ]
    found = []
    for c in candidates:
        fp = os.path.join(src_root, c)
        if os.path.exists(fp):
            found.append(fp)
    # router 디렉토리 동적 탐색
    for sub in ('src/router', 'router'):
        d = os.path.join(src_root, sub)
        if os.path.isdir(d):
            for fn in os.listdir(d):
                fp = os.path.join(d, fn)
                if fp not in found and any(fn.endswith(ext) for ext in ('.js', '.ts')):
                    found.append(fp)
    return found


def _discover_vue_router(workspace, source_roots):
    screens = []
    seen_routes = set()

    for src_root in source_roots:
        router_files = _find_vue_router_files(src_root)

        for rf in router_files:
            try:
                content = open(rf, encoding='utf-8', errors='ignore').read()
            except Exception:
                continue
            if 'createRouter' not in content and 'VueRouter' not in content and 'routes' not in content:
                continue

            # 경로 + lazy import 쌍 추출
            # 패턴: { path: '/foo', component: () => import('./views/Foo.vue') }
            ROUTE_BLOCK_RE = re.compile(
                r'path\s*:\s*[\'"]([^\'"]+)[\'"]'
                r'(?:[^}]*?component\s*:\s*(?:\(\s*\)\s*=>\s*import\s*\(\s*[\'"]([^\'"]+)[\'"]\s*\)'
                r'|(?:import\s*\(\s*[\'"]([^\'"]+)[\'"]\s*\))'
                r'|(\w+)))?',
                re.DOTALL
            )
            for m in ROUTE_BLOCK_RE.finditer(content):
                path = m.group(1)
                if not path or path in seen_routes or path in ('*', ':pathMatch(.*)*'):
                    continue
                seen_routes.add(path)

                lazy1 = m.group(2)    # () => import('...')
                lazy2 = m.group(3)    # import('...')
                comp_name = m.group(4)  # 직접 컴포넌트명

                entry = ''
                if lazy1 or lazy2:
                    raw = (lazy1 or lazy2).strip()
                    entry = _resolve_import_path(raw, rf, workspace)
                elif comp_name:
                    entry = _comp_to_entry(comp_name, rf, workspace)

                comp_files = []
                if entry:
                    abs_e = os.path.join(workspace, entry.replace('/', os.sep))
                    if os.path.exists(abs_e):
                        comp_files = trace_imports_bfs(abs_e, workspace)

                screens.append(make_screen(
                    route=path, entry=entry, component_files=comp_files,
                    source='router-config', framework_hint='vue-router',
                ))

    return screens


# ── 4. Angular ────────────────────────────────────────────────────────────────

def _discover_angular(workspace, source_roots):
    screens = []
    seen_routes = set()

    for src_root in source_roots:
        for dirpath, dirs, filenames in os.walk(src_root):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for fname in filenames:
                if not (fname.endswith('-routing.module.ts')
                        or fname.endswith('app-routing.module.ts')
                        or fname.endswith('app.routes.ts')
                        or fname == 'routing.ts'):
                    continue
                fpath = os.path.join(dirpath, fname)
                try:
                    content = open(fpath, encoding='utf-8', errors='ignore').read()
                except Exception:
                    continue
                if 'Routes' not in content and 'RouterModule' not in content:
                    continue

                NG_ROUTE_RE = re.compile(
                    r'path\s*:\s*[\'"]([^\'"]+)[\'"]'
                    r'(?:[^}]*?component\s*:\s*(\w+))?',
                    re.DOTALL
                )
                for m in NG_ROUTE_RE.finditer(content):
                    path = m.group(1)
                    if not path or path in seen_routes:
                        continue
                    seen_routes.add(path)
                    route = '/' + path if not path.startswith('/') else path
                    comp_name = m.group(2) or ''
                    entry = _comp_to_entry(comp_name, fpath, workspace) if comp_name else ''
                    screens.append(make_screen(
                        route=route, entry=entry, component_files=[],
                        source='router-config', framework_hint='angular',
                    ))

    return screens


# ── 5. Spring MVC (@Controller + JSP) ─────────────────────────────────────────

SPRING_CLASS_RE  = re.compile(r'@RequestMapping\s*\(\s*(?:value\s*=\s*)?"(/[^"]*)"')
SPRING_METHOD_RE = re.compile(r'@(?:Request|Get)Mapping\s*\(\s*(?:value\s*=\s*)?"([^"]+)"')
SPRING_GET_BARE  = re.compile(r'@GetMapping\s*\(\s*\)')
SPRING_SKIP_RE   = re.compile(
    r'@(?:Post|Put|Delete|Patch)Mapping'
    r'|method\s*=\s*RequestMethod\.(?:POST|PUT|DELETE|PATCH)'
)
SPRING_JSON_ANNO = re.compile(
    r'produces\s*=\s*["\{][^"]*application/json|MediaType\.APPLICATION_JSON'
)
SPRING_JSON_BODY = (
    'MAPPING_JACKSON_JSON_VIEW', 'MappingJackson2JsonView', 'GridResultUtil',
    '@ResponseBody', 'ResponseEntity', 'writeValueAsString', 'ObjectMapper',
    'PrintWriter', 'response.getWriter',
)
SPRING_VIEW_RE   = re.compile(r'new\s+ModelAndView\s*\(\s*"([^"]+)"')


def _extract_spring_method_blocks(content):
    """컨트롤러 소스에서 (어노테이션, 바디) 쌍 추출"""
    ANNO_RE = re.compile(r'@(Request|Get|Post|Put|Delete|Patch)Mapping')
    results, lines = [], content.split('\n')
    n, i = len(lines), 0
    while i < n:
        if not ANNO_RE.search(lines[i]):
            i += 1
            continue
        ann_lines, paren_depth = [], 0
        while i < n:
            ann_lines.append(lines[i])
            paren_depth += lines[i].count('(') - lines[i].count(')')
            i += 1
            if paren_depth == 0:
                break
        ann_text = '\n'.join(ann_lines)
        while i < n and not re.search(r'\b(public|protected|private)\s', lines[i]):
            i += 1
        body_lines, brace_depth, started = [], 0, False
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
    if not jsp_root:
        return None
    if view_name:
        c = os.path.join(jsp_root, view_name + '.jsp')
        if os.path.exists(c):
            return c
    c = os.path.join(jsp_root, full_url.lstrip('/') + '.jsp')
    if os.path.exists(c):
        return c
    if method_path:
        fname = method_path.lstrip('/').split('/')[-1] + '.jsp'
        for root, dirs, files in os.walk(jsp_root):
            if fname in files:
                return os.path.join(root, fname)
    return None


def _discover_jsp_spring(workspace, source_roots):
    # JSP 루트 탐색
    jsp_root = None
    for src_root in source_roots:
        for root, dirs, _ in os.walk(src_root):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            if os.path.basename(root) == 'jsp' and 'WEB-INF' in norm(root):
                jsp_root = root
                break
        if jsp_root:
            break

    screens     = []
    seen_routes = set()
    SKIP_PKGS   = ('sample', 'jwork', 'test', 'tests')

    for src_root in source_roots:
        for dirpath, dirs, filenames in os.walk(src_root):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            norm_dp = norm(dirpath)
            if any(f'/{pkg}/' in norm_dp or norm_dp.endswith(f'/{pkg}') for pkg in SKIP_PKGS):
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

                cm = SPRING_CLASS_RE.search(content)
                class_path = cm.group(1).rstrip('/*') if cm else ''

                for ann_text, body_text in _extract_spring_method_blocks(content):
                    if SPRING_SKIP_RE.search(ann_text) or SPRING_JSON_ANNO.search(ann_text):
                        continue
                    if any(sig in body_text for sig in SPRING_JSON_BODY):
                        continue
                    if '@ResponseBody' in ann_text:
                        continue

                    mm = SPRING_METHOD_RE.search(ann_text)
                    if mm:
                        method_path = mm.group(1).strip('/')
                    elif SPRING_GET_BARE.search(ann_text):
                        method_path = ''
                    else:
                        continue

                    if method_path:
                        full_url = class_path.rstrip('/') + '/' + method_path.lstrip('/')
                    else:
                        full_url = class_path
                    if not full_url.startswith('/'):
                        full_url = '/' + full_url
                    if full_url in seen_routes:
                        continue
                    seen_routes.add(full_url)

                    vn_m = SPRING_VIEW_RE.search(body_text)
                    view_name = vn_m.group(1) if vn_m else None
                    jsp_file  = _resolve_jsp_file(full_url, view_name, method_path, jsp_root)
                    entry_abs = jsp_file if jsp_file else fpath

                    extra_files = []
                    if entry_abs != fpath:
                        extra_files = [relpath(fpath, workspace)]

                    screens.append(make_screen(
                        route=full_url,
                        entry=relpath(entry_abs, workspace),
                        component_files=extra_files,
                        source='router-config',
                        framework_hint='spring-mvc',
                        metadata={'controller_file': relpath(fpath, workspace)},
                    ))

    print(f'[Spring MVC] 화면 발견: {len(screens)}개'
          + (f' | JSP 루트: {relpath(jsp_root, workspace)}' if jsp_root else ' | JSP 없음'))
    return screens


# ── 6. 파일시스템 Fallback ────────────────────────────────────────────────────

def _discover_files(workspace, source_roots, profile_screen_roots=None):
    """pages/views/screens 디렉토리 fallback"""
    PAGE_DIRS      = ('pages', 'views', 'screens', 'routes',
                      'src/pages', 'src/views', 'src/screens', 'src/routes')
    # 이 디렉토리 이름 아래에 있으면 키워드 필터 없이 모두 허용
    TRUSTED_ROOTS  = frozenset({'pages', 'views', 'screens', 'routes'})
    screens      = []
    seen_entries = set()

    search_dirs = []
    # profile screen_slice_roots 우선
    if profile_screen_roots:
        for pat in profile_screen_roots:
            dir_part = pat.replace('/**', '').replace('/*', '')
            for src_root in source_roots:
                cand = os.path.join(src_root, dir_part)
                if os.path.isdir(cand):
                    search_dirs.append((cand, True))  # (path, trusted)
    if not search_dirs:
        for src_root in source_roots:
            for page_dir in PAGE_DIRS:
                cand = os.path.join(src_root, page_dir)
                if os.path.isdir(cand):
                    search_dirs.append((cand, True))

    for search_dir, trusted in search_dirs:
        for dirpath, dirs, filenames in os.walk(search_dir):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for fname in filenames:
                base = os.path.splitext(fname)[0]
                if not any(fname.endswith(ext) for ext in COMP_EXTS):
                    continue
                fpath = os.path.join(dirpath, fname)
                if is_skip(fpath) or norm(fpath) in seen_entries:
                    continue
                # trusted 루트(pages/views/screens)는 키워드 필터 없이 모두 허용
                if not trusted:
                    has_page = any(kw in base for kw in PAGE_KW)
                    has_non  = any(kw.lower() in base.lower() for kw in NON_PAGE_KW)
                    if has_non and not has_page:
                        continue
                seen_entries.add(norm(fpath))

                rel_from = norm(os.path.relpath(fpath, search_dir))
                route_path = '/' + os.path.splitext(rel_from)[0].replace(os.sep, '/')
                route_path = re.sub(r'/index$', '', route_path) or '/'

                screens.append(make_screen(
                    route=route_path,
                    entry=relpath(fpath, workspace),
                    component_files=trace_imports_bfs(fpath, workspace),
                    source='file-based',
                    framework_hint='files-fallback',
                ))

    return screens


# ── 전체 시도 (framework=null) ─────────────────────────────────────────────────

def _discover_all_try(workspace, source_roots, profile_screen_roots):
    candidates = [
        ('next',       lambda: _discover_next_pages(workspace, source_roots)),
        ('react',      lambda: _discover_react_router(workspace, source_roots)),
        ('vue',        lambda: _discover_vue_router(workspace, source_roots)),
        ('angular',    lambda: _discover_angular(workspace, source_roots)),
        ('spring-mvc', lambda: _discover_jsp_spring(workspace, source_roots)),
        ('files',      lambda: _discover_files(workspace, source_roots, profile_screen_roots)),
    ]
    best, best_fw = [], 'unknown'
    for fw_name, fn in candidates:
        try:
            result = fn()
            print(f'  [{fw_name}] → {len(result)}개')
            if len(result) > len(best):
                best, best_fw = result, fw_name
        except Exception as e:
            print(f'  [{fw_name}] 오류: {e}')
    return best, best_fw


# ── Profile / Probe 로드 ──────────────────────────────────────────────────────

def _load_profile(workspace, profile_path=None):
    paths = []
    if profile_path:
        paths.append(profile_path)
    paths += [
        os.path.join(workspace, '.speclinker', 'profile.yaml'),
        os.path.join(workspace, '.speclinker', 'profile.yml'),
    ]
    for p in paths:
        if not os.path.exists(p):
            continue
        try:
            import yaml
            with open(p, encoding='utf-8') as f:
                return yaml.safe_load(f) or {}
        except ImportError:
            # pyyaml 없으면 핵심 값만 정규식 추출
            try:
                content = open(p, encoding='utf-8').read()
                result = {}
                fw_m = re.search(r'^\s{0,4}framework\s*:\s*(\S+)', content, re.M)
                if fw_m:
                    result['_frontend_framework'] = fw_m.group(1).strip('"\'')
                return result
            except Exception:
                pass
        except Exception:
            pass
    return {}


def _load_probe(workspace):
    probe_path = os.path.join(workspace, '_tmp', 'probe.json')
    if os.path.exists(probe_path):
        try:
            return json.load(open(probe_path, encoding='utf-8'))
        except Exception:
            pass
    return {}


def _get_source_roots(workspace, profile):
    roots = []
    env_path = os.path.join(workspace, 'project.env')
    if os.path.exists(env_path):
        try:
            env = dict(
                line.strip().split('=', 1)
                for line in open(env_path, encoding='utf-8')
                if '=' in line and not line.strip().startswith('#')
            )
            for i in range(1, int(env.get('SOURCE_COUNT', 1)) + 1):
                p = env.get(f'SOURCE_{i}_PATH', '').strip()
                if p and os.path.isdir(p) and p not in roots:
                    roots.append(p)
        except Exception:
            pass
    if not roots:
        layout = (profile or {}).get('project_layout') or {}
        for sr in layout.get('source_roots', []):
            rp = sr.get('root', '.') if isinstance(sr, dict) else str(sr)
            ap = os.path.join(workspace, rp)
            if os.path.isdir(ap) and ap not in roots:
                roots.append(ap)
    return roots or [workspace]


def _get_frontend_profile(profile):
    """profile dict에서 frontend 섹션 안전하게 추출 (flat parse fallback 포함)"""
    if '_frontend_framework' in profile:
        return {'framework': profile['_frontend_framework'], 'discovery': {}, 'architecture': {}}
    return profile.get('frontend') or {}


# ── 메인 ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Phase 7.1 정적 화면 발견기')
    parser.add_argument('workspace_dir', nargs='?', default=os.getcwd(),
                        help='project.env / .speclinker/ 가 있는 디렉토리')
    parser.add_argument('--profile', default=None,
                        help='profile.yaml 경로 (기본: .speclinker/profile.yaml)')
    args = parser.parse_args()

    workspace = os.path.abspath(args.workspace_dir)
    os.makedirs(os.path.join(workspace, '_tmp'), exist_ok=True)

    print(f'[screen_plan_discover] workspace : {workspace}')

    profile  = _load_profile(workspace, args.profile)
    probe    = _load_probe(workspace)
    frontend = _get_frontend_profile(profile)
    backend  = (profile.get('backend') or {}) if isinstance(profile, dict) else {}

    source_roots  = _get_source_roots(workspace, profile)
    print(f'[screen_plan_discover] source_roots: {source_roots}')

    arch         = (frontend.get('architecture') or {}) if isinstance(frontend, dict) else {}
    profile_roots = (arch.get('screen_slice_roots') or []) if isinstance(arch, dict) else []

    # framework 결정
    fw = None
    if isinstance(frontend, dict):
        fw = (frontend.get('framework') or '').lower() or None
    if not fw:
        fw = ((probe.get('indicators') or {}).get('likely_frontend_framework') or '').lower() or None
    if not fw:
        fw = _detect_framework_from_fs(workspace)

    back_fw = (backend.get('framework') or '').lower() if isinstance(backend, dict) else ''
    print(f'[screen_plan_discover] framework  : {fw or "unknown → 전체 시도"}')

    screens        = []
    framework_used = fw or 'unknown'

    if fw in ('next', 'nextjs', 'next-app-router', 'next-pages-router'):
        screens = _discover_next_pages(workspace, source_roots)
        framework_used = 'next'

    elif fw in ('react', 'react-router', 'remix', 'tanstack-router'):
        screens = _discover_react_router(workspace, source_roots)
        if not screens:
            screens = _discover_files(workspace, source_roots, profile_roots)
        framework_used = 'react'

    elif fw in ('vue', 'nuxt', 'vue-router'):
        screens = _discover_vue_router(workspace, source_roots)
        if not screens:
            screens = _discover_files(workspace, source_roots, profile_roots)
        framework_used = 'vue'

    elif fw in ('angular', 'ng'):
        screens = _discover_angular(workspace, source_roots)
        framework_used = 'angular'

    elif fw in ('svelte', 'sveltekit'):
        # SvelteKit = file-based routing
        screens = _discover_files(workspace, source_roots, profile_roots)
        framework_used = 'svelte'

    elif (fw in ('spring-mvc', 'spring-boot', 'spring')
          or back_fw in ('spring-boot', 'spring-mvc', 'spring')
          or (not fw and back_fw)):
        spring = _discover_jsp_spring(workspace, source_roots)
        if spring:
            screens, framework_used = spring, 'spring-mvc'
        else:
            screens = _discover_files(workspace, source_roots, profile_roots)
            framework_used = 'files-fallback'

    else:
        print('[screen_plan_discover] framework 불명 - 전체 분석기 시도')
        screens, framework_used = _discover_all_try(workspace, source_roots, profile_roots)

    # manual_screens 추가 (profile.frontend.discovery.manual_screens)
    discovery_cfg = (frontend.get('discovery') or {}) if isinstance(frontend, dict) else {}
    manual_count  = 0
    for ms in (discovery_cfg.get('manual_screens') or []):
        route = ms.get('route', '')
        if not route:
            continue
        entry = ms.get('entry', '')
        screens.append({
            "id": "", "route": route,
            "name": ms.get('name', '') or infer_name(route, entry),
            "entry": entry, "component_files": [], "domain": "",
            "source": "manual", "framework_hint": "manual",
            "status": "pending", "layout_role": "master",
            "parent_screen": None, "tabs": [],
            "capture": {"preview_status": "none", "cdp_required": False, "route_keyword": ""},
            "metadata": {"note": ms.get('note', '')},
        })
        manual_count += 1

    # dedup (route 기준)
    seen_routes, deduped = set(), []
    for s in screens:
        if s['route'] not in seen_routes:
            seen_routes.add(s['route'])
            deduped.append(s)
    screens = deduped

    static_count = len(screens) - manual_count
    now = datetime.now(timezone.utc).astimezone().isoformat()
    output = {
        "version": 1,
        "generated_at": now,
        "confirmed_by": "",
        "confirmed_at": "",
        "discovery": {
            "mode_used": "static",
            "static_count": static_count,
            "runtime_count": 0,
            "manual_count": manual_count,
            "excluded_count": 0,
            "framework_used": framework_used,
        },
        "screens": screens,
    }

    out_path = os.path.join(workspace, '_tmp', 'screen_plan_static.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f'\n[결과] 화면 {len(screens)}개 (정적 {static_count}, 수동 {manual_count})')
    print(f'[결과] framework: {framework_used}')
    for s in screens[:8]:
        nf = len(s.get('component_files', []))
        print(f'  {s["route"]:45} → {os.path.basename(s["entry"] or "(no entry)"):25} (+컴포넌트 {nf}개)')
    if len(screens) > 8:
        print(f'  ... 외 {len(screens) - 8}개')
    print(f'[저장] {out_path}')


if __name__ == '__main__':
    main()
