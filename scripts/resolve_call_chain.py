# STATUS: 완료
"""
resolve_call_chain.py
컨트롤러 파일 경로를 받아 연관된 서비스·DAO·쿼리 파일 경로를 반환한다.
router_inventory.json의 각 항목에 relatedFiles를 주입하기 위해 sl-recon STEP 4에서 호출한다.

사용법:
  python3 resolve_call_chain.py <router_inventory.json> <workspace_root>

출력:
  router_inventory_with_chain.json — relatedFiles 필드가 추가된 인벤토리
"""

import sys
import os
import re
import json
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

# 따라갈 레이어 키워드 (패키지/디렉토리 이름 기준)
# Phase 2 (2026-05-22): 기본값은 그대로 두고, Profile + Strategy yaml이 있으면
# load_effective_layers()가 동적으로 오버레이한다.
DEFAULT_FOLLOW_LAYERS = ('service', 'dao', 'repository', 'mapper', 'store', 'repo', 'persistence')
DEFAULT_SKIP_LAYERS   = ('util', 'common', 'constant', 'exception', 'annotation', 'config',
                         'enum', 'dto', 'vo', 'msg', 'helper', 'interceptor', 'filter',
                         'security', 'jwt', 'swagger')

# Backward-compat 별칭 — 기존 호출자/테스트 안전
FOLLOW_LAYERS = DEFAULT_FOLLOW_LAYERS
SKIP_LAYERS   = DEFAULT_SKIP_LAYERS

# 쿼리 파일 확장자 (데이터 접근 계층 파일)
QUERY_EXTS = ('.xml', '.sql', '.graphql', '.prisma')
QUERY_DIR_KW = ('mapper', 'sql', 'query', 'mybatis', 'resources')


def norm(p):
    return p.replace('\\', '/') if p else ''


_EXT_TOKENS  = frozenset(('py', 'java', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
                          'go', 'rs', 'kt', 'kts', 'cs', 'rb', 'php', 'ex', 'exs',
                          'scala', 'groovy', 'swift'))
_INIT_TOKENS = frozenset(('__init__', 'index', 'mod'))


# ──────────────────────────────────────────────
# Strategy 로더 (Phase 2 신규)
# ──────────────────────────────────────────────
# Profile + Strategy yaml들을 합성해 effective_layers를 만든다.
# 호출자가 명시적으로 load_effective_layers()를 부르지 않으면 DEFAULT 값이 그대로 쓰임.
# 기존 동작은 100% 보존.

def load_yaml(path):
    """pyyaml 있으면 사용, 없으면 None (조용한 fallback)."""
    try:
        import yaml
        return yaml.safe_load(open(path, encoding='utf-8'))
    except ImportError:
        return None
    except Exception:
        return None


def _profile_matches_strategy(profile: dict, strategy: dict) -> bool:
    """Strategy의 matches_profile 조건이 모두 충족되는지 확인."""
    cond = (strategy or {}).get('matches_profile') or {}
    for path, allowed in cond.items():
        if allowed is None:
            continue
        # path = 'backend.framework' → profile['backend']['framework'] 조회
        node = profile
        for seg in path.split('.'):
            if isinstance(node, dict):
                node = node.get(seg)
            else:
                node = None
                break
        if node is None:
            return False
        # allowed 가 list 면 OR 매칭. node 가 list 면 교집합 있으면 매칭.
        if isinstance(allowed, list):
            if isinstance(node, list):
                if not (set(allowed) & set(node)):
                    return False
            else:
                if node not in allowed:
                    return False
        else:
            if node != allowed:
                return False
    return True


def load_effective_layers(workspace_root: str = '.'):
    """
    Profile + 빌트인 strategies/{backends,persistence,arch}/ 를 합성해
    (follow_layers, skip_layers, max_depth) 튜플 반환.

    Profile 없거나 yaml 미지원이면 DEFAULT 값 그대로.
    """
    profile_path = os.path.join(workspace_root, '.speclinker', 'profile.yaml')
    profile = load_yaml(profile_path) if os.path.exists(profile_path) else None
    if not profile:
        return (set(DEFAULT_FOLLOW_LAYERS), set(DEFAULT_SKIP_LAYERS), 2)

    # 빌트인 strategies 디렉토리: 플러그인 위치 추정 (이 파일의 상위)
    plugin_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    strategies_dir = os.path.join(plugin_root, 'strategies')
    if not os.path.isdir(strategies_dir):
        return (set(DEFAULT_FOLLOW_LAYERS), set(DEFAULT_SKIP_LAYERS), 2)

    follow = set(DEFAULT_FOLLOW_LAYERS)
    skip   = set(DEFAULT_SKIP_LAYERS)
    max_depth = 2

    # 우선순위 낮은 → 높은 순으로 합성 (high priority 가 덮어쓰기)
    # 5종 차원 모두 로드 — frontend/batch는 spec_extraction·batch_signals 필드도 가지지만
    # 여기선 call_chain 필드만 합성에 사용한다.
    # community/ — meta-extractor가 만든 검수 대기 strategy도 동일 매칭 메커니즘.
    matched = []
    kind_dirs = ['backends', 'persistence', 'arch', 'frontend', 'batch', 'community']
    for kind_dir in kind_dirs:
        d = os.path.join(strategies_dir, kind_dir)
        if not os.path.isdir(d):
            continue
        for fname in sorted(os.listdir(d)):
            if not fname.endswith('.yaml'):
                continue
            strat = load_yaml(os.path.join(d, fname))
            if not strat:
                continue
            if _profile_matches_strategy(profile, strat):
                matched.append(strat)
    matched.sort(key=lambda s: int(s.get('priority', 0)))

    for strat in matched:
        cc = strat.get('call_chain') or {}
        for layer in (cc.get('follow_layers') or []):
            follow.add(str(layer).lower())
        for layer in (cc.get('skip_layers') or []):
            skip.add(str(layer).lower())
        md = cc.get('max_depth')
        if isinstance(md, int) and md > max_depth:
            max_depth = md

    # Phase 3: profile.overrides 합성 (사람이 직접 보정한 값 — 가장 마지막에 적용)
    # 회사·팀별 자체 컨벤션이나 자동 분석이 틀렸을 때 사용자가 채우는 영역.
    overrides = profile.get('overrides') or {}
    for layer in (overrides.get('follow_layers_extra') or []):
        follow.add(str(layer).lower())
    for layer in (overrides.get('skip_layers_extra') or []):
        skip.add(str(layer).lower())

    return (follow, skip, max_depth)


