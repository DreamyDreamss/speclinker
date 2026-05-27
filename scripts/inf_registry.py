# STATUS: 완료
#!/usr/bin/env python3
"""
inf_registry.py — Phase 7.2 (INF Registry)
URL+method를 SSoT로 하는 INF 레지스트리. 같은 URL+method = 같은 INF-ID 보장.

레지스트리 위치: .speclinker/inf_registry.json  (workspace 기준)

모듈 API:
    registry = load(workspace)
    inf_id   = upsert(registry, method, url, domain='', source='', screen_id=None)
    entry    = lookup(registry, method, url)          # dict or None
    save(registry, workspace)

CLI:
    python inf_registry.py upsert   <workspace> --method GET --url /api/orders [--domain order] [--source capture] [--screen UIS-F-001]
    python inf_registry.py lookup   <workspace> --method GET --url /api/orders
    python inf_registry.py list     <workspace> [--domain order]
    python inf_registry.py import   <workspace> --widgets <widgets.json> --screen <UIS-F-001>
"""

import os
import re
import json
import argparse
from datetime import datetime, timezone

REGISTRY_SUBPATH = os.path.join('.speclinker', 'inf_registry.json')

# ── URL 정규화 ────────────────────────────────────────────────────────────────

_PARAM_PATTERNS = [
    re.compile(r':([A-Za-z_][A-Za-z0-9_]*)'),    # Express :id
    re.compile(r'\{([A-Za-z_][A-Za-z0-9_]*)\}'),  # Spring/FastAPI {id}
    re.compile(r'\[([A-Za-z_][A-Za-z0-9_]*)\]'),  # Next.js [id]
]


def normalize_url(url):
    """경로 파라미터를 {param} 형식으로 통일. 쿼리스트링 제거."""
    url = url.split('?')[0].rstrip('/')
    for pat in _PARAM_PATTERNS:
        url = pat.sub(r'{\1}', url)
    return url or '/'


def registry_key(method, url):
    """레지스트리 인덱스 키: 'GET /api/orders/{id}'"""
    return f'{method.upper()} {normalize_url(url)}'


# ── 파일 I/O ──────────────────────────────────────────────────────────────────

def _registry_path(workspace):
    return os.path.join(workspace, REGISTRY_SUBPATH)


def load(workspace):
    """레지스트리 로드. 없으면 빈 레지스트리 반환."""
    path = _registry_path(workspace)
    if os.path.exists(path):
        try:
            return json.load(open(path, encoding='utf-8'))
        except Exception:
            pass
    return {
        "version": 1,
        "updated_at": "",
        "entries": [],
        "_index": {},
    }


def save(registry, workspace):
    """레지스트리를 .speclinker/inf_registry.json 에 저장."""
    path = _registry_path(workspace)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    registry['updated_at'] = datetime.now(timezone.utc).astimezone().isoformat()
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(registry, f, ensure_ascii=False, indent=2)


# ── INF-ID 채번 ───────────────────────────────────────────────────────────────

def _next_inf_id(registry):
    """현재 최대 INF-NNN + 1을 반환. 첫 항목이면 INF-001."""
    existing_nums = []
    for entry in registry.get('entries', []):
        m = re.match(r'INF-(\d+)', entry.get('inf_id', ''))
        if m:
            existing_nums.append(int(m.group(1)))
    # _index 에도 있을 수 있으므로 거기도 확인
    for inf_id in registry.get('_index', {}).values():
        m = re.match(r'INF-(\d+)', inf_id)
        if m:
            existing_nums.append(int(m.group(1)))
    n = max(existing_nums, default=0) + 1
    return f'INF-{n:03d}'


# ── 핵심 CRUD ─────────────────────────────────────────────────────────────────

def lookup(registry, method, url):
    """method+url로 기존 INF 항목 반환. 없으면 None."""
    key = registry_key(method, url)
    inf_id = registry.get('_index', {}).get(key)
    if not inf_id:
        return None
    for entry in registry.get('entries', []):
        if entry.get('inf_id') == inf_id:
            return entry
    return None


def upsert(registry, method, url, domain='', source='', screen_id=None, description=''):
    """
    URL+method 기준으로 INF 항목을 추가하거나 갱신.
    - 신규: INF-ID 채번, entries에 추가, _index에 등록
    - 기존: screen_id / domain / description 보완만 (INF-ID 불변)
    screen_id: 이 INF를 사용하는 화면 ID (예: 'UIS-F-001'), 없으면 None
    반환: INF-ID
    """
    entry = lookup(registry, method, url)
    now = datetime.now(timezone.utc).astimezone().isoformat()

    if entry is None:
        inf_id = _next_inf_id(registry)
        key = registry_key(method, url)
        entry = {
            "inf_id":        inf_id,
            "method":        method.upper(),
            "url":           normalize_url(url),
            "url_original":  url,
            "domain":        domain,
            "description":   description,
            "used_by_screens": [],
            "source":        source,
            "created_at":    now,
            "updated_at":    now,
        }
        registry.setdefault('entries', []).append(entry)
        registry.setdefault('_index', {})[key] = inf_id
    else:
        # 기존 항목 보완
        if domain and not entry.get('domain'):
            entry['domain'] = domain
        if description and not entry.get('description'):
            entry['description'] = description
        if source and not entry.get('source'):
            entry['source'] = source
        entry['updated_at'] = now

    # used_by_screens 추가
    if screen_id and screen_id not in entry.get('used_by_screens', []):
        entry.setdefault('used_by_screens', []).append(screen_id)

    return entry['inf_id']


