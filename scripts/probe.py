# STATUS: 완료
"""
probe.py
프로젝트의 기술 스택·아키텍처 인식을 위한 정적 1차 신호를 수집한다.
LLM 호출 없는 결정론적 분석. profile-agent(Phase 1) 입력으로 사용된다.

사용법:
  python3 probe.py <workspace_root> [--out <path>]

출력 (`_tmp/probe.json`):
  {
    "workspace": "<absolute path>",
    "manifests": {                # 발견된 빌드/의존성 파일과 핵심 의존성
      "pom.xml":         {"dependencies": [...]},
      "package.json":    {"dependencies": {...}, "devDependencies": {...}, "scripts": {...}},
      "go.mod":          {"module": "...", "dependencies": [...]},
      "requirements.txt":{"dependencies": [...]},
      "Cargo.toml":      {...},
      "build.gradle":    {...},
      "Gemfile":         {...},
      "composer.json":   {...},
      "mix.exs":         {...}
    },
    "directory_tree": [           # depth-2 디렉토리 (도메인 분할 신호)
      "src/main/java/com/example/order",
      "src/main/java/com/example/user", ...
    ],
    "directory_keywords": {       # 디렉토리명 빈도 (architecture 신호)
      "service": 12, "domain": 8, "adapter": 4, ...
    },
    "extension_distribution": {".java": 240, ".xml": 35, ".sql": 8, ".sql": 8},
    "ua_graph_summary": {         # knowledge-graph 있을 때만
      "total_nodes": 1240,
      "node_types":  {"router": 18, "service": 42, "entity": 30, ...}
    },
    "indicators": {               # Probe가 추정한 1차 신호 (절대 단정 아님)
      "likely_backend_lang":        "java",
      "likely_backend_framework":   "spring-boot",
      "likely_persistence":         ["mybatis"],
      "likely_frontend_framework":  null,
      "architecture_hints":         ["hexagonal: domain+adapter 디렉토리 동시 존재"]
    }
  }

설계 원칙:
  - LLM 호출 없음. 모든 신호는 파일 시스템 정적 분석.
  - 추측은 indicators 에만 모아두고, 다른 필드는 raw fact만 담는다.
  - profile-agent(Phase 1)가 이걸 보고 정확한 profile.yaml을 만든다.
"""

import sys
import os
import re
import json
import argparse
from collections import Counter

# ────────────────────────────────────────────────────────────
# 디렉토리/파일 스캐닝
# ────────────────────────────────────────────────────────────

IGNORE_DIRS = frozenset((
    '.git', '.svn', '.hg', 'node_modules', '.venv', 'venv', '__pycache__',
    '.idea', '.vscode', '.gradle', '.mvn', 'target', 'build', 'dist', 'out',
    '.next', '.nuxt', '.cache', 'coverage', 'tmp', '_tmp',
    '.understand-anything', '.speclinker',
))

# 매니페스트 → 추출 핸들러 매핑
MANIFEST_FILES = (
    'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle',
    'package.json',
    'go.mod', 'go.sum',
    'requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile',
    'Cargo.toml',
    'composer.json',
    'Gemfile', 'Gemfile.lock',
    'mix.exs',
    'pubspec.yaml',
)
MANIFEST_GLOBS = ('*.csproj', '*.fsproj', '*.vbproj')


def is_ignored_dir(name: str) -> bool:
    return name in IGNORE_DIRS or name.startswith('.')


