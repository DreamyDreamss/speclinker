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
import shutil
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


def _iter_inf_dirs(spec_root: str):
    """INF 파일 디렉터리 iterator. 두 가지 구조 모두 지원:
    A) docs/05_설계서/INF/{domain}/  (신규 표준)
    B) docs/05_설계서/{domain}/INF/  (기존 프로젝트)
    yields (domain_name, dir_path)"""
    design_root = os.path.join(spec_root, 'docs', '05_설계서')
    if not os.path.isdir(design_root):
        return
    # 구조 A: INF/{domain}/
    inf_root_a = os.path.join(design_root, 'INF')
    if os.path.isdir(inf_root_a):
        for d in sorted(os.listdir(inf_root_a)):
            p = os.path.join(inf_root_a, d)
            if os.path.isdir(p):
                yield d, p
        return
    # 구조 B: {domain}/INF/
    for domain in sorted(os.listdir(design_root)):
        inf_sub = os.path.join(design_root, domain, 'INF')
        if os.path.isdir(inf_sub):
            yield domain, inf_sub


def scan_infs(spec_root: str) -> list:
    """docs/05_설계서 하위 INF-*.md 전수 스캔 (두 가지 폴더 구조 지원)."""
    infs = []
    for domain_dir, domain_path in _iter_inf_dirs(spec_root):
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
            # 기능명(한글 설명): H1 제목 `# INF-...: METHOD path — {기능명}` 의 '—'(또는 ' - ') 뒤
            name = ''
            m_h1 = re.search(r'^#\s*INF-\S+\s*:\s*(.+)$', content, re.M)
            if m_h1:
                title = m_h1.group(1).strip()
                for sep in ('—', '–', ' - '):
                    if sep in title:
                        name = title.split(sep, 1)[1].strip()
                        break
            # 앵커(JIT 준비) 수 — frontmatter anchors[] 길이
            anchor_count = len(_extract_list_field(_get_fm_block(content), 'anchors'))
            infs.append({
                'id': fm.get('inf-id', fname.replace('.md', '')),
                'name': name,
                'method': fm.get('method', ''),
                'path': fm.get('path', ''),
                'domain': fm.get('domain', domain_dir),
                'domain_code': fm.get('domain-code', ''),
                'tbd_count': count_tbd(content),
                'anchor_count': anchor_count,
                'file': os.path.relpath(fpath, spec_root).replace('\\', '/'),
            })
    return infs


def _iter_uis_dirs(spec_root: str):
    """UIS 화면 디렉토리 iterator. 두 구조 지원:
    A) docs/05_설계서/{domain}/UIS/{screen}/spec.md  (도메인별 — 현행 권장)
    B) docs/05_설계서/UIS/{screen}/spec.md           (top-level — 구버전 호환)
    yields screen_dir_path (spec.md를 담은 디렉토리)"""
    design_root = os.path.join(spec_root, 'docs', '05_설계서')
    if not os.path.isdir(design_root):
        return
    # A) 도메인별
    for domain in sorted(os.listdir(design_root)):
        uis_sub = os.path.join(design_root, domain, 'UIS')
        if os.path.isdir(uis_sub):
            for entry in sorted(os.listdir(uis_sub)):
                d = os.path.join(uis_sub, entry)
                if os.path.isfile(os.path.join(d, 'spec.md')):
                    yield d
    # B) top-level (구버전)
    uis_root = os.path.join(design_root, 'UIS')
    if os.path.isdir(uis_root):
        for entry in sorted(os.listdir(uis_root)):
            d = os.path.join(uis_root, entry)
            if os.path.isfile(os.path.join(d, 'spec.md')):
                yield d


def scan_uis(spec_root: str) -> list:
    """UIS spec.md 전수 스캔 (도메인별 {domain}/UIS/{screen}/ 우선, top-level 호환)."""
    uis = []
    for screen_dir in _iter_uis_dirs(spec_root):
        spec_path = os.path.join(screen_dir, 'spec.md')
        entry = os.path.basename(screen_dir)
        try:
            with open(spec_path, encoding='utf-8', errors='replace') as f:
                content = f.read()
        except OSError:
            continue
        fm = parse_frontmatter(content)
        fb = _get_fm_block(content)
        # 미리보기: preview_annotated.png(마커) 우선, 없으면 preview.png
        prev = None
        for cand in ('preview_annotated.png', 'preview.png'):
            if os.path.isfile(os.path.join(screen_dir, cand)):
                prev = cand
                break
        uis.append({
            'id': fm.get('UIS-ID', entry),
            'name': fm.get('화면명', ''),
            'route': fm.get('라우트', ''),
            'domain': fm.get('도메인', ''),
            'menu_path': _extract_list_field(fb, 'menu-path'),
            'apis': _extract_list_field(fb, 'apis') or _extract_list_field(fb, 'api_hints'),
            'has_preview': prev is not None,
            'preview': prev or 'preview.png',
            'anchor_count': len(_extract_list_field(fb, 'anchors')),
            'file': os.path.relpath(spec_path, spec_root).replace('\\', '/'),
        })
    return uis


