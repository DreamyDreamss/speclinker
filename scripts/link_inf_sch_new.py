#!/usr/bin/env python3
"""link_inf_sch.py -- INF <-> SCH auto link"""
import sys, os, re, json

def _read(path):
    try:
        return open(path, encoding='utf-8').read()
    except Exception:
        return None

def build_sch_map(design_root):
    sch_map = {}
    if not os.path.isdir(design_root):
        return sch_map
    for dirpath, _, filenames in os.walk(design_root):
        for fname in filenames:
            if not (fname.startswith('DB_') and fname.endswith('.md')):
                continue
            content = _read(os.path.join(dirpath, fname))
            if not content:
                continue
            rel = os.path.relpath(dirpath, design_root)
            domain = rel.split(os.sep)[0] if rel != '.' else ''
            for m in re.finditer(r'^#{1,3}\s+(SCH-[\w-]+)\s*[:\-]+\s*([\w_]+)', content, re.MULTILINE):
                key = m.group(2).strip().lower()
                if key not in sch_map:
                    sch_map[key] = {'sch_id': m.group(1).strip(), 'domain': domain}
    return sch_map

def extract_tables_fm(content):
    fm_m = re.match(r'^---\s*\n(.*?)\n---', content, re.DOTALL)
    if not fm_m:
        return []
    tables, in_t = [], False
    for line in fm_m.group(1).split('\n'):
        s = line.strip()
        if re.match(r'^tables\s*:', s):
            in_t = True
            il = re.search(r'\[(.*?)\]', s)
            if il:
                tables = [t.strip().strip("\"'") for t in il.group(1).split(',') if t.strip()]
                in_t = False
        elif in_t:
            if s.startswith('-'):
                t = s.lstrip('-').strip().strip("\"'")
                if t: tables.append(t)
            elif s and not s.startswith('#'):
                in_t = False
    return tables

def update_ref_section(content, sch_map):
    linked = []
    def repl(m):
        new_rows = []
        for row in m.group(2).splitlines():
            rm = re.match(r'\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|', row)
            if rm:
                tbl, cell = rm.group(1).strip(), rm.group(2).strip()
                if cell == '[TBD]':
                    hit = sch_map.get(tbl.lower())
                    if hit:
                        cell = '[[' + hit['sch_id'] + ']]'
                        linked.append(hit['sch_id'])
                new_rows.append('| ' + tbl + ' | ' + cell + ' |')
            else:
                new_rows.append(row)
        return m.group(1) + '\n'.join(new_rows) + '\n'
    pat = re.compile(
        r'(## 참조 테이블\n\n\| 테이블 \| SCH \|\n\|[-| ]+\|\n)((?:\|[^|\n]+\|[^|\n]*\|\n?)*)',
        re.MULTILINE)
    return pat.sub(repl, content), linked

def update_spec_graph(graph_path, inf_id, sch_ids):
    if not os.path.exists(graph_path) or not sch_ids:
        return
    try:
        graph = json.load(open(graph_path, encoding='utf-8'))
    except Exception:
        return
    node = graph.setdefault(inf_id, {'type': 'inf', 'domain': '', 'path': '', 'linked': {}})
    lk = node.setdefault('linked', {})
    lk['sch'] = sorted(set(lk.get('sch', [])) | set(sch_ids))
    for sid in sch_ids:
        if sid in graph:
            sl = graph[sid].setdefault('linked', {})
            sl['inf'] = sorted(set(sl.get('inf', [])) | {inf_id})
    json.dump(graph, open(graph_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

def main():
    root = sys.argv[1] if len(sys.argv) > 1 else '.'
    design_root = os.path.join(root, 'docs', '05_설계서')
    graph_path  = os.path.join(root, '_tmp', 'spec_graph.json')

    sch_map = build_sch_map(design_root)
    if not sch_map:
        print('[WARN] SCH 테이블 맵 없음 -- ddd-db-agent 실행 후 재실행')
        return
    print('SCH 맵: ' + str(len(sch_map)) + '개 테이블')
    for k, v in list(sch_map.items())[:5]:
        print('  ' + k + ' -> ' + v['sch_id'])
    if len(sch_map) > 5:
        print('  ... 외 ' + str(len(sch_map)-5) + '개')
    print()

    linked_count = skip_count = already_count = 0
    for dirpath, _, filenames in os.walk(design_root):
        for fname in sorted(filenames):
            if not (fname.startswith('INF-') and fname.endswith('.md')):
                continue
            inf_path = os.path.join(dirpath, fname)
            inf_id = os.path.splitext(fname)[0]
            content = _read(inf_path)
            if not content:
                continue
            if '[[SCH-' in content and '[TBD]' not in content:
                already_count += 1
                continue
            if '참조 테이블' not in content:
                skip_count += 1
                continue
            new_content, sch_ids = update_ref_section(content, sch_map)
            if sch_ids:
                try:
                    open(inf_path, 'w', encoding='utf-8').write(new_content)
                    update_spec_graph(graph_path, inf_id, sch_ids)
                    print('  ' + inf_id + ' -> ' + ', '.join(sch_ids))
                    linked_count += 1
                except Exception as e:
                    print('  [ERROR] ' + inf_id + ': ' + str(e))
            else:
                tables = extract_tables_fm(content)
                missing = [t for t in tables if t.lower() not in sch_map]
                if missing:
                    print('  [미매칭] ' + inf_id + ': ' + str(missing))
                skip_count += 1

    print()
    print('완료: ' + str(linked_count) + '개 링크 | ' + str(already_count) + '개 완료 | ' + str(skip_count) + '개 스킵')

if __name__ == '__main__':
    main()