def scan_workspace(root: str, max_depth: int = 10):
    """워크스페이스를 walk 하면서 디렉토리 트리/확장자 분포/매니페스트 후보를 수집"""
    root = os.path.abspath(root)
    depth_dirs = []     # depth ≤ 2 디렉토리 (도메인 분할 인식용)
    dir_keywords = Counter()
    ext_counter = Counter()
    manifest_paths = []

    for dirpath, dirnames, filenames in os.walk(root):
        # ignore 디렉토리 제거 (in-place)
        dirnames[:] = [d for d in dirnames if not is_ignored_dir(d)]

        rel = os.path.relpath(dirpath, root).replace('\\', '/')
        if rel == '.':
            rel = ''
        depth = 0 if not rel else rel.count('/') + 1

        if depth <= 2 and rel:
            depth_dirs.append(rel)
        # 디렉토리명 키워드 (architecture 신호: domain, adapter, application, ports, ...)
        if rel:
            for seg in rel.split('/'):
                seg_lower = seg.lower()
                if 2 <= len(seg_lower) <= 30 and not seg_lower.startswith('_'):
                    dir_keywords[seg_lower] += 1

        # max_depth 넘으면 walk 중단 (성능)
        if depth >= max_depth:
            dirnames[:] = []

        for fn in filenames:
            ext = os.path.splitext(fn)[1].lower()
            if ext:
                ext_counter[ext] += 1
            if fn in MANIFEST_FILES:
                manifest_paths.append(os.path.join(dirpath, fn))
            else:
                for pat in MANIFEST_GLOBS:
                    if pat.startswith('*') and fn.endswith(pat[1:]):
                        manifest_paths.append(os.path.join(dirpath, fn))
                        break

    return {
        'directory_tree': sorted(depth_dirs)[:200],
        'directory_keywords': dict(dir_keywords.most_common(50)),
        'extension_distribution': dict(ext_counter.most_common(30)),
        'manifest_paths': sorted(manifest_paths),
    }


# ────────────────────────────────────────────────────────────
# 매니페스트별 의존성 추출
# ────────────────────────────────────────────────────────────

def parse_pom_xml(path: str) -> dict:
    try:
        body = open(path, encoding='utf-8', errors='ignore').read()
    except Exception:
        return {}
    deps = re.findall(
        r'<dependency>\s*<groupId>([^<]+)</groupId>\s*<artifactId>([^<]+)</artifactId>',
        body)
    return {'dependencies': [f'{g}:{a}' for g, a in deps[:80]]}


def parse_gradle(path: str) -> dict:
    try:
        body = open(path, encoding='utf-8', errors='ignore').read()
    except Exception:
        return {}
    deps = re.findall(
        r"""(?:implementation|api|compile|runtimeOnly|testImplementation)\s*[\(\s]['"]([^'"]+)['"]""",
        body)
    return {'dependencies': deps[:80]}


def parse_package_json(path: str) -> dict:
    try:
        data = json.load(open(path, encoding='utf-8'))
    except Exception:
        return {}
    return {
        'name':             data.get('name', ''),
        'dependencies':     data.get('dependencies', {}),
        'devDependencies':  data.get('devDependencies', {}),
        'scripts':          data.get('scripts', {}),
        'type':             data.get('type', ''),
    }


def parse_go_mod(path: str) -> dict:
    try:
        body = open(path, encoding='utf-8', errors='ignore').read()
    except Exception:
        return {}
    module_m = re.search(r'^module\s+(\S+)', body, re.M)
    requires = re.findall(r'^\s*([\w./-]+)\s+v[\w.-]+', body, re.M)
    return {
        'module':       module_m.group(1) if module_m else '',
        'dependencies': sorted(set(requires))[:80],
    }


def parse_requirements_txt(path: str) -> dict:
    try:
        body = open(path, encoding='utf-8', errors='ignore').read()
    except Exception:
        return {}
    deps = []
    for line in body.splitlines():
        line = line.strip()
        if line and not line.startswith('#'):
            m = re.match(r'^([\w.\-_]+)', line)
            if m:
                deps.append(m.group(1).lower())
    return {'dependencies': deps[:80]}


def parse_pyproject(path: str) -> dict:
    try:
        body = open(path, encoding='utf-8', errors='ignore').read()
    except Exception:
        return {}
    # [tool.poetry.dependencies] 또는 [project] dependencies 블록 단순 추출
    deps = re.findall(r'^\s*([\w-]+)\s*=\s*["\^~\d.,*\s]', body, re.M)
    return {'dependencies': sorted(set(deps))[:80]}


def parse_cargo_toml(path: str) -> dict:
    try:
        body = open(path, encoding='utf-8', errors='ignore').read()
    except Exception:
        return {}
    in_deps = False
    deps = []
    for line in body.splitlines():
        s = line.strip()
        if s.startswith('['):
            in_deps = s.lower() in ('[dependencies]', '[dev-dependencies]')
            continue
        if in_deps:
            m = re.match(r'^([\w-]+)\s*=', s)
            if m:
                deps.append(m.group(1))
    return {'dependencies': sorted(set(deps))[:80]}


