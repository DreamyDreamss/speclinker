# STATUS: 완료
"""
build_si_graph.py — INF/UIS/SCH 스펙 파일 → si-graph.json 생성

스펙 노드(type: inf/uis/sch) + traces_to 엣지를 코드 파일/엔드포인트 노드로 연결.
SI view에서 스펙 ↔ 소스코드 연결 관계를 시각화하는 데 사용.

출력: .understand-anything/si-graph.json

사용:
  python3 build_si_graph.py [workspace]
"""

import json
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

WS = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')


def read_file(path):
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            return f.read()
    except Exception:
        return ''


def extract_source_refs(content):
    """스펙 파일에서 소스 코드 참조 추출 (근거 소스, endpoint, linked_func)."""
    refs = set()

    # 근거 소스: 파일경로
    for m in re.finditer(r'근거[_\s]소스[:\s]+([^\s\n|`,]+)', content):
        val = m.group(1).strip().rstrip('.')
        if val:
            refs.add(val)

    # frontmatter source_file / source_files
    for m in re.finditer(r'^source[_\s]files?[:\s]+([^\s\n|`,]+)', content, re.I | re.M):
        val = m.group(1).strip()
        if val:
            refs.add(val)

    # linked_func 주석 → FUNC-ID
    for m in re.finditer(r'linked[_\s]func[:\s]+(FUNC-[\w-]+)', content):
        refs.add(m.group(1).strip())

    # HTTP endpoint (GET /path, POST /path 등)
    for m in re.finditer(r'\b(?:GET|POST|PUT|DELETE|PATCH)\s+(\/[a-zA-Z0-9/_\-{}?=&%]+)', content):
        endpoint = m.group(1).strip()
        refs.add(endpoint)

    return refs


