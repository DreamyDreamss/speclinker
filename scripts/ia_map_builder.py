#!/usr/bin/env python3
"""
ia_map_builder.py
screen_inventory.json + INF 파일 frontmatter + UIS spec 파일을 조합해서
IA(Information Architecture) 맵 JSON을 생성하는 스크립트.

Usage: python3 ia_map_builder.py <workspace_dir>
  workspace_dir : project.env / docs/ / _tmp/ 가 있는 디렉토리
Output: _tmp/ia-map.json 에 저장 + 요약 stdout
"""

import json
import os
import re
import sys
import glob
import datetime

# ── 인자 처리 ─────────────────────────────────────────────────────────────────
workspace_dir = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.getcwd()
os.makedirs(os.path.join(workspace_dir, '_tmp'), exist_ok=True)

# ── project.env에서 프로젝트명 읽기 ──────────────────────────────────────────
def read_project_name(wdir):
    env_path = os.path.join(wdir, 'project.env')
    if not os.path.exists(env_path):
        return os.path.basename(wdir)
    try:
        with open(env_path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line.startswith('#') or '=' not in line:
                    continue
                k, v = line.split('=', 1)
                if k.strip() in ('PROJECT_NAME', 'PROJECT_ID', 'APP_NAME'):
                    return v.strip().strip('"').strip("'")
    except Exception:
        pass
    return os.path.basename(wdir)

# ── YAML frontmatter 파싱 (pyyaml 없이 regex) ─────────────────────────────────
def parse_frontmatter(text):
    """
    --- 블록 안의 YAML을 최소한으로 파싱한다.
    지원 타입: 문자열, 숫자, 리스트([a, b, c] 한 줄 및 - item 여러 줄), null/TBD
    반환: dict (키-값). 파싱 실패 시 빈 dict.
    """
    m = re.match(r'^---\r?\n(.*?)\r?\n---', text, re.DOTALL)
    if not m:
        return {}
    block = m.group(1)
    result = {}
    lines = block.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        # 키: 값 형식
        km = re.match(r'^(\S[^:]*?):\s*(.*)', line)
        if not km:
            i += 1
            continue
        key = km.group(1).strip()
        val_raw = km.group(2).strip()

        # 인라인 리스트: [a, b, c]
        if val_raw.startswith('['):
            inner = re.sub(r'[\[\]]', '', val_raw)
            items = [_coerce(x.strip()) for x in inner.split(',') if x.strip()]
            result[key] = items
            i += 1
            continue

        # 빈 값 → 다음 줄이 "  - item" 형태이면 리스트
        if val_raw == '':
            items = []
            j = i + 1
            while j < len(lines) and re.match(r'^\s+-\s+(.*)', lines[j]):
                mm = re.match(r'^\s+-\s+(.*)', lines[j])
                items.append(_coerce(mm.group(1).strip()))
                j += 1
            if items:
                result[key] = items
                i = j
                continue
            result[key] = None
            i += 1
            continue

        result[key] = _coerce(val_raw)
        i += 1
    return result


def _coerce(s):
    """문자열을 적절한 Python 타입으로 변환"""
    if s in ('null', 'Null', 'NULL', 'TBD', '~', ''):
        return None
    if s in ('true', 'True', 'TRUE'):
        return True
    if s in ('false', 'False', 'FALSE'):
        return False
    try:
        return int(s)
    except ValueError:
        pass
    try:
        return float(s)
    except ValueError:
        pass
    # 따옴표 제거
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        return s[1:-1]
    return s


# ── UIS-ID 정규화 ─────────────────────────────────────────────────────────────
def normalize_uis_id(raw):
    """
    정수 1 → "UIS-F-001"
    "UIS-F-001" 형식이면 그대로
    숫자 문자열 "3" → "UIS-F-003"
    기타 문자열 → 그대로
    """
    if raw is None:
        return None
    if isinstance(raw, int):
        return f"UIS-F-{raw:03d}"
    s = str(raw).strip()
    if re.match(r'^UIS-[A-Z]-\d+$', s):
        return s
    if re.match(r'^\d+$', s):
        return f"UIS-F-{int(s):03d}"
    return s


# ── UIS spec 파일 경로 탐색 (여러 폴더 패턴 지원) ────────────────────────────
def find_spec_path(design_root, domain, uis_id):
    """
    UIS spec 파일을 여러 경로 패턴으로 탐색:
      1. docs/05_설계서/{domain}/{UIS-F-NNN}/spec.md  (디렉토리 구조)
      2. docs/05_설계서/{domain}/{UIS-F-NNN}.md        (flat 구조)
      3. docs/05_설계서/{domain}/UIS/{UIS-F-NNN}/spec.md
    존재하는 첫 번째 경로 반환. 없으면 패턴1 반환 (hasSpec=False로 처리).
    """
    candidates = [
        os.path.join(design_root, domain, uis_id, 'spec.md'),
        os.path.join(design_root, domain, f'{uis_id}.md'),
        os.path.join(design_root, domain, 'UIS', uis_id, 'spec.md'),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return candidates[0]


# ── spec.md에서 첫 번째 H1 제목 추출 ─────────────────────────────────────────
def extract_spec_title(spec_path):
    if not os.path.exists(spec_path):
        return None
    try:
        with open(spec_path, encoding='utf-8') as f:
            for line in f:
                m = re.match(r'^#\s+(.+)', line)
                if m:
                    return m.group(1).strip()
    except Exception:
        pass
    return None


# ── INF 파일 수집: {domain: [{inf-id, path, screens, method, path_url}]} ───────
def collect_inf_data(wdir, domains):
    """
    docs/05_설계서/{domain}/INF/INF-*.md 를 순회하며 frontmatter 파싱.
    반환: {domain: [{"infId": "INF-001", "screens": [...], ...}]}
    """
    design_root = os.path.join(wdir, 'docs', '05_설계서')
    inf_by_domain = {}

    for domain in domains:
        inf_dir = os.path.join(design_root, domain, 'INF')
        if not os.path.isdir(inf_dir):
            inf_by_domain[domain] = []
            continue
        entries = []
        for md_path in sorted(glob.glob(os.path.join(inf_dir, 'INF-*.md'))):
            try:
                with open(md_path, encoding='utf-8') as f:
                    content = f.read(4096)  # frontmatter만 읽으면 충분
            except Exception:
                continue
            fm = parse_frontmatter(content)
            inf_id = fm.get('inf-id') or fm.get('infId') or fm.get('id')
            if not inf_id:
                # 파일명에서 추출
                inf_id = os.path.splitext(os.path.basename(md_path))[0]
            screens = fm.get('screens', [])
            if screens is None:
                screens = []
            if isinstance(screens, str):
                screens = [screens]
            entries.append({
                'infId': str(inf_id),
                'method': fm.get('method'),
                'pathUrl': fm.get('path'),
                'screens': [str(s) for s in screens if s],
                'mdPath': md_path,
            })
        inf_by_domain[domain] = entries
    return inf_by_domain


# ── route에서 마지막 세그먼트 추출 ────────────────────────────────────────────
def route_last_segment(route):
    """'/order/claimInfo/or436mForm' → 'or436mForm'"""
    parts = [p for p in route.split('/') if p]
    return parts[-1] if parts else ''


# ── route에서 메뉴 계층 추출 ─────────────────────────────────────────────────
def route_menu_path(route, domain):
    """
    '/order/claimInfo/or436mForm' + domain='order'
    → ['claimInfo']  (도메인 다음부터, 화면 세그먼트 제외)
    '/order/claimInfo/subMenu/screenName' → ['claimInfo', 'subMenu']
    """
    parts = [p for p in route.split('/') if p]
    # 도메인 세그먼트 이후
    try:
        idx = parts.index(domain)
        after = parts[idx + 1:]
    except ValueError:
        after = parts[1:]  # fallback: 첫 세그먼트 제거

    # 마지막 세그먼트는 화면 자체이므로 제외
    menu_parts = after[:-1] if len(after) > 1 else []
    return menu_parts


# ── menuTree에 화면 삽입 ─────────────────────────────────────────────────────
def insert_into_menu_tree(tree, menu_parts, screen_entry):
    """
    menu_parts = ['claimInfo'] → tree['claimInfo']['screens'].append(...)
    menu_parts = ['a', 'b']   → tree['a']['children']['b']['screens'].append(...)
    menu_parts = []            → tree['_root']['screens'].append(...)
    """
    if not menu_parts:
        node = tree.setdefault('_root', {'label': '(메뉴 외)', 'screens': []})
        node['screens'].append(screen_entry)
        return

    node = tree
    for i, part in enumerate(menu_parts):
        if part not in node:
            node[part] = {'label': part, 'screens': [], 'children': {}}
        if i < len(menu_parts) - 1:
            node = node[part].setdefault('children', {})
        else:
            node[part]['screens'].append(screen_entry)


# ── 메인 처리 ─────────────────────────────────────────────────────────────────
def main():
    inv_path  = os.path.join(workspace_dir, '_tmp', 'screen_inventory.json')
    plan_path = os.path.join(workspace_dir, 'docs', '05_설계서', '_domain_plan.json')
    out_path  = os.path.join(workspace_dir, '_tmp', 'ia-map.json')

    project_name = read_project_name(workspace_dir)
    generated_at = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')

    # ── screen_inventory.json 로드 ────────────────────────────────────────────
    if not os.path.exists(inv_path):
        print(f'[WARNING] screen_inventory.json 없음: {inv_path}', file=sys.stderr)
        print('[IA Map] 빈 ia-map.json을 생성합니다.', file=sys.stderr)
        empty = {
            'project': project_name,
            'generated': generated_at,
            'totalScreens': 0,
            'totalApis': 0,
            'domains': [],
            'matrix': {'screens': [], 'apis': [], 'links': []},
        }
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(empty, f, ensure_ascii=False, indent=2)
        print(f'저장: _tmp/ia-map.json')
        return

    with open(inv_path, encoding='utf-8') as f:
        inventory = json.load(f)

    # ── _domain_plan.json 로드 (도메인 목록) ──────────────────────────────────
    domains_list = []
    if os.path.exists(plan_path):
        try:
            plan = json.load(open(plan_path, encoding='utf-8'))
            # 다양한 구조 지원
            if isinstance(plan, list):
                domains_list = [d.get('name') or d.get('domain') or d for d in plan if d]
            elif isinstance(plan, dict):
                domains_list = (
                    plan.get('domains')
                    or plan.get('domainList')
                    or list(plan.keys())
                )
                if domains_list and isinstance(domains_list[0], dict):
                    domains_list = [d.get('name') or d.get('domain') for d in domains_list]
        except Exception as e:
            print(f'[WARNING] _domain_plan.json 파싱 오류: {e}', file=sys.stderr)

    # 인벤토리에서 도메인 보완
    inv_domains = set()
    for entry in inventory:
        d = entry.get('domain')
        if d:
            inv_domains.add(d)
    if not domains_list:
        domains_list = sorted(inv_domains)
    else:
        # plan에 없는 도메인도 포함
        plan_set = set(str(d) for d in domains_list if d)
        domains_list = [str(d) for d in domains_list if d] + sorted(inv_domains - plan_set)

    domains_list = [str(d) for d in domains_list if d]

    # ── INF 데이터 수집 ───────────────────────────────────────────────────────
    inf_by_domain = collect_inf_data(workspace_dir, domains_list)

    # ── screens: 마지막 세그먼트 → INF 매핑 인덱스 ───────────────────────────
    # {domain: {screen_segment: [infId, ...]}}
    segment_to_inf = {}
    for domain, inf_list in inf_by_domain.items():
        seg_map = {}
        for inf_entry in inf_list:
            for seg in inf_entry['screens']:
                seg_map.setdefault(seg, []).append(inf_entry['infId'])
        segment_to_inf[domain] = seg_map

    # ── 도메인별 처리 ─────────────────────────────────────────────────────────
    design_root = os.path.join(workspace_dir, 'docs', '05_설계서')
    domain_results = []
    all_uis_ids = []
    all_inf_ids_global = set()
    matrix_links = []

    # 인벤토리를 도메인별로 그룹화
    inv_by_domain = {}
    for entry in inventory:
        d = entry.get('domain', '_unknown')
        inv_by_domain.setdefault(d, []).append(entry)

    for domain in domains_list:
        screen_entries = inv_by_domain.get(domain, [])
        inf_list = inf_by_domain.get(domain, [])
        seg_map = segment_to_inf.get(domain, {})

        menu_tree = {}
        domain_inf_ids = set()

        for entry in screen_entries:
            route = entry.get('route', '')
            raw_uis = entry.get('uisId')
            uis_id = normalize_uis_id(raw_uis)
            entry_file = entry.get('entryFile', '')
            source = entry.get('source', '')

            # 마지막 세그먼트로 INF 연결
            seg = route_last_segment(route)
            inf_ids = seg_map.get(seg, [])
            domain_inf_ids.update(inf_ids)

            # matrix 링크 등록
            if uis_id:
                for inf_id in inf_ids:
                    matrix_links.append({'uisId': uis_id, 'infId': inf_id})

            # spec.md 경로 및 제목
            spec_path = ''
            title = seg  # fallback
            has_spec = False
            if uis_id:
                spec_path = find_spec_path(design_root, domain, uis_id)
                extracted = extract_spec_title(spec_path)
                if extracted:
                    title = extracted
                    has_spec = True
                # 상대 경로로 저장 (workspace 기준)
                try:
                    spec_path_rel = os.path.relpath(spec_path, workspace_dir).replace('\\', '/')
                except ValueError:
                    spec_path_rel = spec_path.replace('\\', '/')
            else:
                spec_path_rel = ''

            screen_entry = {
                'uisId': uis_id,
                'title': title,
                'route': route,
                'specPath': spec_path_rel,
                'entryFile': entry_file,
                'infList': inf_ids,
                'hasSpec': has_spec,
                'source': source,
            }

            if uis_id:
                all_uis_ids.append(uis_id)

            # menuTree 삽입
            menu_parts = route_menu_path(route, domain)
            insert_into_menu_tree(menu_tree, menu_parts, screen_entry)

        all_inf_ids_global.update(inf_id for inf_entry in inf_list for inf_id in [inf_entry['infId']])

        domain_result = {
            'name': domain,
            'screenCount': len(screen_entries),
            'infCount': len(inf_list),
            'menuTree': menu_tree,
        }
        domain_results.append(domain_result)

        total_links = sum(len(s.get('infList', [])) for entries in _walk_screens(menu_tree) for s in [entries])
        print(f'[IA Map] {domain}: 화면 {len(screen_entries)}개, INF 연결 {total_links}건')

    # ── matrix 전체 집계 ─────────────────────────────────────────────────────
    all_apis = sorted(all_inf_ids_global)
    total_screens = sum(d['screenCount'] for d in domain_results)
    total_links_global = len(matrix_links)

    # ── infMeta: {infId → {domain, path}} for IAView direct path resolution ──
    inf_meta = {}
    for domain, inf_list in inf_by_domain.items():
        for inf_entry in inf_list:
            try:
                rel = os.path.relpath(inf_entry['mdPath'], workspace_dir).replace('\\', '/')
            except ValueError:
                rel = inf_entry['mdPath'].replace('\\', '/')
            inf_meta[inf_entry['infId']] = {'domain': domain, 'path': rel}

    ia_map = {
        'project': project_name,
        'generated': generated_at,
        'totalScreens': total_screens,
        'totalApis': len(all_apis),
        'domains': domain_results,
        'matrix': {
            'screens': all_uis_ids,
            'apis': all_apis,
            'links': matrix_links,
        },
        'infMeta': inf_meta,
    }

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(ia_map, f, ensure_ascii=False, indent=2)

    print(f'[IA Map] 전체: 화면 {total_screens}개, API 연결 총 {total_links_global}건')
    print(f'저장: _tmp/ia-map.json')


# ── menuTree 순회 헬퍼 ────────────────────────────────────────────────────────
def _walk_screens(menu_tree):
    """menuTree 안의 모든 screen entry를 yield"""
    for node_key, node_val in menu_tree.items():
        if not isinstance(node_val, dict):
            continue
        for screen in node_val.get('screens', []):
            yield screen
        children = node_val.get('children', {})
        if children:
            yield from _walk_screens(children)


if __name__ == '__main__':
    main()