def parse_composer_json(path: str) -> dict:
    try:
        data = json.load(open(path, encoding='utf-8'))
    except Exception:
        return {}
    return {
        'name': data.get('name', ''),
        'dependencies': data.get('require', {}),
    }


def parse_gemfile(path: str) -> dict:
    try:
        body = open(path, encoding='utf-8', errors='ignore').read()
    except Exception:
        return {}
    deps = re.findall(r"""gem\s+['"]([^'"]+)['"]""", body)
    return {'dependencies': deps[:80]}


def parse_mix_exs(path: str) -> dict:
    try:
        body = open(path, encoding='utf-8', errors='ignore').read()
    except Exception:
        return {}
    deps = re.findall(r'\{\s*:(\w+)\s*,', body)
    return {'dependencies': sorted(set(deps))[:80]}


def parse_csproj(path: str) -> dict:
    try:
        body = open(path, encoding='utf-8', errors='ignore').read()
    except Exception:
        return {}
    pkgs = re.findall(r'<PackageReference\s+Include="([^"]+)"', body)
    return {'dependencies': pkgs[:80]}


MANIFEST_PARSERS = {
    'pom.xml':           parse_pom_xml,
    'build.gradle':      parse_gradle,
    'build.gradle.kts':  parse_gradle,
    'settings.gradle':   parse_gradle,
    'package.json':      parse_package_json,
    'go.mod':            parse_go_mod,
    'requirements.txt':  parse_requirements_txt,
    'pyproject.toml':    parse_pyproject,
    'Cargo.toml':        parse_cargo_toml,
    'composer.json':     parse_composer_json,
    'Gemfile':           parse_gemfile,
    'mix.exs':           parse_mix_exs,
}


def _safe_relpath(p: str, start: str) -> str:
    """Windows에서 다른 드라이브일 때 relpath가 ValueError. 그 경우 절대 경로 그대로 반환."""
    try:
        return os.path.relpath(p, start).replace('\\', '/')
    except ValueError:
        return p.replace('\\', '/')


def parse_manifests(paths: list, workspace_root: str = '') -> dict:
    """매니페스트 파일들을 각자 핸들러로 파싱.

    workspace_root: 결과 path를 이 디렉토리 기준 상대경로로 정규화 (선택).
    """
    results = {}
    for p in paths:
        fn = os.path.basename(p)
        parser = MANIFEST_PARSERS.get(fn)
        if parser is None:
            # *.csproj 같은 글로브 매칭
            if fn.endswith(('.csproj', '.fsproj', '.vbproj')):
                parser = parse_csproj
                fn = 'csproj'  # 키 통합
        if not parser:
            continue
        # path 정규화 (cwd가 다른 드라이브여도 안전)
        try:
            entry = {'path': _safe_relpath(p, workspace_root or os.path.dirname(p))}
            parsed = parser(p)
            if isinstance(parsed, dict):
                entry.update(parsed)
            results.setdefault(fn, []).append(entry)
        except Exception as e:
            # 파싱 실패해도 path는 기록
            results.setdefault(fn, []).append({
                'path': _safe_relpath(p, workspace_root or os.path.dirname(p)),
                'error': str(e),
            })
    return results


# ────────────────────────────────────────────────────────────
# UA knowledge-graph 요약 (있을 때만)
# ────────────────────────────────────────────────────────────

def summarize_ua_graph(workspace_root: str) -> dict:
    """UA가 만든 knowledge-graph.json 요약 (없으면 빈 dict)"""
    candidates = [
        os.path.join(workspace_root, '.understand-anything', 'knowledge-graph.json'),
    ]
    # source별 그래프도 확인
    ua_dir = os.path.join(workspace_root, '.understand-anything')
    if os.path.isdir(ua_dir):
        for f in os.listdir(ua_dir):
            if f.startswith('knowledge-graph') and f.endswith('.json'):
                p = os.path.join(ua_dir, f)
                if p not in candidates:
                    candidates.append(p)

    summary = {'graphs': []}
    for kg_path in candidates:
        if not os.path.exists(kg_path):
            continue
        try:
            kg = json.load(open(kg_path, encoding='utf-8'))
        except Exception:
            continue
        nodes = kg.get('nodes', [])
        node_types = Counter()
        for n in nodes:
            t = (n.get('type') or n.get('nodeType') or 'unknown').lower()
            node_types[t] += 1
        summary['graphs'].append({
            'path':        os.path.relpath(kg_path, workspace_root).replace('\\', '/'),
            'total_nodes': len(nodes),
            'node_types':  dict(node_types.most_common(20)),
        })
    return summary