def has_layer_signal(fqn_or_path: str, layers: tuple) -> bool:
    """
    경로/FQN에서 layer 키워드가 컨텍스트 인식 방식으로 매칭되는지 검사.

    매칭 규칙:
    - 모든 separator(`.`, `/`, `\\`)를 통일 후 세그먼트 분리
    - 확장자/__init__/index/mod 같은 형식적 토큰은 제거 (실제 의미 있는 마지막 세그먼트 보존)
    - 폴더 세그먼트(마지막 제외): 정확 일치 또는 단순 복수형(+s/+es) 매칭
      → 'utils'는 'util' 매칭, 'utility_belt'는 매칭 안 됨
    - 마지막 세그먼트(클래스/모듈명): 부분문자열 매칭
      → 'OrderService' → 'service' 매칭됨

    Examples:
        has_layer_signal('com.example.order.service.OrderServiceImpl', ('service',)) → True
        has_layer_signal('com.example.order.domain.OrderService',     ('service',))  → True
        has_layer_signal('com.example.order.domain.event.OrderPlaced',('service',))  → False
        has_layer_signal('com.example.utility_belt.OrderProcessor',   ('util',))     → False
        has_layer_signal('com.example.utils.SomeHelper',              ('util',))     → True (복수형)
        has_layer_signal('app/orders/domain/order_service.py',        ('service',))  → True
        has_layer_signal('app/utils/__init__.py',                     ('util',))     → True
    """
    if not fqn_or_path:
        return False
    norm_path = fqn_or_path.replace('\\', '/').replace('.', '/').lower()
    segments = [s for s in norm_path.split('/') if s]
    # 형식적 토큰(확장자, __init__, index, mod)을 뒤에서부터 제거
    while len(segments) > 1 and (segments[-1] in _EXT_TOKENS or segments[-1] in _INIT_TOKENS):
        segments.pop()
    if not segments:
        return False
    # 폴더 세그먼트(마지막 제외): 정확 일치 OR 단순 복수형 매칭
    for seg in segments[:-1]:
        if seg in layers:
            return True
        for layer in layers:
            if seg == layer + 's' or seg == layer + 'es':
                return True
    # 마지막 세그먼트(클래스명/모듈명): 부분문자열 매칭 — 'OrderService'에서 'service' 잡힘
    last = segments[-1]
    for layer in layers:
        if layer in last:
            return True
    return False


# ──────────────────────────────────────────────
# source_index.json 기반 빠른 인덱스 구성
# ──────────────────────────────────────────────

def build_index_from_source_index(source_index_data):
    """
    scan_source.js가 생성한 source_index.json 데이터에서 두 인덱스를 구성한다.
    파일을 다시 read하지 않고 chain resolution에 필요한 모든 정보를 추출한다.

    Returns:
        class_index  : {ClassName: [abs_path, ...]}  — Java/Kotlin 전용
        imports_map  : {abs_path: {'lang': str, 'imports': [str]}}  — 전 언어
    """
    class_index = {}
    imports_map = {}

    for entry in source_index_data.get('files', []):
        fp       = norm(entry.get('filePath', ''))
        lang     = entry.get('lang', '')
        cls_name = entry.get('className', '')
        imports  = entry.get('imports', []) or []

        if not fp:
            continue

        # Java/Kotlin: 파일명 기준으로 인덱싱 (build_java_class_index 와 동일 전략).
        # className(AST) 대신 파일명을 쓰는 이유:
        #   interface/abstract 파일은 scan_source.js 가 className='' 로 저장하기 때문.
        #   import 문은 파일명(PrdAppInstService)을 참조하므로 파일명이 SSoT.
        if lang in ('java', 'kotlin'):
            fname_key = os.path.splitext(os.path.basename(fp))[0]
            if fname_key:
                class_index.setdefault(fname_key, []).append(fp)

        imports_map[fp] = {'lang': lang, 'imports': imports}

    return class_index, imports_map


def _resolve_java_imports_from_index(imports_list, class_index, fl, sl):
    """
    source_index.json 에 저장된 FQN imports 목록에서 파일 재read 없이 연관 파일 경로 반환.
    extract_java_imports() 와 동일한 follow_layers/skip_layers 필터를 적용한다.
    """
    files = []
    for fqn in imports_list:
        if not has_layer_signal(fqn, fl):
            continue
        if has_layer_signal(fqn, sl):
            continue
        class_name = fqn.split('.')[-1]
        if '*' in class_name:   # wildcard import 스킵
            continue
        for candidate in class_index.get(class_name, []):
            files.append(candidate)
    return files


def _resolve_ts_imports_from_index(file_path, imports_list, workspace_root, fl, sl):
    """
    source_index.json 에 저장된 TS/JS module 경로에서 파일 재read 없이 연관 파일 경로 반환.
    extract_ts_imports() 와 동일 로직 — 파일 content 없이 imports 목록만 사용.
    """
    files = []
    base_dir = os.path.dirname(file_path)
    for module in imports_list:
        if not (module.startswith('.') or module.startswith('/')):
            continue   # 외부 패키지 스킵
        candidate_base = os.path.normpath(os.path.join(base_dir, module))
        for ext in ('.ts', '.tsx', '.js', '.jsx', ''):
            p = candidate_base + ext if ext else candidate_base
            if os.path.isfile(p):
                if has_layer_signal(p, fl) and not has_layer_signal(p, sl):
                    files.append(norm(p))
                break
            idx_p = os.path.join(candidate_base, 'index' + ext) if ext else None
            if idx_p and os.path.isfile(idx_p):
                if has_layer_signal(idx_p, fl) and not has_layer_signal(idx_p, sl):
                    files.append(norm(idx_p))
                break
    return files


# ──────────────────────────────────────────────
# 언어별 import 파싱
# ──────────────────────────────────────────────

def build_java_class_index(source_root):
    """
    source_root 하위의 모든 .java 파일을 단 1회 walk해서
    { ClassName: [abs_path, ...] } 인덱스를 반환한다.

    대규모 프로젝트(1,000+ 파일)에서 파일당 os.walk 대신 O(1) 조회를 가능하게 한다.
    """
    _SKIP = frozenset(('.git', 'node_modules', '__pycache__', '.gradle', 'target', 'build', 'dist', 'out'))
    index = {}
    for root, dirs, files in os.walk(source_root):
        dirs[:] = [d for d in dirs if d not in _SKIP and not d.startswith('.')]
        for fname in files:
            if fname.endswith('.java'):
                classname = os.path.splitext(fname)[0]
                fp = norm(os.path.join(root, fname))
                index.setdefault(classname, []).append(fp)
    return index


