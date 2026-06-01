# STATUS: 완료
#!/usr/bin/env python3
"""
func_context_bundle.py — FUNC-ID 기반 스펙 컨텍스트 번들러

Usage:
  python3 func_context_bundle.py FUNC-auth-001 [PROJECT_ROOT]
  python3 func_context_bundle.py --list [PROJECT_ROOT]   # 전체 FUNC 목록
  python3 func_context_bundle.py --ready [PROJECT_ROOT]  # INF 있고 코드 없는 FUNC

Output: stdout JSON
"""
import sys, os, json, re

def parse_project_env(root):
    env = {}
    env_path = os.path.join(root, 'project.env')
    if os.path.exists(env_path):
        for line in open(env_path, encoding='utf-8'):
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, _, v = line.partition('=')
                env[k.strip()] = v.strip()
    return env

def parse_func_map(root):
    """FUNC_MAP.md → {func_id: entry} dict"""
    func_map_path = os.path.join(root, 'docs/00_FUNC/FUNC_MAP.md')
    if not os.path.exists(func_map_path):
        return {}

    content = open(func_map_path, encoding='utf-8').read()
    entries = {}
    sections = re.split(r'\n(?=## FUNC-)', content)
    for sec in sections:
        m = re.match(r'## (FUNC-[\w-]+)\s*[—–\-]+\s*(.+)', sec)
        if not m:
            continue
        func_id   = m.group(1).strip()
        desc      = m.group(2).strip()
        entry = {'id': func_id, 'description': desc,
                 'req': [], 'srs': [], 'inf': [], 'sch': [], 'uis': [], 'status': '미구현'}

        for field, key in [('REQ', 'req'), ('SRS', 'srs'), ('INF', 'inf'),
                            ('SCH', 'sch'), ('UIS', 'uis')]:
            pat = re.search(rf'[-*]\s*\*\*{field}\*\*\s*:\s*(.+)', sec)
            if pat:
                raw = pat.group(1).strip().rstrip('\\')
                entry[key] = [x.strip() for x in re.split(r'[,\s]+', raw) if re.match(r'[A-Z]', x)]

        status_m = re.search(r'구현상태\s*:\s*(.+)', sec)
        if status_m:
            entry['status'] = status_m.group(1).strip()

        entries[func_id] = entry
    return entries

def _read_file(path):
    try:
        return open(path, encoding='utf-8').read()
    except Exception:
        return None

def find_inf_content(root, inf_ids):
    """INF-ID → 파일 내용 매핑"""
    result = {}
    design_root = os.path.join(root, 'docs', '05_설계서')

    for dirpath, _, filenames in os.walk(design_root):
        for fname in filenames:
            if not fname.endswith('.md'):
                continue
            for inf_id in inf_ids:
                if inf_id in fname:
                    content = _read_file(os.path.join(dirpath, fname))
                    if content:
                        result[inf_id] = content

    # API_Design.md 섹션 fallback
    api_md = os.path.join(design_root, 'API_Design.md')
    if os.path.exists(api_md):
        api_content = _read_file(api_md) or ''
        for inf_id in inf_ids:
            if inf_id not in result:
                pat = re.search(
                    rf'(#{1,3}\s*{re.escape(inf_id)}.+?)(?=\n#{1,3}\s|\Z)',
                    api_content, re.DOTALL)
                if pat:
                    result[inf_id] = pat.group(1)
    return result

def find_sch_content(root, sch_ids):
    result = {}
    db_md = os.path.join(root, 'docs', '05_설계서', 'DB_Schema.md')
    if os.path.exists(db_md):
        db_content = _read_file(db_md) or ''
        for sch_id in sch_ids:
            pat = re.search(
                rf'(#{1,3}\s*{re.escape(sch_id)}.+?)(?=\n#{1,3}\s|\Z)',
                db_content, re.DOTALL)
            if pat:
                result[sch_id] = pat.group(1)

    design_root = os.path.join(root, 'docs', '05_설계서')
    for dirpath, _, filenames in os.walk(design_root):
        for fname in filenames:
            if fname.startswith('DB_') and fname.endswith('.md'):
                c = _read_file(os.path.join(dirpath, fname)) or ''
                for sch_id in sch_ids:
                    if sch_id not in result and sch_id in c:
                        pat = re.search(
                            rf'(#{1,3}\s*{re.escape(sch_id)}.+?)(?=\n#{1,3}\s|\Z)',
                            c, re.DOTALL)
                        if pat:
                            result[sch_id] = pat.group(1)
    return result

def find_uis_content(root, uis_ids):
    result = {}
    ui_md = os.path.join(root, 'docs', '05_설계서', 'UI_Spec_v1.0.md')
    if os.path.exists(ui_md):
        c = _read_file(ui_md) or ''
        for uis_id in uis_ids:
            pat = re.search(
                rf'(#{1,3}\s*{re.escape(uis_id)}.+?)(?=\n#{1,3}\s|\Z)',
                c, re.DOTALL)
            if pat:
                result[uis_id] = pat.group(1)

    design_root = os.path.join(root, 'docs', '05_설계서')
    for dirpath, _, filenames in os.walk(design_root):
        for fname in filenames:
            if fname == 'spec.md':
                fpath = os.path.join(dirpath, fname)
                for uis_id in uis_ids:
                    if uis_id not in result and (uis_id in fpath or uis_id in dirpath):
                        c = _read_file(fpath)
                        if c:
                            result[uis_id] = c
    return result