# ────────────────────────────────────────────────────────────
# 신호 추정 (indicators)
# ────────────────────────────────────────────────────────────

# 매니페스트 의존성 키워드 → 백엔드 프레임워크 매핑
FRAMEWORK_HINTS = {
    'java': {
        'spring-boot':  ['org.springframework.boot:', 'spring-boot-starter'],
        'quarkus':      ['io.quarkus:'],
        'micronaut':    ['io.micronaut:'],
        'ktor':         ['io.ktor:'],
        'play':         ['com.typesafe.play:'],
    },
    'python': {
        'fastapi':      ['fastapi'],
        'django':       ['django'],
        'flask':        ['flask'],
        'starlette':    ['starlette'],
        'aiohttp':      ['aiohttp'],
    },
    # 'node' framework: 특이성 높은 패턴(@scope/ 접두사 포함)을 먼저 검사해야
    # '@nestjs/platform-express' 같은 의존성에서 'express'가 잘못 매칭되는 false positive를 피한다.
    'node': {
        'nestjs':       ['@nestjs/core', '@nestjs/common'],
        'next':         ['next'],
        'nuxt':         ['nuxt'],
        'remix':        ['@remix-run/'],
        'astro':        ['astro'],
        'fastify':      ['fastify'],
        'koa':          ['koa'],
        'hapi':         ['@hapi/hapi'],
        'hono':         ['hono'],
        # express는 다른 NestJS 호환 패키지명에 substring 매칭되니 마지막에 검사
        'express':      ['express'],
    },
    'go': {
        'gin':          ['github.com/gin-gonic/gin'],
        'echo':         ['github.com/labstack/echo'],
        'fiber':        ['github.com/gofiber/fiber'],
        'chi':          ['github.com/go-chi/chi'],
    },
    'rust': {
        'axum':         ['axum'],
        'actix':        ['actix-web'],
        'rocket':       ['rocket'],
    },
    'csharp': {
        'aspnetcore':   ['Microsoft.AspNetCore'],
    },
    'ruby': {
        'rails':        ['rails'],
        'sinatra':      ['sinatra'],
    },
    'elixir': {
        'phoenix':      ['phoenix'],
    },
    'php': {
        'laravel':      ['laravel/framework'],
        'symfony':      ['symfony/'],
    },
}

PERSISTENCE_HINTS = {
    'jpa':          ['spring-boot-starter-data-jpa', 'hibernate-core'],
    'mybatis':      ['mybatis-spring-boot-starter', 'mybatis'],
    'jdbc-template':['spring-boot-starter-jdbc', 'spring-jdbc'],
    'sqlalchemy':   ['sqlalchemy'],
    'django-orm':   ['django'],
    'prisma':       ['@prisma/client', 'prisma'],
    'typeorm':      ['typeorm'],
    'sequelize':    ['sequelize'],
    'mongoose':     ['mongoose'],
    'gorm':         ['gorm.io/gorm'],
    'sqlx':         ['sqlx'],
    'diesel':       ['diesel'],
    'ef-core':      ['Microsoft.EntityFrameworkCore'],
    'activerecord': ['activerecord'],
    'ecto':         ['ecto'],
    'eloquent':     ['laravel/framework'],   # laravel = eloquent
    'doctrine':     ['doctrine/orm'],
}

FRONTEND_HINTS = {
    'react':    ['react'],
    'vue':      ['vue'],
    'svelte':   ['svelte'],
    'angular':  ['@angular/core'],
    'solid':    ['solid-js'],
    'qwik':     ['@builder.io/qwik'],
}

BATCH_HINTS = {
    'spring-batch': ['spring-boot-starter-batch', 'spring-batch'],
    'quartz':       ['quartz-scheduler', 'spring-boot-starter-quartz'],
    'celery':       ['celery'],
    'airflow':      ['apache-airflow'],
    'sidekiq':      ['sidekiq'],
    'bullmq':       ['bullmq'],
    'temporal':     ['temporalio', '@temporalio/'],
}