def extract_java_imports(content, source_root, follow_layers=None, skip_layers=None, class_index=None):
    """
    Java import 문에서 연관 파일 경로 목록 반환.

    follow_layers / skip_layers: 호출자가 Profile 합성 결과를 전달할 수 있다.
    None이면 DEFAULT 사용 (기존 동작).
    class_index: build_java_class_index() 결과 (있으면 O(1) 조회, 없으면 os.walk fallback).
    """
    files = []
    fl = tuple(follow_layers) if follow_layers else DEFAULT_FOLLOW_LAYERS
    sl = tuple(skip_layers)   if skip_layers   else DEFAULT_SKIP_LAYERS

    for m in re.finditer(r'^import\s+([\w.]+);', content, re.M):
        fqn = m.group(1)
        parts = fqn.split('.')
        class_name = parts[-1]

        if not has_layer_signal(fqn, fl):
            continue
        if has_layer_signal(fqn, sl):
            continue

        if class_index is not None:
            # O(1) 클래스명 조회 (사전 인덱스 사용)
            for candidate in class_index.get(class_name, []):
                files.append(candidate)
        else:
            # fallback: os.walk (인덱스 없는 경우)
            for root, dirs, fnames in os.walk(source_root):
                dirs[:] = [d for d in dirs if not d.startswith('.') and d != 'node_modules']
                for fname in fnames:
                    if fname == class_name + '.java':
                        candidate = os.path.join(root, fname)
                        files.append(norm(candidate))
    return files


def extract_python_imports(content, file_path, workspace_root, follow_layers=None, skip_layers=None):
    """Python import/from 문에서 연관 파일 경로 반환.

    follow_layers / skip_layers: 호출자가 Profile 합성 결과 전달 가능. None이면 DEFAULT.
    """
    files = []
    base_dir = os.path.dirname(file_path)
    fl = tuple(follow_layers) if follow_layers else DEFAULT_FOLLOW_LAYERS
    sl = tuple(skip_layers)   if skip_layers   else DEFAULT_SKIP_LAYERS

    # from .xxx import / from ..xxx.yyy import 형태
    for m in re.finditer(r'^(?:from|import)\s+(\.+[\w.]*|[\w.]+)\s*(?:import\s+\w+)?', content, re.M):
        module = m.group(1)
        # 상대 경로
        if module.startswith('.'):
            dots = len(module) - len(module.lstrip('.'))
            rel   = module.lstrip('.')
            parts = rel.split('.') if rel else []
            base  = base_dir
            for _ in range(dots - 1):
                base = os.path.dirname(base)
            candidate_dir = os.path.join(base, *parts)
            for ext in ('.py',):
                for suffix in ('', '__init__'):
                    p = os.path.join(candidate_dir, suffix + ext) if suffix else candidate_dir + ext
                    if os.path.exists(p):
                        if has_layer_signal(p, fl) and not has_layer_signal(p, sl):
                            files.append(norm(p))
        else:
            # 절대 경로 — workspace_root 하위에서 검색
            rel_path = module.replace('.', os.sep) + '.py'
            candidate = os.path.join(workspace_root, rel_path)
            if os.path.exists(candidate):
                if has_layer_signal(candidate, fl) and not has_layer_signal(candidate, sl):
                    files.append(norm(candidate))
    return files


def extract_ts_imports(content, file_path, workspace_root, follow_layers=None, skip_layers=None):
    """TypeScript/JavaScript import 문에서 연관 파일 경로 반환."""
    files = []
    base_dir = os.path.dirname(file_path)
    fl = tuple(follow_layers) if follow_layers else DEFAULT_FOLLOW_LAYERS
    sl = tuple(skip_layers)   if skip_layers   else DEFAULT_SKIP_LAYERS

    for m in re.finditer(r'''(?:import|require)\s*(?:\{[^}]*\}|[\w*]+)?\s*(?:from\s*)?['"]([^'"]+)['"]''', content):
        module = m.group(1)
        if not (module.startswith('.') or module.startswith('/')):
            continue  # 외부 패키지 건너뜀

        candidate_base = os.path.normpath(os.path.join(base_dir, module))
        for ext in ('.ts', '.tsx', '.js', '.jsx', ''):
            p = candidate_base + ext if ext else candidate_base
            if os.path.isfile(p):
                if has_layer_signal(p, fl) and not has_layer_signal(p, sl):
                    files.append(norm(p))
                break
            # index 파일
            idx = os.path.join(candidate_base, 'index' + ext) if ext else None
            if idx and os.path.isfile(idx):
                if has_layer_signal(idx, fl) and not has_layer_signal(idx, sl):
                    files.append(norm(idx))
                break
    return files


def detect_language(file_path):
    """파일 확장자로 언어 감지.

    .vue / .svelte 는 <script> 블록 안에 TS/JS import가 들어가 있어
    extract_ts_imports의 정규식이 그대로 동작한다 (전체 텍스트에서 import 매칭).
    """
    ext = os.path.splitext(file_path)[1].lower()
    return {'.java': 'java', '.py': 'python',
            '.ts': 'ts', '.tsx': 'ts', '.js': 'js', '.jsx': 'js',
            '.mjs': 'js', '.cjs': 'js',
            '.vue': 'ts', '.svelte': 'ts'}.get(ext, 'unknown')


def extract_imports(file_path, workspace_root, follow_layers=None, skip_layers=None, class_index=None):
    """파일에서 연관 서비스/DAO 파일 목록 반환 (언어 자동 감지).

    follow_layers / skip_layers: 호출자(resolve_chain)가 Profile 합성 결과 전달 가능.
    class_index: Java 전용 사전 인덱스 (build_java_class_index 결과).
    """
    if not os.path.exists(file_path):
        return []
    try:
        content = open(file_path, encoding='utf-8', errors='ignore').read()
    except Exception:
        return []

    lang = detect_language(file_path)
    if lang == 'java':
        return extract_java_imports(content, workspace_root, follow_layers, skip_layers, class_index)
    elif lang == 'python':
        return extract_python_imports(content, file_path, workspace_root, follow_layers, skip_layers)
    elif lang in ('ts', 'js'):
        return extract_ts_imports(content, file_path, workspace_root, follow_layers, skip_layers)
    return []


# ──────────────────────────────────────────────
# 컨트롤러 파일에서 정의된 URL 추출 (Java Spring + Python FastAPI)
# STEP 5-1 POC URL 매칭, RTM 등에서 사용
# ──────────────────────────────────────────────

