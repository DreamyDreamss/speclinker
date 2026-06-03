#!/usr/bin/env python3
"""
gen_docsify.py — speclinker 산출물 스캔 → spec_index.json 생성

Usage:
    python gen_docsify.py [spec_root]
    spec_root: project.env가 있는 프로젝트 루트. 기본값: 현재 디렉터리
"""
import os
import re
import json
import sys
from datetime import datetime


def _get_fm_block(content: str) -> str:
    """--- ... --- frontmatter 블록 문자열 반환. 없으면 빈 문자열."""
    content = content.replace('\r\n', '\n').replace('\r', '\n')
    m = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    return m.group(1) if m else ''


def parse_frontmatter(content: str) -> dict:
    """마크다운 YAML frontmatter를 {key: value} dict로 파싱."""
    fm = {}
    for line in _get_fm_block(content).splitlines():
        if ':' in line and not line.startswith(' ') and not line.startswith('-'):
            k, _, v = line.partition(':')
            k, v = k.strip(), v.strip()
            if k:
                fm[k] = v
    return fm


def _extract_list_field(fm_block: str, key: str) -> list:
    """frontmatter 블록에서 YAML 리스트 필드 추출."""
    result, in_list = [], False
    for line in fm_block.splitlines():
        if re.match(rf'^{re.escape(key)}:\s*$', line.rstrip()):
            in_list = True
            continue
        if in_list:
            stripped = line.strip()
            if stripped.startswith('- '):
                val = stripped[2:].split('#')[0].strip()
                if val:
                    result.append(val)
            elif stripped and not line.startswith(' '):
                break
    return result


def count_tbd(content: str) -> int:
    """frontmatter 이후 본문의 [TBD] 개수 반환."""
    content = content.replace('\r\n', '\n').replace('\r', '\n')
    fm_block = _get_fm_block(content)
    if fm_block:
        # frontmatter delimiter + block + delimiter length
        body = content[len('---\n') + len(fm_block) + len('\n---'):]
    else:
        body = content
    return len(re.findall(r'\[TBD\]', body))


def scan_infs(spec_root: str) -> list:
    """docs/05_설계서/INF/{domain}/INF-*.md 전수 스캔."""
    infs = []
    inf_root = os.path.join(spec_root, 'docs', '05_설계서', 'INF')
    if not os.path.isdir(inf_root):
        return infs
    for domain_dir in sorted(os.listdir(inf_root)):
        domain_path = os.path.join(inf_root, domain_dir)
        if not os.path.isdir(domain_path):
            continue
        for fname in sorted(os.listdir(domain_path)):
            if not (fname.endswith('.md') and fname.startswith('INF-')):
                continue
            fpath = os.path.join(domain_path, fname)
            try:
                with open(fpath, encoding='utf-8', errors='replace') as f:
                    content = f.read()
            except OSError:
                continue
            fm = parse_frontmatter(content)
            infs.append({
                'id': fm.get('inf-id', fname.replace('.md', '')),
                'method': fm.get('method', ''),
                'path': fm.get('path', ''),
                'domain': fm.get('domain', domain_dir),
                'domain_code': fm.get('domain-code', ''),
                'tbd_count': count_tbd(content),
                'file': os.path.relpath(fpath, spec_root).replace('\\', '/'),
            })
    return infs