def build_si_graph(workspace):
    nodes = []
    edges = []
    node_ids = set()

    design_root = os.path.join(workspace, 'docs', '05_설계서')
    if not os.path.isdir(design_root):
        print(f'[WARNING] docs/05_설계서/ 없음 — {design_root}')
        return nodes, edges

    def add_node(node_id, label, node_type, file_path, domain=''):
        if node_id not in node_ids:
            node_ids.add(node_id)
            nodes.append({
                'id': node_id,
                'label': label,
                'type': node_type,
                'filePath': file_path,
                'summary': '',
                'complexity': 'simple',
                **({'domain': domain} if domain else {}),
            })

    def add_edge(source_id, target_id, label='traces_to'):
        edges.append({
            'source': source_id,
            'target': target_id,
            'label': label,
            'category': 'si-tracing',
        })

    for domain in sorted(os.listdir(design_root)):
        domain_dir = os.path.join(design_root, domain)
        if not os.path.isdir(domain_dir) or domain.startswith('_'):
            continue

        # INF 파일 (도메인 루트 + INF/ 서브디렉터리)
        inf_files = []
        for fname in os.listdir(domain_dir):
            if re.match(r'^INF-.+\.md$', fname):
                inf_files.append((fname, os.path.join(domain_dir, fname), f'docs/05_설계서/{domain}/{fname}'))
        inf_subdir = os.path.join(domain_dir, 'INF')
        if os.path.isdir(inf_subdir):
            for fname in sorted(os.listdir(inf_subdir)):
                if re.match(r'^INF-.+\.md$', fname):
                    inf_files.append((fname, os.path.join(inf_subdir, fname), f'docs/05_설계서/{domain}/INF/{fname}'))

        for fname, fpath, rel_path in inf_files:
            inf_id = fname[:-3]
            node_id = f'spec:{inf_id}'
            add_node(node_id, inf_id, 'inf', rel_path, domain)

            content = read_file(fpath)
            for ref in extract_source_refs(content):
                if ref.startswith('FUNC-'):
                    target_id = f'func:{ref}'
                    add_node(target_id, ref, 'endpoint', '', '')
                elif ref.startswith('/'):
                    target_id = f'endpoint:{ref}'
                    add_node(target_id, ref, 'endpoint', '', '')
                else:
                    target_id = f'file:{ref}'
                    add_node(target_id, os.path.basename(ref), 'file', ref, '')
                add_edge(node_id, target_id)

        # UIS 파일 — 현행 'UIS'(v3.9~) 우선, 구버전 'UI' 하위호환
        ui_subdir, ui_dirname = None, None
        for cand in ('UIS', 'UI'):
            p = os.path.join(domain_dir, cand)
            if os.path.isdir(p):
                ui_subdir, ui_dirname = p, cand
                break
        if ui_subdir:
            for screen_id in sorted(os.listdir(ui_subdir)):
                screen_dir = os.path.join(ui_subdir, screen_id)
                if not os.path.isdir(screen_dir):
                    continue
                spec_path = os.path.join(screen_dir, 'spec.md')
                if not os.path.isfile(spec_path):
                    continue
                rel_path = f'docs/05_설계서/{domain}/{ui_dirname}/{screen_id}/spec.md'
                node_id = f'spec:UIS-{screen_id}'
                add_node(node_id, screen_id, 'uis', rel_path, domain)

                content = read_file(spec_path)
                for ref in extract_source_refs(content):
                    if ref.startswith('FUNC-'):
                        target_id = f'func:{ref}'
                        add_node(target_id, ref, 'endpoint', '', '')
                    elif ref.startswith('/'):
                        target_id = f'endpoint:{ref}'
                        add_node(target_id, ref, 'endpoint', '', '')
                    else:
                        target_id = f'file:{ref}'
                        add_node(target_id, os.path.basename(ref), 'file', ref, '')
                    add_edge(node_id, target_id)

        # SCH 파일 (DB_*.md)
        for fname in sorted(os.listdir(domain_dir)):
            if not (fname.startswith('DB_') and fname.endswith('.md')):
                continue
            rel_path = f'docs/05_설계서/{domain}/{fname}'
            # DB 파일 내 SCH 섹션 헤더 파싱 → 개별 SCH 노드
            content = read_file(os.path.join(domain_dir, fname))
            sch_ids = re.findall(r'^## (SCH-\d+):', content, re.M)
            if sch_ids:
                for sch_id in sch_ids:
                    node_id = f'spec:{sch_id}'
                    add_node(node_id, sch_id, 'sch', rel_path, domain)
            else:
                # SCH 섹션 없으면 파일 자체를 단일 노드로
                node_id = f'spec:SCH-{domain}'
                add_node(node_id, f'SCH-{domain}', 'sch', rel_path, domain)

    return nodes, edges


def main():
    nodes, edges = build_si_graph(WS)

    spec_ids = [n['id'] for n in nodes if n['type'] in ('inf', 'uis', 'sch')]
    source_ids = [n['id'] for n in nodes if n['type'] not in ('inf', 'uis', 'sch')]

    si_graph = {
        'kind': 'si-tracing',
        'version': '1.0',
        'project': {
            'name': 'SI Tracing Graph',
            'root': os.path.basename(WS),
        },
        'nodes': nodes,
        'edges': edges,
        'layers': [
            {
                'id': 'spec-docs',
                'label': '스펙 문서',
                'description': 'INF/UIS/SCH 설계 문서',
                'nodeIds': spec_ids,
            },
            {
                'id': 'source-refs',
                'label': '소스 참조',
                'description': '연결된 소스 파일 / 엔드포인트',
                'nodeIds': source_ids,
            },
        ],
    }

    out_dir = os.path.join(WS, '.understand-anything')
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, 'si-graph.json')

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(si_graph, f, ensure_ascii=False, indent=2)

    print(f'[OK] si-graph.json 생성 — 노드 {len(nodes)}개 (스펙 {len(spec_ids)}, 소스 {len(source_ids)}), 엣지 {len(edges)}개')
    print(f'     → {out_path}')


if __name__ == '__main__':
    main()