# Java Spring: @GetMapping("/path") / @RequestMapping(value="/path") / @PostMapping("/p")
_JAVA_MAPPING_RE = re.compile(
    r'@(?:Get|Post|Put|Delete|Patch|Request)Mapping\s*\(\s*(?:value\s*=\s*)?["\']([^"\']+)["\']',
    re.I,
)
# Python FastAPI / Flask / aiohttp / Litestar decorators
# FastAPI:  @router.get("/path")  @app.post("/path")
# Flask:    @app.route("/path", methods=["GET","POST"])  @bp.get("/path")
# aiohttp:  @routes.get("/path")  @router.post("/path")
# Litestar: @get("/path")  @post("/path")
_PYTHON_ROUTE_RE = re.compile(
    r'@\w+(?:\.\w+)*\.(?:get|post|put|delete|patch|head|options|route)\s*\(\s*["\']([^"\']+)["\']'
    r'|'
    r'@(?:get|post|put|delete|patch)\s*\(\s*["\']([^"\']+)["\']',  # Litestar standalone
    re.I,
)
# Express.js / Koa / Hapi (JS/TS)
# app.get("/path", ...) / router.post("/path", ...) / server.route({method:"GET",path:"/path"})
_EXPRESS_ROUTE_RE = re.compile(
    r'(?:app|router|server)\s*\.\s*(?:get|post|put|delete|patch|head|all|use)\s*\(\s*["\']([^"\']+)["\']',
    re.I,
)
# NestJS: @Get("/path") / @Post() / @Controller("/prefix")
_NESTJS_ROUTE_RE = re.compile(
    r'@(?:Get|Post|Put|Delete|Patch|Head|Options|All)\s*\(\s*["\']([^"\']+)["\']',
    re.I,
)
_NESTJS_CTRL_RE = re.compile(
    r'@Controller\s*\(\s*["\']([^"\']+)["\']',
    re.I,
)
# Django urls.py: path("/url", view) / re_path(r"^url/")
_DJANGO_PATH_RE = re.compile(
    r'(?:re_)?path\s*\(\s*r?["\']([^"\']+)["\']',
    re.I,
)


def extract_defined_urls(file_path):
    """컨트롤러/라우터 파일에서 정의된 엔드포인트 URL 목록 반환.

    지원 언어·프레임워크:
    - Java: Spring MVC (@GetMapping / @PostMapping / @RequestMapping + 클래스 prefix)
            NestJS (@Get / @Post + @Controller prefix)
    - Python: FastAPI, Flask, aiohttp, Litestar (@router.get / @app.route / @get 등)
              Django urls.py (path() / re_path())
    - JS/TS: Express.js, Koa, Fastify (app.get / router.post 등)
             NestJS TypeScript decorators (@Get / @Post + @Controller)

    Returns:
        list[str] — '/product/list', '/api/items/{id}' 같은 경로 목록 (중복 제거)
    """
    if not os.path.exists(file_path):
        return []
    try:
        body = open(file_path, encoding='utf-8', errors='ignore').read()
    except Exception:
        return []

    lang = detect_language(file_path)
    ext  = os.path.splitext(file_path)[1].lower()
    urls = []

    def _add(url, prefix=''):
        if not url:
            return
        url = url.strip()
        # Django re_path 정규식 패턴 → 그대로 유지 (^, $ 제거만)
        url = url.lstrip('^').rstrip('$').rstrip('/')
        if prefix and not url.startswith(prefix):
            url = prefix.rstrip('/') + '/' + url.lstrip('/')
        urls.append(url if url.startswith('/') else '/' + url)

    if lang == 'java':
        # 클래스 레벨 prefix (@RequestMapping("/product"))
        prefix_m = re.search(
            r'@RequestMapping\s*\(\s*(?:value\s*=\s*)?["\']([^"\']+)["\']', body, re.I
        )
        prefix = prefix_m.group(1).rstrip('/') if prefix_m else ''
        for m in _JAVA_MAPPING_RE.finditer(body):
            _add(m.group(1), prefix)
        # NestJS 처리 (Java 확장자면 TS가 아닌 Java — 보통 해당 없지만 방어)

    elif lang == 'python':
        fname_lower = os.path.basename(file_path).lower()
        if 'urls' in fname_lower or 'url_conf' in fname_lower:
            # Django urls.py
            for m in _DJANGO_PATH_RE.finditer(body):
                _add(m.group(1))
        else:
            # FastAPI / Flask / aiohttp / Litestar
            prefix_m = re.search(
                r'(?:APIRouter|Blueprint)\s*\([^)]*prefix\s*=\s*["\']([^"\']+)["\']', body, re.I
            )
            prefix = prefix_m.group(1).rstrip('/') if prefix_m else ''
            for m in _PYTHON_ROUTE_RE.finditer(body):
                _add(m.group(1) or m.group(2), prefix)

    elif lang in ('ts', 'js'):
        # NestJS: @Controller prefix + @Get/@Post 메서드
        ctrl_m = _NESTJS_CTRL_RE.search(body)
        ctrl_prefix = ctrl_m.group(1).rstrip('/') if ctrl_m else ''
        for m in _NESTJS_ROUTE_RE.finditer(body):
            _add(m.group(1), ctrl_prefix)
        # Express / Koa / Fastify
        for m in _EXPRESS_ROUTE_RE.finditer(body):
            u = m.group(1)
            # Express app.use('/api') 같은 마운트 경로도 수집 (prefix 역할)
            _add(u)

    return list(dict.fromkeys(urls))  # 순서 보존 중복 제거


def find_query_files(dao_file, workspace_root):
    """DAO 파일명 기반으로 연관 쿼리/매퍼 파일 검색"""
    base_name = os.path.splitext(os.path.basename(dao_file))[0]
    # 'CoupangMapper' → 'CoupangMapper.xml' 등 검색
    results = []
    for root, dirs, fnames in os.walk(workspace_root):
        dirs[:] = [d for d in dirs if not d.startswith('.') and d != 'node_modules']
        root_lower = norm(root).lower()
        if not any(k in root_lower for k in QUERY_DIR_KW):
            continue
        for fname in fnames:
            if os.path.splitext(fname)[1].lower() in QUERY_EXTS:
                # 파일명 일치 (확장자 제외)
                if os.path.splitext(fname)[0].lower() == base_name.lower():
                    results.append(norm(os.path.join(root, fname)))
    return results


# ──────────────────────────────────────────────
# M-1: service/impl 해소 + MyBatis 문자열 네임스페이스 → XML 해소
# (service 인터페이스에서 멈춰 dao/query=0 되는 문제, jwork류 typed-Mapper 부재 대응)
# ──────────────────────────────────────────────