def scan_uis(spec_root: str) -> list:
    """docs/05_설계서/UIS/{screen}/spec.md 전수 스캔."""
    uis = []
    uis_root = os.path.join(spec_root, 'docs', '05_설계서', 'UIS')
    if not os.path.isdir(uis_root):
        return uis
    for entry in sorted(os.listdir(uis_root)):
        spec_path = os.path.join(uis_root, entry, 'spec.md')
        if not os.path.isfile(spec_path):
            continue
        try:
            with open(spec_path, encoding='utf-8', errors='replace') as f:
                content = f.read()
        except OSError:
            continue
        fm = parse_frontmatter(content)
        fb = _get_fm_block(content)
        uis.append({
            'id': fm.get('UIS-ID', entry),
            'name': fm.get('화면명', ''),
            'route': fm.get('라우트', ''),
            'domain': fm.get('도메인', ''),
            'menu_path': _extract_list_field(fb, 'menu-path'),
            'apis': _extract_list_field(fb, 'apis'),
            'has_preview': os.path.isfile(os.path.join(uis_root, entry, 'preview.png')),
            'file': os.path.relpath(spec_path, spec_root).replace('\\', '/'),
        })
    return uis


def load_sprint_status(spec_root: str) -> dict:
    """sprint-status.yaml에서 도메인별 done/total 집계."""
    path = os.path.join(spec_root, '.speclinker', 'sprint-status.yaml')
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            content = f.read()
    except OSError:
        return {}
    stats, current = {}, None
    for line in content.splitlines():
        m = re.match(r'^([a-zA-Z][a-zA-Z0-9_-]*):\s*$', line)
        if m:
            current = m.group(1)
            stats.setdefault(current, {'done': 0, 'total': 0})
        sm = re.search(r'\bstatus:\s*(done|review|in-progress|backlog|ready(?:-for-dev)?)\b', line)
        if sm and current:
            stats[current]['total'] += 1
            if sm.group(1) == 'done':
                stats[current]['done'] += 1
    return stats


def build_ia_tree(uis: list) -> dict:
    """menu_path 기반 IA 트리 생성."""
    tree: dict = {}
    for ui in uis:
        path = [p for p in ui.get('menu_path', []) if p and p != '[TBD]']
        domain = ui.get('domain', 'unknown')
        screen = {'id': ui['id'], 'name': ui['name'], 'apis': ui.get('apis', [])}
        if not path:
            tree.setdefault(f'[{domain}]', {}).setdefault('__screens__', []).append(screen)
            continue
        node = tree
        for i, segment in enumerate(path):
            if i == len(path) - 1:
                node.setdefault(segment, {}).setdefault('__screens__', []).append(screen)
            else:
                node = node.setdefault(segment, {})
    return tree


def generate_index(spec_root: str, output_path: str) -> dict:
    """전체 스캔 실행 → spec_index.json 저장 → index dict 반환."""
    infs = scan_infs(spec_root)
    uis = scan_uis(spec_root)
    sprint = load_sprint_status(spec_root)

    domains: dict = {}
    for inf in infs:
        d = inf['domain']
        domains.setdefault(d, {'inf': 0, 'uis': 0, 'sch': 0, 'bat': 0, 'tbd_total': 0})
        domains[d]['inf'] += 1
        domains[d]['tbd_total'] += inf['tbd_count']
    for ui in uis:
        d = ui.get('domain', '')
        if d:
            domains.setdefault(d, {'inf': 0, 'uis': 0, 'sch': 0, 'bat': 0, 'tbd_total': 0})
            domains[d]['uis'] += 1
    for d, s in sprint.items():
        if d in domains:
            domains[d]['sprint_done'] = s['done']
            domains[d]['sprint_total'] = s['total']

    index = {
        'generated_at': datetime.now().isoformat(timespec='seconds'),
        'totals': {'inf': len(infs), 'uis': len(uis), 'sch': 0, 'bat': 0},
        'domains': domains,
        'infs': infs,
        'uis': uis,
        'ia_tree': build_ia_tree(uis),
    }

    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    print(f'[OK] spec_index.json 생성 완료')
    print(f'     INF {len(infs)}개 | UIS {len(uis)}개 | 도메인 {len(domains)}개')
    print(f'     → {output_path}')
    return index


if __name__ == '__main__':
    root = sys.argv[1] if len(sys.argv) > 1 else '.'
    out = os.path.join(root, 'docs', 'viewer', 'spec_index.json')
    generate_index(root, out)