def add_screen_usage(registry, inf_id, screen_id):
    """기존 INF 항목에 화면 참조 추가."""
    for entry in registry.get('entries', []):
        if entry.get('inf_id') == inf_id:
            if screen_id not in entry.get('used_by_screens', []):
                entry.setdefault('used_by_screens', []).append(screen_id)
            return True
    return False


def import_from_api_hints(registry, api_hints, screen_id='', domain=''):
    """
    capture.js가 생성한 api_hints[] 배열을 레지스트리에 일괄 등록.
    api_hints 형식: [{"url": "...", "method": "GET", "hint_type": "data-url"}, ...]
    또는 문자열 배열 ["/api/orders"] (method 불명 → GET으로 추정)
    반환: 등록된 INF-ID 목록
    """
    registered = []
    for hint in (api_hints or []):
        if isinstance(hint, str):
            url = hint
            method = 'GET'
        elif isinstance(hint, dict):
            url = hint.get('url', '')
            method = hint.get('method', 'GET')
        else:
            continue
        if not url:
            continue
        inf_id = upsert(
            registry, method, url,
            domain=domain, source='capture-api-hint', screen_id=screen_id,
        )
        registered.append(inf_id)
    return registered


def import_from_widgets_json(registry, widgets_path, screen_id='', domain=''):
    """
    capture.js가 생성한 widgets.json에서 api_hints를 읽어 레지스트리에 등록.
    widgets.json 형식: {"widgets": [{"api_hints": [...], ...}, ...]}
    또는 배열 [{...}, ...]
    """
    try:
        data = json.load(open(widgets_path, encoding='utf-8'))
    except Exception as e:
        print(f'[inf_registry] widgets.json 로드 실패: {e}')
        return []

    widgets = data.get('widgets', data) if isinstance(data, dict) else data
    if not isinstance(widgets, list):
        return []

    all_ids = []
    for widget in widgets:
        hints = widget.get('api_hints', [])
        if hints:
            ids = import_from_api_hints(registry, hints, screen_id=screen_id, domain=domain)
            all_ids.extend(ids)
    return all_ids


# ── CLI ───────────────────────────────────────────────────────────────────────

def _cmd_upsert(args):
    registry = load(args.workspace)
    inf_id = upsert(
        registry,
        method=args.method,
        url=args.url,
        domain=args.domain or '',
        source=args.source or '',
        screen_id=args.screen or None,
        description=args.desc or '',
    )
    save(registry, args.workspace)
    print(f'[inf_registry] {inf_id}  {args.method.upper()} {normalize_url(args.url)}')


def _cmd_lookup(args):
    registry = load(args.workspace)
    entry = lookup(registry, args.method, args.url)
    if entry:
        print(json.dumps(entry, ensure_ascii=False, indent=2))
    else:
        print(f'[inf_registry] 없음: {args.method.upper()} {normalize_url(args.url)}')


def _cmd_list(args):
    registry = load(args.workspace)
    entries = registry.get('entries', [])
    if args.domain:
        entries = [e for e in entries if e.get('domain') == args.domain]
    print(f'[inf_registry] {len(entries)}개')
    for e in entries:
        screens = ','.join(e.get('used_by_screens', [])) or '-'
        print(f'  {e["inf_id"]:8} {e["method"]:6} {e["url"]:40} screens={screens}')


def _cmd_import(args):
    registry = load(args.workspace)
    ids = import_from_widgets_json(
        registry, args.widgets,
        screen_id=args.screen or '',
        domain=args.domain or '',
    )
    save(registry, args.workspace)
    print(f'[inf_registry] {len(ids)}개 등록/갱신: {ids}')


def main():
    parser = argparse.ArgumentParser(description='INF Registry CLI')
    sub = parser.add_subparsers(dest='cmd')

    # upsert
    p = sub.add_parser('upsert', help='INF 항목 추가 또는 갱신')
    p.add_argument('workspace')
    p.add_argument('--method', required=True, help='HTTP method (GET/POST/...)')
    p.add_argument('--url', required=True, help='API URL')
    p.add_argument('--domain', default='')
    p.add_argument('--source', default='manual')
    p.add_argument('--screen', default=None, help='UIS-F-XXX')
    p.add_argument('--desc', default='')

    # lookup
    p = sub.add_parser('lookup', help='INF 항목 조회')
    p.add_argument('workspace')
    p.add_argument('--method', required=True)
    p.add_argument('--url', required=True)

    # list
    p = sub.add_parser('list', help='INF 목록 출력')
    p.add_argument('workspace')
    p.add_argument('--domain', default='')

    # import
    p = sub.add_parser('import', help='widgets.json에서 api_hints 일괄 등록')
    p.add_argument('workspace')
    p.add_argument('--widgets', required=True, help='widgets.json 경로')
    p.add_argument('--screen', default='', help='UIS-F-XXX')
    p.add_argument('--domain', default='')

    args = parser.parse_args()
    if not args.cmd:
        parser.print_help()
        return

    args.workspace = os.path.abspath(args.workspace)
    dispatch = {'upsert': _cmd_upsert, 'lookup': _cmd_lookup,
                'list': _cmd_list, 'import': _cmd_import}
    dispatch[args.cmd](args)


if __name__ == '__main__':
    main()