def impl_files(file_path, class_index):
    """service 인터페이스(Foo)의 구현체(FooImpl 등)를 class_index에서 찾는다.
    Spring service/impl 분리 구조에서 DAO/Mapper는 인터페이스가 아닌 Impl이 import한다."""
    if not class_index:
        return []
    base = os.path.splitext(os.path.basename(file_path))[0]
    if base.endswith('Impl'):
        return []
    out = []
    for suffix in ('Impl', 'ServiceImpl'):
        for cand in class_index.get(base + suffix, []):
            if norm(cand) != norm(file_path):
                out.append(norm(cand))
    return out


_NS_INDEX_CACHE = {}
_NS_SCAN_CACHE = {}
_NS_DECL = re.compile(r'<mapper\s+namespace\s*=\s*"([^"]+)"', re.I)
# MyBatis 호출: session.selectList("ns.id", ...) / baseDao.update("ns.id") 등
_MYBATIS_CALL = re.compile(
    r'\.(?:select|selectOne|selectList|selectMap|insert|update|delete|'
    r'queryFor\w+|getList|getOne|getMap|getObject|execute)\s*\(\s*"([\w.]+)"', re.I)


def _namespace_index(workspace_root):
    """모든 *.xml의 <mapper namespace="X"> → {namespace: xml경로} (워크스페이스당 1회, 메모)."""
    key = norm(workspace_root)
    if key in _NS_INDEX_CACHE:
        return _NS_INDEX_CACHE[key]
    idx = {}
    for root, dirs, fnames in os.walk(workspace_root):
        dirs[:] = [d for d in dirs if not d.startswith('.') and d != 'node_modules']
        for fname in fnames:
            if not fname.lower().endswith('.xml'):
                continue
            fp = os.path.join(root, fname)
            try:
                head = open(fp, encoding='utf-8', errors='ignore').read(4000)
            except OSError:
                continue
            m = _NS_DECL.search(head)
            if m:
                idx[m.group(1)] = norm(fp)
    _NS_INDEX_CACHE[key] = idx
    return idx


def find_query_files_by_namespace(src_file, workspace_root):
    """소스 파일의 MyBatis 문자열 SQL 참조("ns.id")를 namespace 기준으로 XML에 매핑.
    typed Mapper import가 없는 jwork/SqlSession 패턴 대응. 파일·워크스페이스 단위 메모."""
    key = norm(src_file)
    if key in _NS_SCAN_CACHE:
        return _NS_SCAN_CACHE[key]
    ns_idx = _namespace_index(workspace_root)
    out = []
    if ns_idx and str(src_file).lower().endswith(('.java', '.kt', '.kts')):
        try:
            content = open(src_file, encoding='utf-8', errors='ignore').read()
        except OSError:
            content = ''
        namespaces = sorted(ns_idx.keys(), key=len, reverse=True)  # 최장 prefix 우선
        for m in _MYBATIS_CALL.finditer(content):
            ref = m.group(1)
            for ns in namespaces:
                if ref == ns or ref.startswith(ns + '.'):
                    xml = ns_idx[ns]
                    if xml not in out:
                        out.append(xml)
                    break
    _NS_SCAN_CACHE[key] = out
    return out


# ──────────────────────────────────────────────
# SQL/XML 스키마 추출 (응답 컬럼·nullable 사전 파싱)
# ──────────────────────────────────────────────

SELECT_PATTERN = re.compile(
    r'SELECT\s+(.+?)\s+FROM\s+', re.I | re.S
)
LEFT_JOIN_PATTERN = re.compile(r'LEFT\s+(?:OUTER\s+)?JOIN\s+(\w+)', re.I)

# 테이블 참조 패턴 (FROM/JOIN/INSERT/UPDATE/DELETE — sch_draft 생성용)
FROM_TBL_PATTERN   = re.compile(r'\bFROM\s+([`"\[\]\w.]+)', re.I)
JOIN_TBL_PATTERN   = re.compile(r'(?:INNER|LEFT|RIGHT|FULL|CROSS)?\s*(?:OUTER\s+)?JOIN\s+([`"\[\]\w.]+)', re.I)
INSERT_TBL_PATTERN = re.compile(r'\bINSERT\s+INTO\s+([`"\[\]\w.]+)', re.I)
UPDATE_TBL_PATTERN = re.compile(r'\bUPDATE\s+([`"\[\]\w.]+)\s+SET', re.I)
DELETE_TBL_PATTERN = re.compile(r'\bDELETE\s+FROM\s+([`"\[\]\w.]+)', re.I)


def clean_table_name(raw):
    """`schema.tbl`, "tbl", [tbl] → tbl (소문자, MyBatis/JdbcTemplate placeholder 제외)"""
    if not raw:
        return ''
    t = raw.strip().strip('`"[]')
    # MyBatis ${var} / #{var} / Spring :var 같은 동적 SQL placeholder 제외
    if t.startswith(('#', '$', ':', '?')) or '${' in t or '#{' in t:
        return ''
    # schema.table → table만 남김
    t = t.split('.')[-1].strip('`"[]')
    return t.lower() if re.match(r'^\w+$', t) else ''


def extract_tables_from_sql_text(sql_text):
    """SQL 텍스트에서 참조된 모든 테이블명을 union으로 추출 (DDL/DML)"""
    tables = set()
    for pat in (FROM_TBL_PATTERN, JOIN_TBL_PATTERN,
                INSERT_TBL_PATTERN, UPDATE_TBL_PATTERN, DELETE_TBL_PATTERN):
        for m in pat.finditer(sql_text):
            t = clean_table_name(m.group(1))
            if t:
                tables.add(t)
    return sorted(tables)
MYBATIS_SELECT_PATTERN = re.compile(
    r'<select\s+[^>]*id\s*=\s*"([^"]+)"[^>]*>(.+?)</select>', re.I | re.S
)
RESULTMAP_PATTERN = re.compile(
    r'<resultMap\s+[^>]*id\s*=\s*"([^"]+)"[^>]*>(.+?)</resultMap>', re.I | re.S
)
RESULT_COL_PATTERN = re.compile(
    r'<(?:result|id)\s+([^/]+?)/?>', re.I
)
ATTR_PATTERN = re.compile(r'(\w+)\s*=\s*"([^"]*)"')