def _iter_sch_dirs(spec_root: str):
    """SCH 파일 디렉터리 iterator. 두 구조 지원:
    A) docs/05_설계서/SCH/{domain}/   B) docs/05_설계서/{domain}/SCH/
    yields (domain_name, dir_path)"""
    design_root = os.path.join(spec_root, 'docs', '05_설계서')
    if not os.path.isdir(design_root):
        return
    sch_root_a = os.path.join(design_root, 'SCH')
    if os.path.isdir(sch_root_a):
        for d in sorted(os.listdir(sch_root_a)):
            p = os.path.join(sch_root_a, d)
            if os.path.isdir(p):
                yield d, p
        return
    for domain in sorted(os.listdir(design_root)):
        sch_sub = os.path.join(design_root, domain, 'SCH')
        if os.path.isdir(sch_sub):
            yield domain, sch_sub


def _parse_inf_list(fm_block: str, fm: dict) -> list:
    """SCH frontmatter의 inf: 값을 리스트로. 인라인([a, b])·블록(- a) 모두 지원."""
    raw = fm.get('inf', '').strip()
    if raw.startswith('[') and raw.endswith(']'):
        return [x.strip() for x in raw[1:-1].split(',') if x.strip()]
    block = _extract_list_field(fm_block, 'inf')
    if block:
        return block
    return [x.strip() for x in raw.split(',') if x.strip()] if raw else []


def scan_schs(spec_root: str) -> list:
    """docs/05_설계서 하위 SCH-*.md 전수 스캔 (두 구조 지원)."""
    schs = []
    for domain_dir, domain_path in _iter_sch_dirs(spec_root):
        for fname in sorted(os.listdir(domain_path)):
            if not (fname.endswith('.md') and fname.startswith('SCH-')):
                continue
            fpath = os.path.join(domain_path, fname)
            try:
                with open(fpath, encoding='utf-8', errors='replace') as f:
                    content = f.read()
            except OSError:
                continue
            fm = parse_frontmatter(content)
            fb = _get_fm_block(content)
            schs.append({
                'id': fm.get('sch-id', fname.replace('.md', '')),
                'table': fm.get('table', ''),
                'domain': fm.get('domain', domain_dir),
                'domain_code': fm.get('domain-code', ''),
                'inf': _parse_inf_list(fb, fm),
                'file': os.path.relpath(fpath, spec_root).replace('\\', '/'),
            })
    return schs


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
    schs = scan_schs(spec_root)
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
    for sch in schs:
        d = sch['domain']
        if d:
            domains.setdefault(d, {'inf': 0, 'uis': 0, 'sch': 0, 'bat': 0, 'tbd_total': 0})
            domains[d]['sch'] += 1
    for d, s in sprint.items():
        if d in domains:
            domains[d]['sprint_done'] = s['done']
            domains[d]['sprint_total'] = s['total']

    index = {
        'generated_at': datetime.now().isoformat(timespec='seconds'),
        'totals': {'inf': len(infs), 'uis': len(uis), 'sch': len(schs), 'bat': 0},
        'domains': domains,
        'infs': infs,
        'uis': uis,
        'schs': schs,
        'ia_tree': build_ia_tree(uis),
    }

    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    print(f'[OK] spec_index.json 생성 완료')
    print(f'     INF {len(infs)}개 | UIS {len(uis)}개 | SCH {len(schs)}개 | 도메인 {len(domains)}개')
    print(f'     → {output_path}')
    return index


def copy_viewer_assets(spec_root: str) -> None:
    """플러그인 뷰어 자산(index.html/js/css)을 프로젝트 docs/viewer/로 복사.

    뷰어는 프로젝트 루트에서 서빙된다(문서 docs/...와 자산 docs/viewer/...이
    한 서버 루트 아래 있어야 INF 클릭 라우팅이 동작). 따라서 깨끗한 프로젝트에도
    부트스트랩 자산이 docs/viewer/ 안에 존재하도록 매 실행마다 동기화한다."""
    plugin_viewer = os.path.normpath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', 'viewer'))
    dest = os.path.join(spec_root, 'docs', 'viewer')
    os.makedirs(dest, exist_ok=True)
    copied = []
    for asset in ('index.html', 'docsify-sl.js', 'sl-theme.css'):
        src = os.path.join(plugin_viewer, asset)
        dst = os.path.join(dest, asset)
        if not os.path.isfile(src):
            continue
        if os.path.abspath(src) == os.path.abspath(dst):
            continue  # 플러그인 자체를 대상으로 실행한 경우 자기복사 방지
        try:
            shutil.copy2(src, dst)
            copied.append(asset)
        except OSError:
            pass
    if copied:
        print(f'[OK] 뷰어 자산 동기화: {", ".join(copied)} → {dest}')


if __name__ == '__main__':
    root = sys.argv[1] if len(sys.argv) > 1 else '.'
    copy_viewer_assets(root)
    out = os.path.join(root, 'docs', 'viewer', 'spec_index.json')
    generate_index(root, out)