def _flatten_deps(manifests_parsed: dict) -> str:
    """모든 매니페스트의 의존성을 단일 검색 가능 문자열로 합친다"""
    parts = []
    for fname, entries in manifests_parsed.items():
        for entry in entries:
            for v in entry.values():
                if isinstance(v, str):
                    parts.append(v)
                elif isinstance(v, list):
                    parts.extend(str(x) for x in v)
                elif isinstance(v, dict):
                    parts.extend(str(k) for k in v.keys())
                    parts.extend(str(x) for x in v.values())
    return '\n'.join(parts).lower()


def _detect_lang(manifests_parsed: dict, ext_dist: dict) -> str:
    """가장 강한 백엔드 언어 신호 — JVM/Go/Rust/Python/Node 등 매니페스트 우선, 그 다음 확장자 비율.

    여러 언어가 한 repo에 섞여 있으면(예: ML 스크립트가 있는 Spring 백엔드)
    우선순위는 컴파일·서버 언어를 먼저 본다.
    """
    if 'pom.xml' in manifests_parsed or 'build.gradle' in manifests_parsed or 'build.gradle.kts' in manifests_parsed:
        return 'java'
    if 'go.mod' in manifests_parsed:
        return 'go'
    if 'Cargo.toml' in manifests_parsed:
        return 'rust'
    if 'composer.json' in manifests_parsed:
        return 'php'
    if 'Gemfile' in manifests_parsed:
        return 'ruby'
    if 'mix.exs' in manifests_parsed:
        return 'elixir'
    # Python 매니페스트
    if any(k in manifests_parsed for k in ('requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile')):
        return 'python'
    # Node 매니페스트
    if 'package.json' in manifests_parsed:
        return 'node'
    # C# .csproj
    if any(f.endswith(('.csproj', '.fsproj', '.vbproj')) for f in manifests_parsed):
        return 'csharp'
    # 매니페스트 없으면 확장자 비율
    py = ext_dist.get('.py', 0)
    js = ext_dist.get('.ts', 0) + ext_dist.get('.tsx', 0) + ext_dist.get('.js', 0) + ext_dist.get('.jsx', 0)
    if py > js and py > 0:
        return 'python'
    if js > 0:
        return 'node'
    if ext_dist.get('.cs', 0) > 0:
        return 'csharp'
    if ext_dist.get('.go', 0) > 0:
        return 'go'
    if ext_dist.get('.rs', 0) > 0:
        return 'rust'
    return 'unknown'


def _detect_framework(deps_blob: str, lang_group: str) -> str:
    table = FRAMEWORK_HINTS.get(lang_group, {})
    for fw, patterns in table.items():
        if any(p.lower() in deps_blob for p in patterns):
            return fw
    return ''


def _detect_many(deps_blob: str, table: dict) -> list:
    found = []
    for tech, patterns in table.items():
        if any(p.lower() in deps_blob for p in patterns):
            found.append(tech)
    return found


def _detect_arch_hints(dir_keywords: dict) -> list:
    """디렉토리 키워드로 아키텍처 추정 신호 (단정 아닌 hint)"""
    kw = set(dir_keywords.keys())
    hints = []
    # Hexagonal / Clean / Onion
    if {'domain', 'application', 'adapter'} <= kw:
        hints.append('hexagonal: domain+application+adapter 디렉토리 동시 존재')
    elif {'domain', 'application'} <= kw or {'domain', 'usecase'} <= kw:
        hints.append('clean/onion: domain+application 또는 usecase 디렉토리')
    elif {'ports', 'adapters'} <= kw or {'port', 'adapter'} <= kw:
        hints.append('hexagonal: ports/adapters 명시적')
    # DDD tactical
    if {'aggregate', 'aggregates'} & kw or {'value', 'valueobject'} & kw or {'domainevent'} & kw:
        hints.append('ddd-tactical: aggregate/valueobject/domainevent 디렉토리')
    # N-Tier
    if ({'controller', 'service', 'dao'} <= kw or
        {'controller', 'service', 'repository'} <= kw or
        {'controllers', 'services', 'repositories'} <= kw):
        hints.append('n-tier: controller+service+(dao|repository) 디렉토리')
    # FSD (frontend) — 6 슬라이스 중 features + entities + (widgets 또는 shared) 셋 이상 보이면 FSD 의심
    # 실제 FSD 프로젝트는 widgets/processes 슬라이스를 생략하는 경우 흔함.
    fsd_slices = {'features', 'entities', 'widgets', 'shared', 'pages', 'processes', 'app'}
    if len(fsd_slices & kw) >= 3 and {'features', 'entities'} & kw:
        hints.append('fsd-frontend: features/entities/widgets/shared 슬라이스')
    # Modular monolith
    if {'modules', 'module'} & kw and {'shared', 'common'} & kw:
        hints.append('modular-monolith: modules + shared 디렉토리')
    # 자체 컨벤션 (특이 키워드)
    custom = kw - {
        'src', 'main', 'test', 'tests', 'java', 'kotlin', 'resources', 'webapp',
        'app', 'public', 'static', 'assets', 'config', 'configs', 'lib', 'libs',
        'docs', 'doc', 'scripts', 'bin', 'build', 'pkg', 'cmd', 'internal',
        'com', 'org', 'net', 'io',
    }
    if not hints and custom:
        hints.append('arch: 표준 패턴 매칭 안 됨 — 자체 컨벤션 가능성')
    return hints