def parse_select_columns(select_body):
    """SELECT 절 컬럼 텍스트를 파싱해서 컬럼 리스트 반환"""
    # 'a.col1 AS alias1, b.col2, NVL(x,0) AS y' 같은 패턴
    # MyBatis 동적 SQL <if> 등은 단순 제거
    body = re.sub(r'<if[^>]*>.*?</if>', '', select_body, flags=re.S | re.I)
    body = re.sub(r'<\w+[^>]*>', '', body)
    body = re.sub(r'</\w+>', '', body)
    body = re.sub(r'/\*.*?\*/', '', body, flags=re.S)
    body = re.sub(r'--[^\n]*', '', body)

    cols = []
    depth = 0
    cur = ''
    for ch in body:
        if ch == '(':
            depth += 1
            cur += ch
        elif ch == ')':
            depth -= 1
            cur += ch
        elif ch == ',' and depth == 0:
            if cur.strip():
                cols.append(cur.strip())
            cur = ''
        else:
            cur += ch
    if cur.strip():
        cols.append(cur.strip())

    parsed = []
    for c in cols:
        # ' a.col1 AS alias1' → name=alias1, source=a.col1
        m = re.search(r'^(.+?)\s+(?:AS\s+)?(\w+)\s*$', c, re.I)
        if m:
            name = m.group(2)
            source = m.group(1).strip()
        else:
            name = c.split('.')[-1].strip()
            source = c
        # nullable 휴리스틱: CASE WHEN ... ELSE NULL, NVL, COALESCE, LEFT JOIN
        nullable = bool(
            re.search(r'ELSE\s+NULL', source, re.I)
            or re.search(r'\b(NVL|COALESCE|IFNULL)\s*\(', source, re.I)
        )
        parsed.append({'name': name, 'source': source, 'nullable': nullable})
    return parsed


def extract_query_schema(query_file):
    """SQL/XML 파일에서 SELECT 컬럼·nullable·LEFT JOIN 정보 추출"""
    if not os.path.exists(query_file):
        return None
    try:
        body = open(query_file, encoding='utf-8', errors='ignore').read()
    except Exception:
        return None

    ext = os.path.splitext(query_file)[1].lower()
    schema = {'queryFile': norm(query_file), 'selects': []}

    if ext == '.xml':
        # MyBatis: <select id="..."> ... </select>
        for m in MYBATIS_SELECT_PATTERN.finditer(body):
            stmt_id = m.group(1)
            stmt_body = m.group(2)
            sel_m = SELECT_PATTERN.search(stmt_body)
            if not sel_m:
                continue
            cols = parse_select_columns(sel_m.group(1))
            left_joins = LEFT_JOIN_PATTERN.findall(stmt_body)
            schema['selects'].append({
                'id': stmt_id,
                'columns': cols,
                'leftJoinedTables': sorted(set(t.lower() for t in left_joins)),
                'tables': extract_tables_from_sql_text(stmt_body),
            })
        # resultMap도 보강
        result_maps = []
        for m in RESULTMAP_PATTERN.finditer(body):
            map_id = m.group(1)
            cols = []
            for col_m in RESULT_COL_PATTERN.finditer(m.group(2)):
                attrs = dict(ATTR_PATTERN.findall(col_m.group(1)))
                if 'property' in attrs:
                    cols.append({
                        'name':     attrs.get('property'),
                        'column':   attrs.get('column', ''),
                        'jdbcType': attrs.get('jdbcType', ''),
                    })
            result_maps.append({'id': map_id, 'columns': cols})
        if result_maps:
            schema['resultMaps'] = result_maps
        # INSERT/UPDATE/DELETE 구문 — 컬럼 추론이 어려워 테이블만 기록 (sch_draft 보강용)
        writes = []
        for tag in ('insert', 'update', 'delete'):
            for m in re.finditer(rf'<{tag}\s+[^>]*id\s*=\s*"([^"]+)"[^>]*>(.+?)</{tag}>', body, re.I | re.S):
                stmt_id = m.group(1)
                stmt_body = m.group(2)
                tbls = extract_tables_from_sql_text(stmt_body)
                if tbls:
                    writes.append({'id': stmt_id, 'op': tag, 'tables': tbls})
        if writes:
            schema['writes'] = writes
    elif ext == '.sql':
        # 일반 SQL: 첫 SELECT 구문만 파싱, 그 외 DML은 테이블만 기록
        sel_m = SELECT_PATTERN.search(body)
        if sel_m:
            cols = parse_select_columns(sel_m.group(1))
            left_joins = LEFT_JOIN_PATTERN.findall(body)
            schema['selects'].append({
                'id': os.path.basename(query_file),
                'columns': cols,
                'leftJoinedTables': sorted(set(t.lower() for t in left_joins)),
                'tables': extract_tables_from_sql_text(body),
            })
        # 파일 전체에서 테이블 union (INSERT/UPDATE/DELETE 포함)
        all_tbls = extract_tables_from_sql_text(body)
        if all_tbls:
            schema['allTables'] = all_tbls

    # 컬럼이 없어도 테이블 정보가 있으면 schema를 반환 (sch_draft 신호)
    has_any_signal = (
        schema['selects']
        or schema.get('resultMaps')
        or schema.get('writes')
        or schema.get('allTables')
    )
    return schema if has_any_signal else None


# ──────────────────────────────────────────────
# call chain 해결 (Controller → Service → DAO → Query)
# ──────────────────────────────────────────────