def load_linked_func_cache(root):
    cache_path = os.path.join(root, '.understand-anything', 'linked-func-cache.json')
    if os.path.exists(cache_path):
        try:
            return json.load(open(cache_path, encoding='utf-8'))
        except Exception:
            pass
    return {}

def load_spec_graph(root):
    """gen_obsidian_index.py가 생성한 spec_graph.json 로드."""
    path = os.path.join(root, '_tmp', 'spec_graph.json')
    if os.path.exists(path):
        try:
            return json.load(open(path, encoding='utf-8'))
        except Exception:
            pass
    return {}

def expand_linked_ids(ids_dict, spec_graph):
    """spec_graph를 통해 UIS→INF→SCH 전이적 링크를 확장한다.
    체인: UIS-A → INF-B (UIS.linked.inf) → SCH-C (INF.linked.sch)
    역방향: INF → UIS (INF.linked.uis) 도 포함."""
    inf_set = set(ids_dict.get('inf', []))
    uis_set = set(ids_dict.get('uis', []))
    sch_set = set(ids_dict.get('sch', []))

    # UIS → linked INF
    for uis_id in list(uis_set):
        node = spec_graph.get(uis_id, {})
        for inf_id in node.get('linked', {}).get('inf', []):
            inf_set.add(inf_id)

    # INF → linked UIS (역방향)
    for inf_id in list(inf_set):
        node = spec_graph.get(inf_id, {})
        for uis_id in node.get('linked', {}).get('uis', []):
            uis_set.add(uis_id)

    # INF → linked SCH (전이적: UIS→INF→SCH 체인 완성)
    for inf_id in list(inf_set):
        node = spec_graph.get(inf_id, {})
        for sch_id in node.get('linked', {}).get('sch', []):
            sch_set.add(sch_id)

    return {
        **ids_dict,
        'inf': sorted(inf_set),
        'uis': sorted(uis_set),
        'sch': sorted(sch_set),
    }

def make_bundle(func_id, root, env, func_map):
    entry = func_map[func_id]

    # spec_graph로 링크 확장 (gen_obsidian_index 실행 후 사용 가능)
    spec_graph = load_spec_graph(root)
    ids = expand_linked_ids(
        {k: entry[k] for k in ['req', 'srs', 'inf', 'sch', 'uis']},
        spec_graph
    )

    inf_content = find_inf_content(root, ids['inf'])
    sch_content = find_sch_content(root, ids['sch'])
    uis_content = find_uis_content(root, ids['uis'])

    mode = env.get('MODE', 'GENESIS')
    if mode == 'RECON':
        annotation = f'linked_func: {func_id}'
    else:
        req_ids = ', '.join(entry['req']) if entry['req'] else func_id
        annotation = f'linked_req: {req_ids}'

    # 이미 구현된 파일 확인
    cache = load_linked_func_cache(root)
    implemented_files = [f for f, ids in cache.items() if func_id in ids]

    return {
        'func_id'     : func_id,
        'description' : entry['description'],
        'mode'        : mode,
        'status'      : entry['status'],
        'ids'         : ids,
        'spec_content': {'inf': inf_content, 'sch': sch_content, 'uis': uis_content},
        'annotation'  : annotation,
        'implemented_files': implemented_files,
        'spec_graph_used': bool(spec_graph),
    }

def main():
    args = sys.argv[1:]
    if not args:
        print('Usage: func_context_bundle.py <FUNC-ID | --list | --ready> [PROJECT_ROOT]',
              file=sys.stderr)
        sys.exit(1)

    cmd  = args[0]
    root = args[1] if len(args) > 1 else '.'
    env  = parse_project_env(root)
    func_map = parse_func_map(root)

    if not func_map:
        print(json.dumps({'error': 'FUNC_MAP.md 없음 — /sl-recon 또는 /sl-spec 먼저 실행'}),
              ensure_ascii=False)
        sys.exit(1)

    if cmd == '--list':
        print(json.dumps(
            [{'id': e['id'], 'description': e['description'],
              'status': e['status'],
              'has_inf': bool(e['inf']), 'has_sch': bool(e['sch'])}
             for e in func_map.values()],
            ensure_ascii=False, indent=2))
        return

    if cmd == '--ready':
        cache = load_linked_func_cache(root)
        implemented = {ids_item for ids_list in cache.values() for ids_item in ids_list}
        ready = [e for e in func_map.values()
                 if e['inf'] and e['id'] not in implemented]
        print(json.dumps(
            [{'id': e['id'], 'description': e['description'],
              'inf': e['inf'], 'sch': e['sch'], 'uis': e['uis']}
             for e in ready],
            ensure_ascii=False, indent=2))
        return

    func_id = cmd
    if func_id not in func_map:
        print(json.dumps({'error': f'{func_id} not found in FUNC_MAP'}),
              ensure_ascii=False)
        sys.exit(1)

    bundle = make_bundle(func_id, root, env, func_map)
    print(json.dumps(bundle, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