def build_indicators(manifests_parsed: dict, ext_dist: dict, dir_keywords: dict) -> dict:
    """매니페스트와 디렉토리 신호를 합쳐 추정 indicator를 만든다 (단정 아님)"""
    deps_blob = _flatten_deps(manifests_parsed)
    lang = _detect_lang(manifests_parsed, ext_dist)
    # lang_group: framework 테이블 키
    lang_group = {
        'java': 'java',
        'python': 'python',
        'node': 'node',
        'go': 'go',
        'rust': 'rust',
        'csharp': 'csharp',
        'ruby': 'ruby',
        'elixir': 'elixir',
        'php': 'php',
    }.get(lang, '')
    framework        = _detect_framework(deps_blob, lang_group)
    persistence      = _detect_many(deps_blob, PERSISTENCE_HINTS)
    frontend         = _detect_many(deps_blob, FRONTEND_HINTS)
    batch            = _detect_many(deps_blob, BATCH_HINTS)
    arch_hints       = _detect_arch_hints(dir_keywords)
    return {
        'likely_backend_lang':       lang,
        'likely_backend_framework':  framework or None,
        'likely_persistence':        persistence,
        'likely_frontend_framework': frontend[0] if frontend else None,
        'likely_batch':              batch,
        'architecture_hints':        arch_hints,
    }


# ────────────────────────────────────────────────────────────
# 메인
# ────────────────────────────────────────────────────────────

def probe(workspace_root: str) -> dict:
    workspace_root = os.path.abspath(workspace_root)
    scan = scan_workspace(workspace_root)
    manifests_parsed = parse_manifests(scan['manifest_paths'], workspace_root)
    ua = summarize_ua_graph(workspace_root)
    indicators = build_indicators(
        manifests_parsed, scan['extension_distribution'], scan['directory_keywords'])
    return {
        'workspace':             workspace_root.replace('\\', '/'),
        'manifests':             manifests_parsed,
        'directory_tree':        scan['directory_tree'],
        'directory_keywords':    scan['directory_keywords'],
        'extension_distribution':scan['extension_distribution'],
        'ua_graph_summary':      ua,
        'indicators':            indicators,
    }


def main():
    parser = argparse.ArgumentParser(description='Static probe of project for stack/architecture signals')
    parser.add_argument('workspace_root', help='워크스페이스 루트 경로')
    parser.add_argument('--out', default='', help='출력 경로 (기본: <workspace>/_tmp/probe.json)')
    args = parser.parse_args()

    result = probe(args.workspace_root)

    out_path = args.out or os.path.join(args.workspace_root, '_tmp', 'probe.json')
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    json.dump(result, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

    ind = result['indicators']
    summary_line = (
        f"probe.json 저장: {out_path}\n"
        f"  매니페스트: {len(result['manifests'])}종, "
        f"디렉토리 트리: {len(result['directory_tree'])}개, "
        f"확장자 종류: {len(result['extension_distribution'])}\n"
        f"  추정 신호: lang={ind['likely_backend_lang']} "
        f"framework={ind['likely_backend_framework']} "
        f"persistence={ind['likely_persistence']} "
        f"frontend={ind['likely_frontend_framework']} "
        f"batch={ind['likely_batch']}\n"
        f"  아키텍처 hint: {ind['architecture_hints']}"
    )
    print(summary_line)


if __name__ == '__main__':
    main()