def resolve_chain(controller_path, workspace_root, max_depth=2, class_index=None,
                  imports_map=None):
    """
    컨트롤러 → 서비스 → DAO (최대 2홉) + 쿼리 파일까지 반환
    반환: { "service": [...], "dao": [...], "query": [...] }

    Profile yaml이 있으면 strategy 합성으로 follow/skip layers를 동적 결정.
    class_index  : build_java_class_index() 또는 build_index_from_source_index() 결과.
    imports_map  : build_index_from_source_index() 결과 — 있으면 파일 재read 없이 처리.
    """
    fl, sl, strategy_max_depth = load_effective_layers(workspace_root)
    if strategy_max_depth > max_depth:
        max_depth = strategy_max_depth

    visited = set()
    service_files = []
    dao_files = []
    query_files = []

    def _get_related(file_path):
        """imports_map 우선 사용, 없으면 파일 직접 read."""
        fp_norm = norm(file_path)
        if imports_map and fp_norm in imports_map:
            entry      = imports_map[fp_norm]
            lang       = entry['lang']
            imp_list   = entry['imports']
            if lang in ('java', 'kotlin'):
                return _resolve_java_imports_from_index(imp_list, class_index or {}, fl, sl)
            elif lang in ('typescript', 'javascript'):
                return _resolve_ts_imports_from_index(fp_norm, imp_list, workspace_root, fl, sl)
            # Python / 기타: 파일 수가 적고 포맷 차이 가능성 → 안전하게 file read
        return extract_imports(file_path, workspace_root, fl, sl, class_index)

    def traverse(file_path, depth):
        if depth == 0 or norm(file_path) in visited:
            return
        visited.add(norm(file_path))

        related = _get_related(file_path)
        for rf in related:
            if norm(rf) in visited:
                continue
            rf_lower = norm(rf).lower()

            is_dao = any(k in rf_lower for k in ('dao', 'repository', 'mapper', 'repo', 'persistence', 'store'))
            is_svc = any(k in rf_lower for k in ('service',))

            if depth == max_depth:  # 컨트롤러 레벨 → 서비스
                service_files.append(rf)
                traverse(rf, depth - 1)
                # M-1: service 인터페이스의 Impl도 따라가 DAO/Mapper에 도달 (service/impl 분리 대응)
                for impl in impl_files(rf, class_index):
                    if norm(impl) not in visited:
                        service_files.append(impl)
                        traverse(impl, depth - 1)
            else:  # 서비스 레벨 → DAO
                dao_files.append(rf)
                # 쿼리 파일 탐색
                qf = find_query_files(rf, workspace_root)
                query_files.extend(qf)

    traverse(controller_path, max_depth)

    # M-1: MyBatis 문자열 네임스페이스 SQL 참조 해소 (typed Mapper import 없는 jwork류)
    # 컨트롤러·서비스·Impl·DAO 어디에 박혀 있어도 namespace로 XML을 찾는다.
    for f in [controller_path] + service_files + dao_files:
        if str(f).lower().endswith(('.java', '.kt', '.kts')):
            query_files.extend(find_query_files_by_namespace(f, workspace_root))

    services = list(dict.fromkeys(service_files))
    daos = list(dict.fromkeys(dao_files))
    queries = list(dict.fromkeys(query_files))

    # 쿼리 파일별 스키마 사전 추출 (응답 컬럼·nullable·LEFT JOIN)
    query_schemas = []
    for qf in queries:
        sch = extract_query_schema(qf)
        if sch:
            query_schemas.append(sch)

    # 라우터가 사용하는 테이블 → 컬럼 union 집계 (sch_draft 빌드용)
    used_tables = {}   # tablename → { columns:set, queries:set, joinHints:list }
    for sch in query_schemas:
        qfile = sch.get('queryFile', '')
        # SELECT 컬럼은 어느 테이블 소속인지 정적으로 단정하기 어려움 → "원본 source"의 alias prefix로 휴리스틱 매핑
        for sel in sch.get('selects', []):
            tbls = sel.get('tables', []) or []
            if not tbls:
                continue
            primary = tbls[0]  # 첫 테이블을 기본 소속으로 가정 (FROM 첫 항목)
            # 모든 참여 테이블을 초기화
            for t in tbls:
                used_tables.setdefault(t, {'columns': set(), 'queries': set(), 'joinHints': []})
                used_tables[t]['queries'].add(qfile)
            for col in sel.get('columns', []):
                src = (col.get('source') or '').strip()
                # 'u.name' → u (alias), 매칭되는 테이블이 있으면 그쪽에, 없으면 primary에
                alias_m = re.match(r'^(\w+)\.(\w+)', src)
                if alias_m:
                    alias = alias_m.group(1).lower()
                    target = next((t for t in tbls if t == alias or t.startswith(alias)), primary)
                else:
                    target = primary
                used_tables[target]['columns'].add(col.get('name', ''))
            # LEFT JOIN 힌트 기록
            for joined in sel.get('leftJoinedTables', []) or []:
                jt = clean_table_name(joined)
                if jt and jt != primary:
                    used_tables.setdefault(primary, {'columns': set(), 'queries': set(), 'joinHints': []})
                    used_tables[primary]['joinHints'].append({'with': jt, 'type': 'LEFT JOIN'})
        # INSERT/UPDATE/DELETE — 테이블만 기록 (컬럼은 비움)
        for w in sch.get('writes', []) or []:
            for t in w.get('tables', []) or []:
                used_tables.setdefault(t, {'columns': set(), 'queries': set(), 'joinHints': []})
                used_tables[t]['queries'].add(qfile)
        # resultMap → 컬럼명 보강 (어느 테이블인지 모를 땐 첫 select의 primary 테이블에)
        if sch.get('resultMaps') and query_schemas:
            primary_tbl = None
            for sel in sch.get('selects', []):
                if sel.get('tables'):
                    primary_tbl = sel['tables'][0]
                    break
            if primary_tbl:
                for rm in sch['resultMaps']:
                    for col in rm.get('columns', []):
                        cn = col.get('column') or col.get('name')
                        if cn:
                            used_tables.setdefault(primary_tbl, {'columns': set(), 'queries': set(), 'joinHints': []})
                            used_tables[primary_tbl]['columns'].add(cn)
        # .sql 파일 allTables — 컬럼 매핑은 못 하지만 테이블 등록
        for t in sch.get('allTables', []) or []:
            used_tables.setdefault(t, {'columns': set(), 'queries': set(), 'joinHints': []})
            used_tables[t]['queries'].add(qfile)

    # set → list
    used_tables_out = {}
    for t, info in used_tables.items():
        used_tables_out[t] = {
            'columns':   sorted(c for c in info['columns'] if c),
            'queries':   sorted(info['queries']),
            'joinHints': info['joinHints'],
        }

    return {
        'service':       services,
        'dao':           daos,
        'query':         queries,
        'querySchemas':  query_schemas,
        'usedTables':    used_tables_out,
    }


# ──────────────────────────────────────────────
# sch_draft 도메인 단위 dump (append-only)
# ──────────────────────────────────────────────

def dump_sch_drafts(enriched, workspace_root):
    """
    라우터별 usedTables를 도메인 단위로 집계해
    _tmp/sch_draft/{도메인}/{테이블}.json 에 union으로 dump한다.

    구조:
      { table, domain, columns:{name:{seen}}, evidence:[qfile], joinHints:[],
        referencedByRouter:[fp], referencedByInfRange:[INF-A~B] }

    같은 테이블이 여러 라우터에서 발견되면 append-only로 누적 (정보 손실 없음).
    """
    sch_draft_dir = os.path.join(workspace_root, '_tmp', 'sch_draft')
    os.makedirs(sch_draft_dir, exist_ok=True)

    # 도메인 → 테이블 → 누적 slot
    acc = {}
    for group in enriched:
        for item in group:
            domain      = item.get('domain') or 'unknown'
            router_fp   = item.get('filePath', '')
            inf_start   = item.get('infStart', 0)
            inf_end     = item.get('infEnd', 0)
            inf_range   = f'INF-{inf_start:03d}~INF-{inf_end:03d}' if inf_start else ''
            chain       = item.get('relatedFiles') or {}
            used_tables = chain.get('usedTables') or {}

            for table, info in used_tables.items():
                slot = acc.setdefault(domain, {}).setdefault(table, {
                    'table': table,
                    'domain': domain,
                    'columns': {},
                    'evidence': set(),
                    'joinHints': [],
                    'referencedByRouter': set(),
                    'referencedByInfRange': set(),
                })
                for col in info.get('columns', []) or []:
                    if not col:
                        continue
                    slot['columns'].setdefault(col, {'seen': 0})
                    slot['columns'][col]['seen'] += 1
                for q in info.get('queries', []) or []:
                    slot['evidence'].add(q)
                for h in info.get('joinHints', []) or []:
                    if h not in slot['joinHints']:
                        slot['joinHints'].append(h)
                if router_fp:
                    slot['referencedByRouter'].add(router_fp)
                if inf_range:
                    slot['referencedByInfRange'].add(inf_range)

    total_tables = 0
    for domain, tables in acc.items():
        ddir = os.path.join(sch_draft_dir, domain)
        os.makedirs(ddir, exist_ok=True)
        for table, slot in tables.items():
            slot['evidence']             = sorted(slot['evidence'])
            slot['referencedByRouter']   = sorted(slot['referencedByRouter'])
            slot['referencedByInfRange'] = sorted(slot['referencedByInfRange'])
            out_path = os.path.join(ddir, f'{table}.json')
            # 기존 파일이 있으면 union (append-only — 다른 라우터 그룹의 정보 보존)
            if os.path.exists(out_path):
                try:
                    prev = json.load(open(out_path, encoding='utf-8'))
                    for cn, cv in (prev.get('columns') or {}).items():
                        if cn in slot['columns']:
                            slot['columns'][cn]['seen'] += cv.get('seen', 0)
                        else:
                            slot['columns'][cn] = cv
                    slot['evidence'] = sorted(set(slot['evidence']) | set(prev.get('evidence') or []))
                    slot['referencedByRouter'] = sorted(
                        set(slot['referencedByRouter']) | set(prev.get('referencedByRouter') or []))
                    slot['referencedByInfRange'] = sorted(
                        set(slot['referencedByInfRange']) | set(prev.get('referencedByInfRange') or []))
                    for h in (prev.get('joinHints') or []):
                        if h not in slot['joinHints']:
                            slot['joinHints'].append(h)
                except Exception:
                    pass
            with open(out_path, 'w', encoding='utf-8') as f:
                json.dump(slot, f, ensure_ascii=False, indent=2)
            total_tables += 1
    return len(acc), total_tables


# ──────────────────────────────────────────────
# 메인
# ──────────────────────────────────────────────

def main():
    if len(sys.argv) < 3:
        print('사용법: python3 resolve_call_chain.py <inventory.json> <workspace_root>')
        print('  inventory.json: router_inventory.json 또는 batch_inventory.json')
        sys.exit(1)

    inventory_path = sys.argv[1]
    workspace_root = sys.argv[2]

    inventory = json.load(open(inventory_path, encoding='utf-8'))
    # inventory는 배치 그룹 배열 (list of list) 또는 flat list (이전 버전 호환)
    if inventory and isinstance(inventory[0], dict):
        BATCH = 3
        inventory = [inventory[i:i+BATCH] for i in range(0, len(inventory), BATCH)]

    all_items_flat = [item for group in inventory for item in group]
    first_fp = all_items_flat[0].get('filePath', '') if all_items_flat else ''

    class_index = None
    imports_map = None

    # ① source_index.json 있으면 파일 재read 없이 두 인덱스를 한 번에 구성
    source_index_path = os.path.join(workspace_root, '_tmp', 'source_index.json')
    if os.path.exists(source_index_path):
        try:
            source_index_data = json.load(open(source_index_path, encoding='utf-8'))
            class_index, imports_map = build_index_from_source_index(source_index_data)
            n_cls   = sum(len(v) for v in class_index.values())
            n_files = len(imports_map)
            print(f'source_index.json 로드 완료 — 파일 재read 없이 chain 해석')
            print(f'  → 클래스 인덱스 {n_cls}개, import 맵 {n_files}파일')
        except Exception as e:
            print(f'[WARN] source_index.json 로드 실패, 파일 직접 read fallback: {e}')
            class_index = None
            imports_map = None

    # ② source_index.json 없을 때 Java면 클래스 인덱스만 별도 빌드 (기존 동작)
    if class_index is None and first_fp.endswith('.java'):
        print('Java 클래스 인덱스 빌드 중...')
        class_index = build_java_class_index(workspace_root)
        total_cls = sum(len(v) for v in class_index.values())
        print(f'  → {total_cls} 파일 인덱싱 완료 (O(1) 조회 활성화)')

    total_files = 0
    total_schemas = 0
    enriched = []
    for group in inventory:
        new_group = []
        for item in group:
            fp = item.get('filePath', '')
            abs_fp = fp if os.path.isabs(fp) else os.path.join(workspace_root, fp)

            chain = resolve_chain(abs_fp, workspace_root, class_index=class_index,
                                  imports_map=imports_map)
            item['relatedFiles'] = chain

            n = len(chain['service']) + len(chain['dao']) + len(chain['query'])
            ns = len(chain.get('querySchemas', []))
            total_files += n
            total_schemas += ns
            if n:
                print(f"  {os.path.basename(fp)}: svc={len(chain['service'])} dao={len(chain['dao'])} query={len(chain['query'])} schema={ns}")

            new_group.append(item)
        enriched.append(new_group)

    # 출력 파일명: 입력 파일명 기반 자동 결정
    base_name = os.path.splitext(os.path.basename(inventory_path))[0]
    out_filename = f'{base_name}_with_chain.json'
    out_path = os.path.join(os.path.dirname(inventory_path), out_filename)
    json.dump(enriched, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'\n{out_filename} 저장 완료 (연관 파일 {total_files}개, 스키마 사전 추출 {total_schemas}개)')

    # router_inventory 처리 시 sch_draft 도메인별 dump
    # (batch_inventory도 같은 SQL을 보지만 1차 구현은 router만, 향후 확장 가능)
    if 'router' in base_name.lower():
        try:
            n_domain, n_table = dump_sch_drafts(enriched, workspace_root)
            print(f'_tmp/sch_draft/ 생성: 도메인 {n_domain}개, 테이블 {n_table}개 (ddd-db-agent 1차 입력)')
        except Exception as e:
            print(f'[WARN] sch_draft dump 실패, 무시하고 계속: {e}')


if __name__ == '__main__':
    main()
